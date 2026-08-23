# Implementation Gap Audit — 2026-08-23

Written before the vertical-slice completion pass (`CLAUDE_CODE_TASK_ONQOL_VNEXT_VERTICAL_SLICE_COMPLETION_v2_2026-08-23.md`), per its §1 instruction. Every item below was verified against the current code and content in this repository on this date, not copied from the prior `docs/KNOWN_GAPS.md` (which is honest and mostly still accurate, but was written before this pass and did not have the governance finding below).

## Governance decision on record

Before any implementation, a runtime-governance question was raised and answered by the product owner:

> Strictly enforce `approved_for_training` for all authoritative runtime effects. Do not treat `reviewed_internal` as sufficient and do not bulk-promote any clinical content. Build the governance gate now, then produce an exact blocker list of every rule, trajectory, finding, treatment effect, operative prerequisite, complication, or other content item required for the APP-004 vertical slice that is not yet `approved_for_training`. Keep those items out of authoritative runtime until clinical review and explicit approval. Simulator limitations caused by missing approval must not be scored as learner errors.

This is the binding instruction for how P0-5 (and everything P0-5 gates) is implemented in this pass. See §3 below for the exact blocker list this produces.

## 1. Verified gaps this pass addresses

### P0-1 — learner-facing command coverage
- `COMMAND` (`src/core/commands/commandTypes.js`) has no explicit commands for: previous/pending-result requests (folded into `REQUEST_STATUS`, acceptable), `SET_NPO`, `ESTABLISH_IV_ACCESS`, `GIVE_ANTIBIOTIC_PROPHYLAXIS`, `REQUEST_ANESTHESIA_REVIEW` — preop is entirely represented by the synthetic `COMPLETE_PREOP_ITEM`, which the task brief explicitly forbids as a *learner-facing* command (§7.1, §4.1 "Preoperative actions").
- `interpretTurn.js` has no fragment matcher that recognizes NPO, IV access, antibiotic-prophylaxis, or anesthesiologist-review phrasing as anything other than `CALL_STAFF` (for the anesthesiologist) — there is no path from "поставь венозный доступ" or "нулевой стол" to a preop-relevant command at all today; those fragments silently match nothing.
- `session.e2e.test.js`'s "full journey" test drives the session via `createCommand`/`applyCommand` directly and uses `COMPLETE_PREOP_ITEM` — exactly the pattern task §17 says does not count as learner E2E.
- No live-LLM interpreter path exists; `server/` has no gateway file at all in this repo (checked: `server/` contains one file, see §2).
- **Fix in this pass:** add explicit commands for the missing preop actions, add interpreter coverage, derive preop completion from those real commands (not from `COMPLETE_PREOP_ITEM`), and add a learner-text-driven E2E test.

### P0-2 — clinical time
- `advanceTime` is only ever invoked from two call sites in `useSession.js`: (a) when the interpreter finds a `REASSESS` command carrying `afterMinutes`, and (b) `advanceAndReveal`, which is exported by the hook but **never called from any UI component** (verified: `App.jsx` does not import it, no other file calls it). This means ordering a CBC without an explicit "переоценю через N минут" in the same or a later turn never delivers the result — there is no ambient clock tick.
- **Fix in this pass:** make ordinary clinical actions (tests, treatments, staff calls) that do not otherwise specify a wait implicitly settle to the next natural interruption point is out of scope for a chat UI without over-engineering; instead, add a UI-visible "advance time" affordance is also not specified by the task. The task brief's own example journey has the learner explicitly say "через 30 минут" at each wait point — so the real fix is: every learner turn, after commands execute, drains any pending work that is *already due* at the current clock minute (it is not, since nothing advances the clock spontaneously) — see the implementation notes for the actual mechanism chosen (turn-boundary drain + explicit reassessment/wait commands), documented in `docs/ARCHITECTURE.md` after the change.

### P0-3 — treatment effects
- `TREATMENT_EFFECT_APPLIED` exists as an event type and the reducer applies it, but **nothing in the codebase ever creates one.** `ORDER_MEDICATION`'s handler fires `MEDICATION_ORDERED` + `MEDICATION_ADMINISTERED` and stops; no code reads `trajectories.yaml`'s `treatment_effects` map at all (confirmed by grep — `treatment_effects` is referenced nowhere outside that YAML file).
- Content exists for the effects the task wants (`analgesia_iv_nsaid`, `crystalloid_bolus_500_1000ml`, `antibiotic_prophylaxis`) but **every one of them is `review_status: pending`**, as is the entire `TRJ-STABLE` trajectory (drift and recovery rates) and the whole `physiology_envelopes.uncomplicated_inflammation` block in `disease.yaml`.
- **Fix in this pass:** build the effect-scheduling mechanism (medication/infusion administration schedules a `TREATMENT_EFFECT_APPLIED` from content) and the recovery-after-source-control mechanism, both gated through the new governance check. Given the governance decision above, this mechanism will currently apply **zero** effects at runtime, because no effect, no trajectory drift rate, and no recovery rate is `approved_for_training`. This is reported as a blocker, not silently worked around (see §3).

### P0-4 — preoperative workflow
- `preop.ready` is genuinely derived from `preop.completed` vs `preop.required[].blocking` (confirmed correct, already an event-sourced computation, not a manually-set flag — this part of the architecture already matches the spec).
- The only way `preop.completed` is ever populated (besides `CONSENT_OBTAINED`) is the synthetic `COMPLETE_PREOP_ITEM` command, which the task forbids as learner-facing.
- **Fix in this pass:** real commands (`SET_NPO`, `ESTABLISH_IV_ACCESS`, `GIVE_ANTIBIOTIC_PROPHYLAXIS`, `REQUEST_ANESTHESIA_REVIEW` resolving on staff arrival) each independently emit `PREOP_ITEM_COMPLETED` for their own `itemId` when the real precondition is met (e.g. antibiotic timing window, anesthesiologist arrival). `COMPLETE_PREOP_ITEM` is removed from the command vocabulary entirely (kept nowhere, not even as a fallback) so it is structurally impossible for a test or the UI to use it.
- Antibiotic timing-window correctness (the "within 60 minutes of incision" rule) is itself only `reviewed_internal` inside `operative.yaml`'s per-item `source_ids`, without its own `review_status`/`reviewers` — under strict governance this hard-blocking timing check cannot be authoritative either; see §3.

### P0-5 — governance lifecycle enforcement
- `scripts/buildContentIndex.mjs` enforces provenance fields **at author/build time only** (a rule missing `source_ids`/`review_status`, or claiming `approved_for_training` without `reviewers`, fails the build).
- `core/rules/ruleEngine.js#eligibleRules` performs **zero runtime filtering by `review_status`.** Every rule in `rules.yaml` is `review_status: reviewed_internal` (none are `approved_for_training`), including `RULE-CONSENT-BEFORE-PROCEDURE`, the sole `LEVEL_4_CATASTROPHIC` safety stop in the slice — and it fires today with no runtime gate at all.
- Content-wide grep of every `review_status`/`clinical_review_status` field across `src/content/diseases/appendicitis/*.yaml` (verified 2026-08-23): **nothing in the entire bundle is `approved_for_training`.** See exact list in §3.
- **Fix in this pass:** add a runtime governance gate — `MIN_RUNTIME_AUTHORITY = "approved_for_training"` — enforced in `eligibleRules` (rules), in the new treatment-effect/trajectory-drift/complication mechanisms (patient truth), and in preop hard-prerequisite evaluation. Anything below that bar is excluded from authority and, where it would otherwise have produced a learner-visible consequence, is instead surfaced as an explicit `SIMULATOR_LIMITATION` marker the debrief/UI can distinguish from a learner error (task §21, Governance Spec §8.3, Behavior Contract §50.1's precedent for "not yet supported" framing).

### P0-6 — disease-specific logic in core
- `src/core/commands/executeCommand.js`'s `OPERATIVE_DECISION` handler **hardcodes** `command.params.choice === "appendectomy_only" || choice === "appendectomy_plus_aspiration"` to decide whether source control occurred, and hardcodes the complication id `"superficial_ssi"` and its 48-hour check window directly in core. This is a genuine violation of Foundation Spec §63/§71 and Content Authoring Guide's own stated acceptance test, contradicting `docs/KNOWN_GAPS.md`'s claim that "no file in `src/core/` ... branches on `diseaseId`" — the violation isn't a `diseaseId` branch, it's a `choice`-string and complication-id branch, which is the same failure in substance.
- **Fix in this pass:** move `source_control_effect` (which choice ids count as source control) and complication scheduling (which complications, at what post-op offset, under what condition) into `operative.yaml`/`complications.yaml` content, read generically by `executeCommand.js`.

### P0-7 — mentor state persistence
- `MENTOR_INTERVENED` event exists and the reducer applies it (`state.mentor.openQuestion`, `.scaffolding`, `.raisedIssues`), and `useSession.js` does *not* currently dispatch it — mentor decisions are rendered as chat messages but never folded back into state as an event, so `state.mentor.openQuestion` never actually gets set by a live session (only by tests that hand-construct events). The mentor "answers the open question" contract (Mentor Spec §13) is therefore not really wired end-to-end in the app, only in the reducer/test layer.
- Scaffolding levels 3 and 4 fall back to level 2's cue text (`SCAFFOLD_PROMPTS_RU` has only two entries) — confirmed, matches prior `KNOWN_GAPS.md`.
- **Fix in this pass:** `useSession.js` dispatches `MENTOR_INTERVENED` for every mentor decision with a textRu, and `interpretTurn`'s `turnContext.openMentorQuestion` is read from live state (already wired for reading; the gap was only on the write side). Author levels 3-4 scaffolding content.

### P0-8 — causal event log
- `LEARNER_TURN_RECEIVED`, `COMMAND_ACCEPTED`, `COMMAND_REJECTED` are declared in `eventTypes.js` but never emitted anywhere (grep-confirmed). `session.learnerTurns`/`session.aiTelemetry` (read by `exportSession.js`) are never populated by `useSession.js`, confirmed matches `docs/REPLAY_SCHEMA.md`'s own "known gaps" note.
- **Fix in this pass:** emit `LEARNER_TURN_RECEIVED` (with raw text) per submitted turn, `COMMAND_ACCEPTED`/`CLARIFICATION_REQUESTED` per interpreted command outcome, and populate `session.learnerTurns` in the export path.

## 2. Verified as already solid (not touched beyond what's noted above)

- Event-sourced world state with no `path_state` (`worldState.js`) — confirmed no clinical code branches on `workflow.label`.
- Mentor hidden-truth boundary (`learnerView.js`) — confirmed `state.truth` cannot reach the mentor/rule engine; `ruleEngine.js` fails unevaluable conditions to `UNKNOWN`, never `MET`.
- Resource three-way distinction (`resourceResolution.js`) — `unsupported_content` vs `unavailable_resource` vs `available` is correctly separated and tested.
- Parallel order execution in one turn — confirmed, no forced sequencing.
- Preliminary-then-formal imaging report scheduling — confirmed two distinct pending items, both correctly typed.
- Replay determinism (`worldState.test.js`) — confirmed `reduceEvents` from seed reproduces live state exactly; this is a real test, not aspirational.
- `server/` in this repo is **not** the legacy trainer's gateway — it contains a single new file (see implementation notes) that needs to be extended for the interpreter's live-provider path, not reused from `onqol-trainer/server/openaiGateway.mjs` (legacy runtime is out of scope per task §12/§21).

## 3. Governance blocker list (task §21/§23, per product-owner instruction above)

Every content item below is required by some part of the APP-004 vertical slice as specified in the task brief, and is **not** `approved_for_training` today. Per the binding instruction, none of these are promoted by this engineering pass. Each is wired as a **mechanism** that will activate automatically once the item is promoted through real clinical review — but produces **no authoritative runtime effect today**, and any resulting gap in observable behavior is surfaced as a simulator limitation, never as a learner error or a fabricated fact.

| Content item | File | Current `review_status` | Blocks |
|---|---|---|---|
| `TRJ-STABLE` (drift + recovery rates) | `trajectories.yaml` | `pending` | Disease progression over time (P0-2/P0-3) |
| `treatment_effects.analgesia_iv_nsaid` | `trajectories.yaml` | `pending` | Analgesia changing pain trajectory (P0-3) |
| `treatment_effects.crystalloid_bolus_500_1000ml` | `trajectories.yaml` | `pending` | Fluid resuscitation changing hemodynamics (P0-3) |
| `treatment_effects.antibiotic_prophylaxis` | `trajectories.yaml` | `pending` | Antibiotic effect on infection trajectory (P0-3) |
| `physiology_envelopes.uncomplicated_inflammation` | `disease.yaml` | `pending` | Patient generation's physiology ranges (used today; flagged, not removed — see note below) |
| `postoperative_course.complications[].superficial_ssi` | `complications.yaml` | `pending` | Any postoperative complication firing (P1-4) |
| `postoperative_course.baseline_recovery` | `complications.yaml` | (file-level `pending`) | Authoritative postop recovery narrative content |
| `history_bundle_ru.template` | `findings.yaml` | `pending` | — kept in use; see note below |
| `RULE-CONSENT-BEFORE-PROCEDURE` | `rules.yaml` | `reviewed_internal` | The only Level-4 safety stop in the slice (P0-5) |
| `RULE-DELAY-OVER-24H-UNCOMPLICATED` | `rules.yaml` | `reviewed_internal` | Level-2 teaching challenge on delayed surgery |
| `RULE-CEFAZOLIN-PROPHYLAXIS-DOSE` | `rules.yaml` | `reviewed_internal` | Level-2 dose-range teaching challenge |
| `RULE-ROUTINE-DRAIN-UNCOMPLICATED` | `rules.yaml` | `reviewed_internal` | Level-1 debrief-only trap |
| `preop_requirements[].antibiotic_prophylaxis` timing rule | `operative.yaml` | no per-item `review_status`; file-level `reviewed_internal` | Hard preop timing gate (P0-4) |
| `phenotypes.classic`, `phenotypes.retrocecal` | `phenotypes.yaml` | `clinical_review_status: pending` | Patient generation content (used today; flagged) |
| `disease.yaml` classification rules | `disease.yaml` | `reviewed_internal` | Complicated-vs-uncomplicated classification |

**Note on patient generation content** (physiology envelopes, phenotypes, history template): these are `Patient Engine` truth per Foundation Spec §45, not `Clinical Rule Layer` content per §47 — the governance spec's high-risk class (§8) and its runtime-authority gate (§7) are written around rules that *determine safety, indication, or teaching*, not around the phenotype library itself, which is what generates the patient the learner is managing. Excluding `pending` phenotype/physiology content from runtime would mean the simulator cannot generate a patient at all, which is a different failure mode than the one governance gating is meant to prevent (an unreviewed *rule* silently teaching or blocking). This pass keeps patient-generation content in use as before — it was already in use, this is not a new risk introduced by this pass — but flags it here explicitly rather than silently, since it is also not `approved_for_training` and a stricter future interpretation may want it gated too. This line item is a judgment call made transparent, not a decision to hide.

**Note on `investigation_timing` / resource ETAs / hospital profiles:** treated as Hospital/World Engine operational data (Foundation Spec §46), not Clinical Rule Layer content, and therefore out of scope for this gate — consistent with the architectural five-authority split, not an attempt to route safety-relevant content around the gate. `REFERENCE_HOSPITAL_PROFILE.reviewStatus: "approved_for_pilot"` and the `REAL_HOSPITAL_PROFILES`' `"pending_owner_review"` use a third, project-local vocabulary not in the Governance Spec's four states; flagged here for the owner's awareness, not changed by this pass.

**Practical consequence for the manual smoke test (task §20):** with this gate active, the learner will be able to complete the full APP-004 journey mechanically (history, exam, orders, time, preop, operation, postop, discharge), but will **not** observe: pain improving after analgesia, vitals drifting from untreated disease, a postoperative complication, or a hard safety stop on missing consent — all of these are currently blocked pending clinical review, and the UI/debrief will say so explicitly rather than silently doing nothing or, worse, silently keeping the old ungated behavior. This is reported here as the primary blocker for full acceptance criterion 1-2-6-7-11-14 satisfaction (task §24), not worked around.

## 4. Gaps intentionally deferred (out of scope per task §19, or P1 not reached this pass)

Carried forward from `docs/KNOWN_GAPS.md` where still accurate, re-verified:
- Live LLM interpreter/mentor/renderer phrasing pass — mechanism built where scoped by P0-1, no live provider key available in this environment to test end-to-end (matches prior finding).
- Second disease module — not built (task §19 confirms out of scope; P0-6 fix makes the seam real, but a second module is not required this pass).
- Patient preference/refusal modifiers, rare inaccurate history, incidental findings, intraoperative surprises, distinct hospital-character voices per role — explicitly out of scope (task §19).
- Dynamic Real Hospital resource events beyond the static profile differences already in `hospitalProfiles.js` (P1-1) — attempted this pass only as far as time allows; see completion report.
- Full debrief v1 (P1-4) — attempted this pass only as far as time allows; see completion report.
- `pack:safe` packaging script (P1-5) — attempted this pass only as far as time allows; see completion report.
