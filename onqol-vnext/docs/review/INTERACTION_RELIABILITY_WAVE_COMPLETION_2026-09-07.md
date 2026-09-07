# Interaction Reliability Remediation Wave — Completion Report

**Date:** 2026-09-07
**Baseline:** `feat/onqol-vnext-clean-core` @ `87a8429`
**Evidence session:** a raw pilot session export (removed from Git; private store only)
**Scope kept:** learner-language interpretation, command continuation, deduplication,
clinical-time integrity, event/replay auditability. **No clinical truth or clinical rule
changed.** No pending clinical content promoted.

---

## 1. Root cause

**`AI_INTERACTION_V2` is not an LLM switch.** `src/ai/interpreter/interpretTurn.js` calls
`interpretDeterministically(...)` unconditionally. When `AI_INTERACTION_V2` is `true`,
`submitLearnerTurn` additionally fires `runSplitSemanticShadow` as a **shadow** promise that
is never awaited by the clinical path and never enters the event log. So `AI_INTERACTION_V2 =
false` in the failed session disabled only discarded Wave 2.3 telemetry — **there was no LLM
interpreter on the live path at all.** `ai_telemetry: []` in the export confirms no model call.

The pilot was therefore running the 948-line deterministic vocabulary parser — designed as the
*fast path* — as if it were the whole interpreter. Every failure in the reported session is a
defect in that parser or in the runtime around it, not in a model:

| symptom | mechanism |
|---|---|
| `elapsedMinutes` stuck at 0 for 9 turns | `submitLearnerTurn` advanced the clock only for a stated wait or a handler-returned `consumesMinutes`; only `TRANSPORT` returns that. History, examination, ordering, treatment cost nothing, so pending results (`dueAtMinutes` 40–85) could never come due. |
| `оак оам узи обп` → only `cbc` | `splitFragments` splits on `, ; и` only; a space-separated investigation list stayed one fragment and only the first synonym matched. |
| `‹pilot turn D›` → one order | `+` was not a separator. |
| `‹pilot turn E›` → `ultrasound_abdomen` (wrong) + a duplicate | `vocabulary.js` mapped bare `узи → ultrasound_abdomen`; no pelvic entry; no dedup. |
| `обезболить`, `‹pilot turn H›` → `CLINICAL_REASONING` no-op | no generic-analgesia intent; `кетотоп` (ketoprofen slang) not an alias. |
| `в/м` → `ORDER_VALIDATION_FAILED { reasonKey: null, ruleIds: [], governanceBlocked: [] }` | the route merge worked; `validateMedicationOrder` names its reason `code` + `textRu`, but the trail-event payload read `result.reasonKey` (wrong field) and dropped it. |
| `revealed.results: ["cbc", "ultrasound_abdomen"]` with `result: null` | `TEST_ORDERED` was a disclosing event, conflating "ordered/pending" with "result shown". |

No provider key is available in this environment (`OPENAI_API_KEY` unset; the key supplied
mid-wave returned `credit_balance_exhausted` on every call). The wave was therefore split.

---

## 2. Architecture — before / after

**Before (live path):**
```
learner text -> interpretDeterministically() -> commands -> validateCommand -> executeCommand
                                                    (AI_INTERACTION_V2 only) shadow split-semantic, discarded
```

**After:**
```
learner text
  -> interpretDeterministically()            [always; authoritative for what it resolves]
  -> IF it left an unresolved fragment AND a provider is configured (VITE_ONQOL_INTERPRETER=hybrid):
       one semantic ACTION extraction via interpretSemanticTask()
         schema-validated -> concept-allowlist-validated -> params rebound from verbatim evidence only
       validated commands ADDED (never substituted); each still goes through validateCommand/executeCommand
     ELSE / on any provider error, timeout, invalid structure, empty result:
       deterministic reading stands unchanged  (mode "hybrid_fallback_deterministic")
  -> commands -> validateCommand -> executeCommand -> Clinical Rules / Patient Engine / Hospital
```
Clock now advances from a **versioned operational-calibration content artifact**
(`src/content/shared/simulation/calibration.yaml`, scoped to APP-004, Clinical-Lead approved) —
history 10 min, abdominal exam 5, other exam 3, focused question 1; ordering 0. Ordering a
test never fast-forwards to its own `dueAtMinutes`; results arrive as time naturally reaches
them through history / examination / treatment / stated wait / transport / reassessment.

---

## 3. Files changed (this wave, `87a8429..HEAD`, 27 files)

| file | why |
|---|---|
| `src/content/shared/simulation/calibration.yaml` | **new** — approved operational durations, versioned, scoped, with provenance |
| `src/core/session/operationalCalibration.js` | **new** — resolve the scoped entry; no match ⇒ 0 (unchanged for other diseases) |
| `src/core/session/submitLearnerTurn.js` | fold calibrated per-turn cost by MAX with handler `consumesMinutes`; thread `code`/`textRu`/`classification` into the trail event; record `interpreterMode`; accept a pre-resolved `interpreted`; export `buildTurnContext` |
| `src/core/session/createSession.js`, `src/core/state/worldState.js` | carry `casePresetId` on `state.session` so calibration can be scoped |
| `src/ai/interpreter/deterministicInterpreter.js` | `collectTestIds` (multi-investigation decomposition); `+`/`плюс` separators; pelvic-US guard; generic-analgesia intent; `repeat` flag; Cyrillic-stem fix for "контрол…" |
| `src/ai/interpreter/vocabulary.js` | `pelvic_ultrasound` (recognised-unsupported); `кетотоп`/`кетонал`→ketoprofen, `кетанов`→ketorolac; one status-query pattern |
| `src/ai/interpreter/interpretTurn.js` | tag every deterministic result `mode: "deterministic"` |
| `src/ai/interpreter/hybridInterpreter.js` (+ `.test.js`) | **new** — the hybrid interpreter and 7 unit tests (injected semantic task) |
| `src/ai/interpreter/splitSemanticInterpreter.js` | injectable `runSemantic` seam (test only) |
| `src/ai/interaction/featureFlags.js` | `INTERPRETER_MODE`, `resolveInterpreterMode` |
| `src/core/commands/executeCommand.js` | `ALREADY_PENDING` duplicate-order guard (pending **and** resulted; `params.repeat` bypasses) |
| `src/core/rules/medicationOrderValidation.js` | conformance failures classified `order_outside_pilot_schema`, not `reviewed_unsafe` (§12) |
| `src/core/events/eventTypes.js` | `TEST_ORDERED` removed from `DISCLOSING_EVENTS` (§16) |
| `src/core/state/learnerView.js` | new `orderedInvestigations` (status only); `revealedResults` now = results actually shown |
| `src/ai/renderer/renderStatus.js` (+ `.test.js`) | pending line reads `orderedInvestigations`; `renderAlreadyPending` |
| `src/core/replay/exportSession.js` | `export.interpreter = { modes, byTurn }` |
| `src/app/session/useSession.js` | `submitTurn` async; `await interpretHybrid` when `VITE_ONQOL_INTERPRETER=hybrid` |
| `src/core/replay/replayIntegrity.test.js`, `src/tests/coreRuntimeContract.test.js`, `src/core/session/reportedSessionRegression.test.js`, `e2e/app004-pilot-readiness.spec.js` | assertions updated from the frozen-clock / older-behaviour baseline to the wave-specified behaviour |
| `src/core/session/interactionReliabilityRegression.test.js` | **new** — §20 A–L, §21 corpus, §22 negatives, §13 |
| `scripts/smokeHybridInterpreter.mjs`, `scripts/acceptanceInteractionWave.mjs` | **new** — live smoke, §25 acceptance |

Mentor (`src/ai/mentor/**`) unchanged this wave (§23).

---

## 4. LLM boundary

**The model may:** map Russian free text (abbreviations, slang, typos, ellipsis, compound
turns) to an **allowlisted** canonical concept + command `type`, and cite verbatim evidence
spans.

**The model may not:** choose a drug, dose, route, volume, duration or interval (numeric
order parameters are rebuilt only from the learner's literal evidence); decide clinical
correctness or safety; read hidden patient truth; mutate state; execute anything; replace a
deterministic command; or have its output survive a provider failure. On any provider
problem the turn is the deterministic reading. Replay never calls the model — the structured
interpretation is already in `LEARNER_TURN_RECEIVED`.

---

## 5. Failed-session regressions

| input | before | after | test |
|---|---|---|---|
| `‹pilot turn A›` | both commands, but clock frozen at 0 | EXAMINE→CLARIFY(region) + TAKE_HISTORY→EXECUTED, **+10 min** | §20-A, §20-K |
| `‹pilot turn B›` | EXAMINE abdomen | EXAMINE abdomen, **+5 min** | §20-B |
| `‹pilot turn C›` | only `ORDER_TEST cbc` | cbc + urinalysis + ultrasound_abdomen; `ост` unresolved | §20-C |
| `‹pilot turn D›` | only `ultrasound_abdomen` | ultrasound_abdomen + pelvic_ultrasound | §20-D |
| `‹pilot turn E›` | `ultrasound_abdomen` (wrong) + duplicate order | `pelvic_ultrasound` → `UNSUPPORTED_CONTENT` (honest) | §20-E |
| `обезболить` | `CLINICAL_REASONING`, 0 commands | `ORDER_MEDICATION` → CLARIFY(drugId); no drug chosen | §20-F, §22 |
| `‹pilot turn H›` | `CLINICAL_REASONING`, unmatched | `ORDER_MEDICATION ketoprofen 30 mg` → CLARIFY(route) | §20-G |
| `кетопрофен 30 мг` → `в/м` | route merged, then `ORDER_VALIDATION_FAILED { reasonKey: null }` | route merged; `ORDER_VALIDATION_FAILED { reasonKey: "dose_not_approved", textRu: …, classification: "order_outside_pilot_schema" }` | §20-H/I |
| repeat `узи обп` while pending | second pending copy created | `ALREADY_PENDING` (no new pending); explicit "в динамике" re-orders | §20-J, §13 |
| whole encounter | `elapsedMinutes` 0 throughout | advances through history/exam/wait; pending results deliver on time | §20-K, §20-L |
| — | `revealed.results` held unresulted ids | holds only results actually shown | §16 checks in §25 |

---

## 6. Test results

| command | result |
|---|---|
| `npm run content:check` | OK (…,simulation) |
| `npm test` | **362 / 362**, 0 fail (was 316; +38 §20/§21/§22/§13, +7 hybrid, +1 e2e-affected) |
| `npm run lint` | clean |
| `npm run build` | OK |
| `npm run wave2:corpus` | OK (52 fixtures) |
| `npm run wave23:freeze:check` | OK |
| `npm run test:e2e` | **4 / 4** Playwright |
| `npm run pack:safe` | OK — 296 entries, 2.69 MB, 0 forbidden |
| `node scripts/acceptanceInteractionWave.mjs` (§25) | **PASS** — 10/10 checks |
| `node scripts/smokeHybridInterpreter.mjs` (§24 live) | **PROVIDER_UNAVAILABLE** — `credit_balance_exhausted`; `failedClosedEverywhere: true`, `injectionSafe: true` |

CI is mock-only; the live smoke is separate and needs a funded key.

---

## 7. Fresh-session audit (§25)

One `learner_pilot` APP-004 session, deterministic interpreter, natural Russian
(`docs/evidence/INTERACTION_WAVE_ACCEPTANCE_2026-09-07.json`):

- interpreter mode recorded: `["deterministic"]`, per turn.
- simulated time advanced to **130 min** through history + examination + a 2-hour reassessment.
- several investigations from one message; an abbreviation; a slang term; an incomplete
  medication order answered by a short contextual reply (`100 мг в/в` merged into the pending
  order); a later explicit repeat.
- pending results (`cbc`, `urinalysis`, `crp`, `ultrasound_abdomen`) delivered automatically
  when time reached their due minute; `revealed.results` holds only those.
- **10/10 checks PASS:** no dropped turns; every rejection explained; no duplicate pending
  events; interpreter mode recorded; clarification links auditable; clock moved; result
  lifecycle coherent; `revealed.results` clean; no medication executed without the learner's
  drug+route; event-log replay reproduces state with no new interpretation.

---

## 8. Remaining risks / known gaps

1. **Hybrid semantic path unverified against a real model.** Built, unit-tested, and
   fail-closed-verified against a live (failing) provider, but the "the model actually
   improves interpretation" claim is not demonstrated — no API credits. Hybrid mode is
   **off by default** (`VITE_ONQOL_INTERPRETER` unset ⇒ deterministic).
2. **Deterministic coverage is still bounded to the authored vocabulary.** Paraphrase
   outside it now degrades to an honest "не распознано" / clarification instead of a silent
   wrong action, but it is not *understood*. Closing that is exactly what Stage 2 is for.
3. **`pelvic_ultrasound` is recognised but unsupported content.** Adding a real pelvic-US
   study is a separate clinical-review item, out of scope here.
4. **Operational durations are APP-004-only.** Any other disease keeps a 0-minute action
   cost until it receives its own reviewed `simulation_calibration` entry (by design).
5. **`internal_development` runs the same durations as `learner_pilot`** for APP-004 (scope
   includes both) so dev and pilot pace identically; `faculty_preview` too. Narrow the
   scope to `learner_pilot` only if that is not wanted.
6. **Concurrent actions in one turn share one interval (MAX, not SUM).** "‹pilot turn A›" =
   10 min, not 15. Consistent with Core Runtime Spec §7.2; flag if a different model is wanted.

---

## 9. Final status

**Stage 1 (deterministic interaction repair): `GO_FOR_LEARNER_PILOT`.**
Every documented failure in the reported session is closed and covered by a regression test;
failures now degrade safely to clarification rather than silent wrong action; the clock,
pending-result delivery, duplicate-order handling, order-validation explainability and
`revealed.results` semantics are fixed; the §25 acceptance session passes 10/10; 362/362
tests, 4/4 e2e, clean lint/build/pack.

**Stage 2 (hybrid LLM interpreter): `NO_GO` until a funded provider run passes §24 live
smoke and a §25 acceptance on the hybrid path.** The code is in place and fail-closed; it
must stay disabled (`VITE_ONQOL_INTERPRETER` unset) in the pilot build until then.

The broad goal "ON QOL reliably understands natural Russian" is **not** met by Stage 1 alone
— it is met for the documented failure modes and made *safe* everywhere else. Whether that
is sufficient to widen the resident pilot now, or whether to hold for Stage 2, is a
product-owner call.
