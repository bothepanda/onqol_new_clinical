# FLEXIBLE PATIENT V2: Governed Clinical Variability — implementation review

Date: 2026-09-25. Scope: `onqol-vnext`, internal APP-004/Reference Hospital, Russian UI. Four base specifications were read before changing code and left unchanged. The owner’s explicit V2 task withdraws the 2026-09-24 scoped permission for model-created facts; the old addendum is marked superseded in the contract index. This report is technical evidence, **not a claim of clinical reliability or approval for a resident pilot**.

## A. Before

The opt-in V1 UI instantiated a normal APP-004 patient, copied the entire hidden generated dossier into its own mutable `facts`, and thereafter used `runFlexibleTurn` as a separate patient simulator. A generator proposed fact additions, numerical treatment responses, elapsed minutes and patient/staff/mentor text. A second model reviewed plausibility; passing proposals were atomically added to the independent fact registry and its replay. The server accepted the full client-held dossier and V1 learner download contained hidden facts and rejected raw responses. V1 session data is retained locally but never imported or resumed as V2 clinical truth. The previously mentioned `src/ai/patient/flexiblePatient.json` does not exist in this checkout.

## B. Authority problems found

| Former seam | Clinical authority error | V2 disposition |
|---|---|---|
| `createFlexibleSession` | Hidden diagnosis, future findings and labs copied to model-facing registry | Removed from execution path |
| V1 proposal `facts`, `elapsedMinutes` | Model could create symptom/history/exam/result, magnitude and clock movement | Removed from schema and runtime |
| V1 reviewer `clinicallyPlausible` | Plausibility could authorize unsupported new truth | Replaced with veto-only language anomaly check |
| V1 `replayFlexible` | Separate model-derived causal history | Removed; existing event log/reducer/replay used |
| V1 patient/staff/mentor messages | Patient generator could produce teaching and hidden hints | Patient/staff rendering only; existing mentor separate |
| V1 browser export and gateway | Hidden client state transmitted/downloaded | Gateway accepts one visible speech projection; learner export only shown transcript |

No clinical content was promoted to make V2 pass. The old reviewer’s approval was never clinical evidence. The V1 live-smoke script is retired; earlier private evidence remains intact.

## C. After — execution flow

Learner text follows the existing `useSession` interpreter, `submitLearnerTurn`, governed command/rule handling, scheduler and reducer. Existing `renderEvent` / `renderTurnMessages` create the authorized disclosure. V2 then passes **only that disclosed patient/staff response** and a short visible dialogue context to `/api/flexible/turn`. The model chooses a bounded language variant and neutral opening/closing; the server binds protected clinical clauses, asks the verifier to veto anomalies, retries at most once, then returns the exact deterministic response. The browser rebinds the returned proposal against its own visible facts, so even a compromised gateway cannot insert a different number. Model output never becomes a command, rule, patient event, score, source or state patch. System notices and Mentor messages bypass the patient renderer.

The UI now includes the existing `VitalsStrip` fed by `buildLearnerVisibleState`. It labels the **last measured** time and suppresses pain observed in a different pain state. Thus “see current indicators” points to the same governed disclosure used by the normal session, without reading hidden current physiology ahead of observation. Stopping the prototype preserves an incomplete session; a clinical endpoint is still an engine decision.

## D. File-level changes

| Files | Result |
|---|---|
| `src/ai/patient/flexiblePatient.js`, `.test.js` | V1 fact generator/replayer replaced by protected speech grammar, deterministic binder, veto, bounded retry, fallback and adversarial/numeric tests |
| `server/flexiblePatientGateway.mjs`, `scripts/flexiblePatientGateway.test.js` | Opt-in server route accepts only session ID and narrow visible projection, with existing provider/budget limits |
| `src/app/FlexiblePatientApp.jsx`, `src/app/session/renderPatientDialogue.js`, `src/app/session/flexibleSessionStorage.js` | Existing clinical hook reused; visible patient/staff speech and local review audit; V1 storage isolated; measured-state sidebar and limited learner download |
| `src/app/session/useSession.js`, `sessionPersistence.js`, `renderTurn.js` | Shared interpreter/engine entry point, separate V2 storage, exact clinical replay, current-status snapshot and additive historical audit migration |
| `src/core/session/createSession.js`, `src/core/state/worldState.js` | Internal V2 session demands approved patient-generation truth; derived calibration application history stays in existing reducer |
| `src/core/calibration/treatmentCalibration.js`, `.test.js`, `src/core/commands/executeCommand.js` | Reusable governed envelope extension with explicit timing/ranges/constraints/interactions and synthetic 100-seed tests; no APP-specific core branch |
| `src/core/time/advanceTime.js`, `boundedStateTransitions.js`, `scheduler.js` | Existing events carry calibration/seed/before/after evidence; due effects fold sequentially; explicit stochastic rates and constraints; no clinical timing defaults |
| `src/core/rules/contentConditions.js`, `scripts/buildContentIndex.mjs` | Candidate-state dependencies and build rejection for malformed approved response envelopes |
| `src/core/replay/exportSession.js`, `scripts/reviewFlexiblePatient.mjs` | Reviewer-only speech attempts and causal references; learner-facing export keeps hidden truth out |
| `src/app/session/flexibleGovernedJourney.test.js`, `e2e-flexible/patient.spec.js`, `playwright.flexible.config.js` | Full approved-content APP-004 path, old-artifact compatibility, desktop/mobile mock browser checks |
| `src/app/session/unifiedChat.js`, `src/ai/interpreter/semanticFirstInterpreter.js` | Browser-found conversation regressions repaired: explicit correction and short answer to a mentor question remain discussion, never orders |
| `README.md`, contract index/old addendum, `docs/REVIEWED_SIMULATION_CALIBRATION_V2.md`, two V2 review documents | Active authority and documented limits updated without changing the four base specifications |
| `scripts/smokeFlexiblePatient.mjs` | Unsafe V1 live generator disabled; new live-test plan documented but not run |

`src/app/App.jsx`, `ModeSelection.jsx`, `vite.config.js`, `package.json` are the prior opt-in UI/gateway integration retained for V2. Their earlier V1 wording was updated. Other project flows retain separate storage and routes.

## E. Calibration and content status

[Calibration structure](../REVIEWED_SIMULATION_CALIBRATION_V2.md) extends existing `response_envelope` and bounded transitions. Reviewed v2 content can declare fixed/ranged multi-variable deltas, distribution, onset, units, min/max/forbidden crossings, candidate-state dependencies and additive/once/no-overlap repeat policy. Named seeded draws and sequential due-event folding make the same seed/actions/time reproduce the same effects. Existing reviewed legacy envelopes retain their authored behavior for compatible replay. Status `draft`, `reviewed`, `pending` and `deprecated` is inert for **new** actions. Historical event folding does not revoke facts merely because content is later deprecated. Explicit approved finite complication rates are required for a roll; APP-004 currently has no active approved complication.

Only synthetic **TEST ONLY** values appear in the new 100-seed property tests. No APP-004 response magnitude, timing, deterioration probability or dose-response interval was invented. A response without a usable approved envelope is recorded as a simulator limitation; prescribing/administering the treatment remains a separate existing event.

## F. Model boundary

Input: speaker (`patient` or `staff`), one existing disclosed response, up to four recent learner/environment turns. No `patient`, `state`, `truth`, bundle, hidden diagnosis, future lab or calibration IDs are sent. Output: `variant` index plus bounded neutral framing slots. The complete clinical clause, including all numbers/units/qualifiers, is interpolated by code. Reviewer receives the candidate and authorized fact; it can veto but cannot supply facts. Patient rendering cannot produce mentor messages or execute actions. The price of this hard guarantee is **limited linguistic freedom**: arbitrary clinical paraphrase, inferred emotions and new follow-up answers are not accepted in V2. Further freedom requires reviewed fact-level templates and an independently proven binder; the current interface must not be described as unconstrained natural generation.

## G. Guard/fallback

Strict input/output shape, authorized variant index and local rebind prevent unsupported BP/HR/dose/unit/lab/time/resource/treatment text from reaching the learner, regardless of a permissive verifier. Invalid JSON, provider failure or veto consumes the attempt; maximum two render attempts, then original deterministic disclosure. Failed raw content remains only in reviewer audit, not the learner transcript or clinical event log. Transport failure similarly leaves the already executed clinical action intact and uses the original disclosure.

## H. Causal history and replay

Effect, course and recovery changes remain existing event types. Their payload includes calibration ID/version/source IDs, seed/stream/sample, changed-field before/effect/after, time and the original command/rule cause. Observation events determine when values become visible; renderer audit links speech to session/turn/state version/active calibration IDs and supplied visible facts. The `reviewFlexiblePatient.mjs` offline tool extracts attempts and event references from local persistence; it creates no duplicated clinical log. The normal full clinical export is reviewer-level evidence; the V2 UI learner download deliberately includes only shown text/time/status. Same-content restore re-executes recorded interpretations and compares the causal log. A pre-V2 clinical log may acquire **only additive audit metadata** after all prior clinical fields match; a changed clinical value causes restore failure. The original artifact stays untouched.

## I. APP-004 remaining gaps

- Stable preoperative `TRJ-STABLE` is an approved qualitative no-transition course; numerical spontaneous drift or deterioration is not calibrated.
- All seven APP-004 medication/fluid response envelopes are pending/null. Administered ketoprofen or fluid is recorded, but a numerical pain/BP/HR response is **not modeled**. This is a simulation limitation, never evidence of no real-world effect.
- Postoperative recovery is approved only as a qualitative bounded course. No numeric vitals/pain recovery curve, treatment interaction or physiologic discharge calibration was added. Active complication list is empty; withdrawn SSI rates remain inactive.
- Available patient answers are bounded by approved generated truth and content. Missing focused answers or unsupported resources remain limits. An old V1 free-form patient answer cannot become approved APP-004 truth by replaying it.
- Structured evidence/approval remains necessary for any wider disease phenotype, numerical effect, probability, KZ resource detail or multilingual clinical claim.

## J. Tests and evidence

Baseline before changes: `node --test 'src/**/*.test.js' 'scripts/**/*.test.js'`: **755 passed, 0 failed**. Final `npm run verify` includes `content:check`, `governance:check`, `npm test`, 52-case Wave-2 corpus, lint and build: **793 passed, 0 failed** in the unit/integration step; all subsequent steps passed. The new synthetic property run covers 100 seeds plus repeatability, bounds, forbidden normalization, interactions and simultaneous effects. `npm run test:e2e` **4/4**, `npm run test:e2e:flexible` **2/2**, `npm run test:e2e:mentor` **6/6**, `npm run test:e2e:semantic` **10/10** with fixture providers. The mentor/semantic suites initially exposed two conversation-routing failures and passed after focused repairs. V2 full APP-004 integration asserts history/focused question, exam/status, treatment/time/reassessment, operative/postoperative progression, restore and absence of fabricated medication effect. No live external model call was used; no credentials transmitted. The final UI panel change was checked by the focused browser suite (2/2) and lint; the prior full verify includes the same clinical runtime. The offline reviewer export was exercised with a synthetic persistence artifact (one response, one calibration event reference).

## K. Remaining risks and disposition

The language grammar prioritizes exact grounding and has a narrow expressive range; usability and naturalness need direct observation. APP-004 lacks approved numerical treatment-response calibration, so V2 cannot yet demonstrate clinically realistic pharmacodynamic or fluid response. Automatic tests show implementation/replay boundaries, not whether the authored course is medically representative, educationally safe or predictive of resident competence. A provider-level live renderer test, expert-labelled truth/dynamics/safety datasets and independent clinical decisions remain future work under the [validation plan](./CLINICAL_RELIABILITY_VALIDATION_PLAN_v0.1_2026-09-25.md). Technical status: ready for **scoped clinical reliability validation design/testing**, with local UI checks passed; clinical status: **not clinically validated**, no resident-pilot promotion from this wave. No commit, push or deployment was made.
