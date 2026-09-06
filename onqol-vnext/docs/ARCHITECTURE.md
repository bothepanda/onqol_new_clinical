# ON QOL vNext — Architecture

## Layers

```text
Learner language (RU/KK/EN)
      ↓
Interpreter            src/ai/interpreter/
      ↓
Explicit Clinical Commands   src/core/commands/commandTypes.js
      ↓
Domain Core             src/core/
 ├── Patient Engine          core/patient/patientGenerator.js
 ├── Hospital Engine         core/hospital/
 ├── Clinical Rule Engine    core/rules/
 ├── Time Engine             core/time/
 └── World State (reducer)   core/state/worldState.js
      ↓
Domain Events + Current State   core/events/, core/state/
      ↓
 ├── Renderer            src/ai/renderer/
 └── Mentor               src/ai/mentor/
      ↓
UI                       src/ui/, src/app/
```

Everything below "Domain Core" never imports React, never imports a provider SDK, and never receives raw learner text. Everything above it never invents clinical fact.

## The reducer is the whole domain

`core/state/worldState.js` exports two things: `createInitialState(seed)` and `applyEvent(state, event)`. The entire session is:

```js
state = events.reduce(applyEvent, createInitialState(seed))
```

There is no other place world state is mutated. `core/session/applyTurn.js` is a thin orchestration layer that calls `executeCommand` (pure: command → events, no state mutation), then folds the resulting events through the reducer. `core/time/advanceTime.js` does the same for the clock.

This is what makes replay (`core/replay/exportSession.js`), the JSON export, and the debrief the same mechanism instead of three things that can silently disagree — and it's checked by a real test (`core/state/worldState.test.js`, "replaying the full event log from scratch reproduces the live state exactly").

**A real bug this caught during the build**: an earlier version scheduled pending work (test ETAs, staff arrival) *outside* the reducer, in the orchestration layer. Replay then failed — `pending` diverged between the live session and a fresh replay from the event log — because scheduling was invisible to `reduceEvents`. The fix: every event that creates future work carries `payload.scheduledPending`, and every event that resolves one carries `payload.resolvedPendingId`; the reducer applies both generically. See the comment at the top of `worldState.js`'s cross-cutting block and `advanceTime.js`'s file header for the full explanation — it's worth reading before changing either scheduling path.

## No `path_state`

`state` has independent dimensions — `location`, `physiology`, `managementPlan`, `preop`, `operative`, `postop`, `hospital.constraints` — each of which moves on its own event. `state.workflow.label` exists (`arrival` → `assessment` → `workup` → `perioperative_preparation` → `intraoperative` → `postoperative` → `closed`) but it is **derived** from the other fields at the bottom of the reducer (`deriveWorkflowLabel`), used only for the dev panel/analytics, and no command handler, rule condition, or UI component branches on it. Deleting it changes nothing except a dev readout — that's the acceptance test for this rule, and it's true today.

## The mentor hidden-truth boundary

`core/state/learnerView.js` exports one function, `buildLearnerVisibleState(state)`. It is the **only** thing the mentor engine, the rule engine, and (eventually) an LLM-backed mentor renderer are given. It never receives `state.truth`. `core/rules/conditions.js`'s evaluators all take `ctx.learnerVisible`, never `ctx.state.truth` — and `core/rules/ruleEngine.js` fails an unevaluable condition to `UNKNOWN` (never `MET`), so a rule keyed to an undisclosed fact stays dark rather than firing on a guess. Both are covered by tests (`ruleEngine.test.js`, `session.e2e.test.js`'s "the learner-visible projection never contains the hidden patient truth").

## Safety model

`core/rules/safetyLevels.js` implements the four-level model (Core Runtime Spec §57) as data, not as an if/else ladder scattered through handlers. `executeCommand.js` evaluates every reviewed rule against learner-visible state before running a command's handler; a `LEVEL_4_CATASTROPHIC` match blocks execution and returns `SAFETY_STOP` without running the handler at all. Levels 1-3 do not block — they ride along as `firedRules` for the mentor engine to decide whether to `CHALLENGE`.

## Content is data, not branches

`src/content/diseases/appendicitis/*.yaml` is the entire clinical payload: phenotypes, physiology envelopes, exam-slot wording, reviewed rules (with `source_ids`, `review_status`, `reviewers` — Governance Spec §6), operative decisions, and postoperative complications. `scripts/buildContentIndex.mjs` compiles it into `src/content/generated/*.json` and **fails the build** if a rule is missing provenance or claims `approved_for_training` without recorded reviewers.

`src/core/patient/patientGenerator.js`, `src/core/commands/executeCommand.js`, and `src/ai/renderer/renderEvent.js` read this bundle by shape (`bundle.disease`, `bundle.phenotypes`, `bundle.rules`, ...) and contain **no `if (diseaseId === "appendicitis")` branch anywhere**. That is the second-disease acceptance test from Core Runtime Spec §63/§71: a second disease module should be addable primarily as a new `src/content/diseases/<name>/*.yaml` tree plus (if genuinely new mechanics are needed) new condition evaluators in `core/rules/conditions.js` — not new core branches. This has not yet been exercised with a real second disease; see `docs/KNOWN_GAPS.md`.

## AI boundary

`src/ai/providerClient.js` defines the provider-neutral interface. `src/ai/interpreter/`, `src/ai/mentor/`, `src/ai/renderer/` each have a **deterministic fallback** that requires no network call and no API key — this is not a stub, it's the default runtime path, and it's what the whole test suite runs against. `server/aiGateway.mjs` is where a real provider key would live (server-side only); with no key configured it returns `501 no_provider_configured` rather than pretending to work.

The mentor's *decision* of which mode to use (`CONTINUE`/`CHALLENGE`/`TEACH`/`SAFETY_STOP`) is deterministic, driven by fired rules and scaffolding state — never by an LLM. Only future *phrasing* variation is a place an LLM could sit on top, per Mentor Spec §3.3's "clinical truth is deterministic and reviewed; teaching behavior is adaptive and generative" — "adaptive" here means "responds to state," not "invents the response."

## UI

`src/ui/components/` are presentational; `src/app/session/useSession.js` is the only place that calls into `core/` and `ai/`. `SessionSidebar.jsx` renders only the task brief §23.5 allowlist (hospital clock, latest vitals, revealed constraints, JSON export) — it receives `learnerVisible`, never raw `state`, so there is no code path by which `state.mentor`, `state.pending`, rule ids, or the seed could leak into it.

## Runtime clinical governance (added 2026-08-23)

`core/rules/governance.js` is the single place that decides whether a piece of clinical content may act with authority at runtime. The bar is `review_status === "approved_for_training"` and nothing below it — `reviewed_internal`, `reviewed`, `draft`, `pending`, or a missing field — may alter patient truth, create a safety stop, or become authoritative teaching.

This is enforced in three places, all of which fail closed:

- `ruleEngine.js#eligibleRules` filters clinically-eligible rules by review status, and `governanceBlockedEligibleRules` records what was excluded so it can be audited without being obeyed;
- `advanceTime.js` gates trajectory drift/recovery and complication probability, emitting `SIMULATOR_LIMITATION_NOTED` instead of silently doing nothing;
- `executeCommand.js#scheduleGovernedTreatmentEffect` gates treatment effects — the order still executes, only the modeled physiological consequence is withheld.

The critical distinction, and the reason a withheld item emits an event rather than nothing: a governance gap must be reportable as a **simulator limitation**, never as a learner omission (task brief §21). An unapproved complication is therefore *not* rolled and *not* reported as "cleared" — clearing it would falsely assert that a reviewed probability had been evaluated and come out negative.

What the gate deliberately does **not** cover, per the five-authority split (Core Runtime Spec §44-46): Hospital/World Engine operational data (resource ETAs, staff arrival, test turnaround, dynamic constraints) and Patient Engine generation content (phenotype library, physiology envelopes). See `docs/IMPLEMENTATION_GAP_AUDIT_2026-08-23.md` for the reasoning and the exact blocker list.

## One learner-turn pipeline

`core/session/submitLearnerTurn.js` is the only path a learner turn takes:

```text
raw text -> interpretTurn -> validateCommand -> executeCommand -> reducer
         -> advanceTime (on a stated wait) -> mentor decision -> events
```

With `AI_INTERACTION_V2` enabled, a second non-authoritative branch runs beside
the first line: learner-visible context -> model schema -> concept/parameter
validation -> structured comparison -> `ai_telemetry`. It has no connection to
`validateCommand -> executeCommand`, never emits a domain event, and provider
failure cannot change the deterministic result.

Both `app/session/useSession.js` and the learner-journey test suite call it, which is the point: the app cannot reach a capability the tests bypass, and the tests cannot exercise one the app has no path to. That was the specific failure this pass existed to fix — the previous build's "end-to-end" test drove `executeCommand` directly and used a `COMPLETE_PREOP_ITEM` command the UI could not produce, so preoperative preparation appeared to work and was in fact unreachable by any learner. That command no longer exists anywhere in the codebase, and `core/architecture.test.js` enforces its absence.

Every turn emits `LEARNER_TURN_RECEIVED` (raw text plus the interpreter's reading) and one `COMMAND_ACCEPTED` / `COMMAND_REJECTED` / `CLARIFICATION_REQUESTED` per command, which is what `exportSession.js#buildLearnerTurns` folds into the export's causal trail.

## Disease-independence is enforced, not asserted

`core/architecture.test.js` greps `src/core/**` and `src/ai/**` product logic (comments stripped — a comment explaining *why* the core must not know about appendicitis is not a violation) for disease-specific strings and fails if any appear.

This test failed when it was written. `executeCommand.js` branched on the literal choice ids `"appendectomy_only"` / `"appendectomy_plus_aspiration"` to decide whether source control had occurred, and hardcoded the complication id `"superficial_ssi"` and its 48-hour window. Both are now content-driven: an operative option declares `source_control: true` in `operative.yaml`, and complication scheduling iterates whatever `complications.yaml` declares. The interpreter likewise contains no operation vocabulary — a pending operative decision is matched against that decision's own `matches_ru` phrases, passed in via `turnContext.pendingDecisionOptions`.
