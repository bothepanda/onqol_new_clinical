# Interpreter v3 — Semantic Arbitration: Completion Report

Date: 2026-09-20 · Branch: `feat/onqol-vnext-clean-core` · Design: [INTERPRETER_V3_ARCHITECTURE.md](./INTERPRETER_V3_ARCHITECTURE.md)

## Verdicts (read this first)

| question | answer |
| --- | --- |
| Is the candidate eligible for freeze? | **No.** Blockers: clinician adjudication 0/233 rows, no independent gold review, 9 of 60 required real resident turns, and code/prompt/schema/registry/metrics are not frozen. |
| GO / NO-GO for the holdout | **NO-GO.** The holdout was not run and is untouched. Development numbers on draft gold cannot lift it. |
| Did the wave meet its engineering goals? | Yes: candidate-level validation, patient-question promotion, consultation policy, arbitration layer, promotion policy, telemetry, evaluation redesign, docs. All required regression cases A–J pass. |
| Is v3 better on the development set? | Yes, substantially — with two measured costs (below) and open failures that are structural, not tuning noise. |

## 1. What was built

Model output is still never authority. It may select an allowlisted concept and return verbatim evidence; every number and route is still bound from the learner's literal text; provider failure still fails closed; replay still never calls the model. The change is in **who decides between two valid readings**.

* **Candidate-level validation** (`actionCandidateValidation.js`): each `clinicalAction` and each `patientQuestion` gets its own `{decision: ACCEPT|CLARIFY|REJECT, reasonCodes, validatedCommand, evidenceSpans}`. The ACTION task is `valid` unless provider/schema/transport fails.
* **Patient questions** become ordinary `ASK_PATIENT` candidates through the same validation and downstream pipeline; no second execution path.
* **Consultation policy** (`semanticConsultationPolicy.js`): a narrow deterministic-only fast path for canonical forms; free-form, compound, negated/hedged or incomplete readings are semantic-eligible even when the deterministic pass produced commands. One structural measure (free tokens beyond the reviewed lexicon), not a second parser.
* **Arbitration** (`candidateArbitration.js`) with the required resolution sources; **promotion policy** (`promotionPolicy.js`) with the eleven promoted and eleven protected classes as data.
* **`modelConceptValidation.js` refactor**: structural/safety validation and semantic-language matching are separate exports; lexical data moved to `conceptGrounding.js` (data tables + one generic function). The legacy aggregate is rebuilt from the two parts and behaves identically for the frozen Wave 2/2.3 shadow path.
* **Telemetry**: consultation reason, deterministic candidates, proposed candidates, every candidate decision with reason codes, conflicts, arbitration resolutions, final commands with `resolutionSource`, model/provider metadata, latency, cost — recorded in the event log.
* **Evaluation redesign**: v3 corpus/metrics/evaluator/runner; deterministic-only and v3 reported separately; group-level counting; separate clinician-adjudication artifact; freeze-eligibility gate; holdout fingerprint verification.

## 2. Files changed

New (`src/ai/interpreter/`): `actionCandidateValidation.js`, `candidateArbitration.js`, `conceptGrounding.js`, `promotionPolicy.js`, `semanticConsultationPolicy.js`, `textMatch.js`, `interpreterV3.test.js`.
New (`scripts/`): `v3Corpus.mjs`, `v3Metrics.mjs`, `v3Evaluation.mjs`, `runV3Corpus.mjs`, `v3Evaluation.test.js`.
New (`docs/`): `INTERPRETER_V3_ARCHITECTURE.md`, this report; evidence `INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-20-run1.json` (valid), `INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-19-run1.json` (**invalid**, retained), `INTERPRETER_V3_RUN1_INVALIDATION_NOTE.md`, `INTERPRETER_V3_GOLD_ADJUDICATION.json` (template, all pending), provider journals.
Modified: `hybridInterpreter.js` (rewritten orchestration), `splitSemanticInterpreter.js` (`validationMode`, two prompt sentences), `modelConceptValidation.js` (refactor), `deterministicParameterBinder.js`, `deterministicInterpreter.js` (two boundary fixes), `server/aiGateway.mjs` (`limits` that can only lower a cap), `scripts/stage2Runtime.mjs` (budget file / limits parameters), `e2e-hybrid/interpreter.spec.js`, `.gitignore`, `docs/KNOWN_GAPS.md`.

Not touched: clinical truth, patient trajectories, reviewed rules, disease content, safety classifications (`HIGH_RISK_ACTIONS`), APP-004 calibration, scoring, mentor, replay semantics, the Stage 2 corpus/holdout/freeze manifest, the Stage 2 budget ledger (not reset or edited; run 1 consumed its remaining reservation headroom as an ordinary run, the clean run never touched it).

## 3. Contract behavior changed

1. **Deterministic commands are no longer automatically authoritative.** A validated, positively-evidenced semantic reading can replace a conflicting deterministic one, in promoted classes only.
2. **ACTION-task status.** In the hybrid path a rejected candidate no longer yields `concept_validation_failure`; the task stays `valid` and the rejection is a candidate decision. (The frozen Wave 2/2.3 shadow path keeps the old status: `validationMode: "legacy_strict"` is the default.)
3. **Patient questions execute** (as `ASK_PATIENT`) instead of being validated and dropped.
4. **Model consultation** no longer requires an unmatched fragment.
5. **Incomplete-but-recognised semantic commands** (a required parameter missing, or a concept removed for ambiguity) now reach the ordinary CLARIFY pathway instead of being silently dropped. This is also where the 7.1% inappropriate-clarification rate comes from.
6. **Lexical anchors are no longer the universal proof** for promoted classes: `test`, `region`, `topic` concepts are accepted on allowlisted id + verbatim evidence + evident action kind, unless a category term, an exclusion or a contradiction applies; concept-less promoted actions accept on substantive evidence. Drug, fluid, procedure, role, destination, intent, approach and choice identity stay **strict**.
7. **Evidence tolerance.** "Verbatim" now also accepts the same words in the same order that differ only in punctuation/spacing (a model dropping a comma). A changed word is still rejected.
8. **Two deterministic boundary fixes**: a trailing `!`/`?` no longer hides a route (`«в/м!»`, `«100 мг в/в!»`) or a bare region (`«живот!»`).
9. **Interpreter telemetry** grew (see architecture §9); `LEARNER_TURN_RECEIVED.semanticTelemetry` is larger and structured differently. `rejected[]` and `addedCommands` keep their old meaning for existing readers.
10. **`e2e-hybrid` spec**: the `concept_rejection` scenario now expects a hybrid turn with a candidate-level `REJECT` (`evidence_names_other_concept`) rather than a fallback with `errorCode: concept_validation_failure`.

## 4. Contract behavior preserved

Numeric/route binding from literal text or open clarification only; no parameter invention; model never executes or creates truth; tentative high-risk guard; allowlists for type, parameters and concept ids; injection protection; provider/schema/transport failure → deterministic fallback unchanged; replay from recorded final structured commands with no model or arbitration call (tested with a network bomb); CLARIFY-for-missing-parameter semantics; ordinary `validateCommand` → `executeCommand` for every command; Wave 2/2.3 shadow behavior and its tests; the Stage 2 frozen holdout.

## 5. Tests run

| suite | result |
| --- | --- |
| `npm run verify` (content check, `npm test`, wave-2 corpus, lint, build) | **pass**, exit 0 |
| `npm test` | **443 / 443** (baseline before this wave: 401) |
| new: `interpreterV3.test.js` (A–J, arbitration, policy, guards, replay) | 32 tests |
| new: `v3Evaluation.test.js` (holdout fingerprint, splits, metrics, adjudication, freeze gate, budget ceiling, holdout refusal) | 10 tests |
| `e2e-hybrid` (mocked gateway, desktop + mobile, 4 scenarios) | **8 / 8** on the final code. An earlier desktop `timeout` failure was load-induced (my live run in parallel); it passed alone and in the final run. |
| live development corpus, clean run | 183 rows, 0 provider failures — see §6 |

Required cases: **A** deterministic false positive corrected (`semantic_override`); **B** `CALL_STAFF` from «Коллеги» rejected, CBC survives; **C** novel patient question executes as `ASK_PATIENT`; **D** category language → CLARIFY, no guessed CRP; **E** compound partial success; **F** invented numeric/route rejected, nothing reaches a command; **G** tentative operation → no `START_PROCEDURE`/`OPERATIVE_DECISION`/`COMMIT_MANAGEMENT_PLAN`; **H** protected disagreement (`кетопрофен или кеторолак`) → clarification, neither executed; **I** timeout/auth/broken output → deterministic reading unchanged; **J** open-clarification ellipsis keeps inherited parameters, no model call.

## 6. Metrics — development split only, draft linguistic gold

Clean live run `INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-20-run1.json` · model `gpt-5-mini` · 183 rows in 94 base-intent groups (150 original Stage 2 development rows + 33 rows added for v3) · 139 consulted turns · 0 provider failures · candidate hashes recorded in the artifact and verified equal to the working tree.

| metric | deterministic-only | **v3** |
| --- | --- | --- |
| exact final command-set accuracy (row) | 49.2% | **87.4%** |
| exact final command-set accuracy (by group; a base intent counts once) | 52.1% | **85.1%** |
| command precision (committed commands) | 0.947 (54/57) | **0.976** (123/126) |
| command recall | 42.5% | **88.9%** |
| false executions (count / rate of executed) | 2 / 4.1% | **3 / 2.6%** |
| inappropriate clarification rate (count) | 4.5% (7) | **7.1% (11)** |
| semantic conflict resolution accuracy | n/a | **6 / 7** |
| parameter invention | 0 | **0** |
| high-risk false executions | 0 | **0** |
| patient-question accuracy (13 rows) | 7.7% | **69.2%** |
| provider fallback rate | n/a | **0%** |
| consultation rate | 0% | 76.0% |
| latency p50 / p95 | 0.3 / 0.6 ms | **2243 / 3183 ms** |
| cost (total / per turn / per consulted turn / projected 30-turn session) | $0 | **$0.152 / $0.00083 / $0.0011 / $0.025** |

Resolution sources over final commands: 65 `semantic_added`, 40 `deterministic_fast_path`, 29 `deterministic_preserved`, 15 `clarification`, 5 `semantic_override`. Injection rows: 0 commands. Stage 2-comparable view on the 150 original rows: paraphrase 37.5% → 82.3% (+44.8 pp), executed-command precision 1.0 (89/89).

**Read these numbers as diagnostic, not as evidence of generalization.** The original development rows tuned earlier candidates; gold is draft linguistic intent; and after the first (invalid) run I fixed four defects found on those same rows (§7) and re-ran on the same rows. The v3-specific rows were written by the same author as the fixes. The frozen holdout and real resident turns are the only honest test of generalization, and they have not been run.

## 7. What the first run taught (and the honest process note)

Run 1 (2026-09-19) is **invalid** and retained: a provider stall (one call ~508 s), instant local `provider_error`s, then the Stage 2 ledger's $5 reservation cap was exhausted — 31/183 fallbacks, concentrated in the rows added for v3. The 150 rows that ran cleanly were analysed offline (no new provider calls) and exposed four real defects, each fixed with a regression test: a model's generic `ASK_PATIENT{fasting}` overrode the dedicated `ASK_FASTING_HISTORY`; evidence differing only by punctuation was rejected; correct model answers for concept-less promoted actions were rejected by an anchor list; a trailing `!` hid a route/region from the deterministic matchers. An earlier e2e scenario also showed that relaxed grounding would accept "ultrasound" for the words «общий анализ крови», which produced the contradiction guard. When the ledger was exhausted I stopped and asked rather than reset it; the clean run used a **separate ledger** (`.onqol-interpreter-v3-budget.json`, $2.00 ceiling, same per-call/per-session limits) and the Stage 2 ledger was not reset or edited (run 1 used up its remaining headroom as a normal run; the clean run never touched it).

## 8. Unresolved failures (23 of 183 rows fail exact-match under v3; 0 rows where deterministic was right and v3 wrong)

| # | rows | failure | cause | status |
| --- | --- | --- | --- | --- |
| 1 | 9 | pelvic-ultrasound phrasings end in a clarification, gold expects `pelvic_ultrasound` | the id is recognised deterministically (honest "unsupported") but is not in the model allowlist; the model proposes the abdominal study and the exclusion guard correctly refuses it | open; content/allowlist decision, not an interpreter defect. This is 9 of the 11 inappropriate clarifications. |
| 2 | 4 | «уточню, когда последний раз ел», «скажите, аллергия…»: correct command, but a dangling verb fragment stays "unresolved" | deterministic pass cannot attach a bare verb; arbitration does not consume it | open |
| 3 | 3 | **false execution**: `«осмотрите живот ультразвуком»` executes `EXAMINE`; `«сделайте визуализацию живота»` executes `EXAMINE`; `«может быть, сделаем КТ позже»` executes CT | (a) two free tokens keep it on the fast path; (b) model reads imaging as examination and no deterministic reading disagrees; (c) deterministic hedge false positive that the model concurs with | open; structural (architecture §12) |
| 4 | 1 | «Обсуждаю, а не назначаю кетопрофен» → dose clarification | deterministic negation false positive; model silent | open; arbitration cannot act on silence |
| 5 | 2 | «кетопрофн 100 мг в/м», «ктшку обп» | drug/procedure identity is strict-lexical by design; typo not rescued | by design |
| 6 | 2 | «Коллеги, ничего не давать через рот», «нпо» | model chose an unlisted type / returned nothing (non-deterministic across runs) | open |
| 7 | 2 | «ультразвуком осмотрите брюшную полость», «хочу увидеть воспалительные показатели» | model chose `EXAMINE`; model chose CRP for a category and it was (correctly) refused | safe failure, open |

None involves a parameter invention, a protected-class execution, an injection or a provider failure.

## 9. Decisions I made that you may want to change

* **Unlisted command types** (`WAIT`, `ORDER_ORAL_INTAKE`, `REQUEST_ANESTHESIA_REVIEW`, `OBTAIN_CONSENT`, `REPEAT_LAST`, `END_CASE`) are **default-deny** (treated as protected). The brief listed promoted and non-promoted classes but not these.
* **Protected classes may still be *added*** by the model when there is no clash and every parameter is literal and strictly grounded (the pre-v3 behavior, kept). If you read "no silent replacement" as "no model-originated protected command at all", that is one line in `candidateArbitration.js`.
* **Override requires positive lexical evidence** (`lexical`/`composite` grounding), stricter than "fully validated". Without it a merely plausible model cannot overturn an explicit deterministic reading.
* **Protected deterministic command in disagreement with a different-type reading is withheld** and the fragment returned as unresolved (not silently executed, not asked about), because a same-type clarification has no natural question.
* **Consultation heuristic** (`≤2` free tokens, negation/hedge markers) is my design; threshold and marker list are tunable data, and the free-token limit is why failure 3(a) exists.
* **Two prompt sentences** were added to the ACTION prompt (category → `ambiguous_target`; one action per distinct learner action). The prompt hash changes; nothing depends on the old one.

## 10. Before any formal GO

1. Collect the planned real resident turns (≥60; 9 today).
2. Clinician adjudication of gold (`INTERPRETER_V3_GOLD_ADJUDICATION.json`, 0/233) and an independent review.
3. Decide on failures 3(b), 3(c) and 4 — they are the ones that execute something the learner did not ask for. They likely need either a deterministic hedge/negation rule or a model-side "negated/deferred action" field, each a design change.
4. Freeze code, prompt, schema, concept registry and metrics (hashes are already recorded per run), then run the untouched grouped holdout **once**. Any post-hoc change invalidates the freeze.
