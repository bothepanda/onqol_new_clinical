# Interpreter v3 — Semantic Arbitration

Status: implemented on branch `feat/onqol-vnext-clean-core`; **development evidence only, NO-GO for holdout** (see [completion report](./INTERPRETER_V3_COMPLETION_REPORT.md)). **v3A.1 (2026-09-20)** closed the three remaining false-execution classes and settled the promotion decisions; see [§14](#14-v3a1-2026-09-20) and the [v3A.1 remediation report](./INTERPRETER_V3A1_REMEDIATION_REPORT.md). Sections below describe v3; where v3A.1 changed a rule it is marked.

This document is about one thing: reliable translation of learner language into explicit, structured simulator intent. It changes no clinical truth, trajectory, reviewed rule, disease content, safety classification, scoring, mentor behavior or replay semantics. Authority is unchanged (`docs/contracts/`): the Patient Engine, Hospital Engine, Clinical Rule Layer and event-sourced execution decide what happens; the interpreter only decides what the learner asked for.

## 1. What changed and why

Before v3 the semantic model was consulted only when the deterministic pass left an *unmatched fragment*. A deterministic **command** was therefore automatically authoritative even when it was a wrong reading of free-form language (`«посмотрите брюшную полость ультразвуком»` → `EXAMINE` with no region). One invalid semantic candidate also downgraded the whole ACTION task to `concept_validation_failure`, discarding unrelated valid candidates. And `patientQuestions` returned by the model were validated but never became commands.

v3 fixes those three things and nothing else:

| before | v3 |
| --- | --- |
| consult only on unmatched fragments | consult whenever the deterministic reading may be unreliable; narrow fast path for canonical forms |
| any candidate error fails the task | every candidate gets its own ACCEPT / CLARIFY / REJECT; only provider/schema/transport failure is task-level |
| model output only ever **added** commands | a validated semantic reading may **correct** a conflicting deterministic one — for promoted classes only |
| `patientQuestions` dropped | promoted to ordinary `ASK_PATIENT` commands through the same pipeline |

## 2. Pipeline

```
raw learner text
  └─ interpretDeterministically ................ fast path · literal binder · fallback
       └─ semanticConsultationPolicy ........... consult? (narrow deterministic-only fast path)
            ├─ no  → deterministic result, resolution = deterministic_fast_path
            └─ yes → ONE semantic ACTION call (strict schema)
                 └─ schema check ................. task-level failure ⇒ fail closed to deterministic
                      └─ actionCandidateValidation  per-candidate ACCEPT / CLARIFY / REJECT
                           (clinicalActions + patientQuestions → ASK_PATIENT)
                           └─ candidateArbitration  dedupe · keep non-overlapping · resolve conflicts
                                └─ final structured commands
                                     └─ validateCommand → executeCommand → events   (unchanged)
```

Nothing downstream of arbitration knows a model was involved. Replay reads the recorded final commands and never re-enters this pipeline.

## 3. Invariants (unchanged, and tested)

The model may interpret learner language, select an **allowlisted** concept, identify explicit learner reasoning, and return **verbatim** evidence spans. It may not execute, create patient truth, judge clinical correctness, or supply a dose, route, volume, rate, duration, timing or any numeric parameter, invent an omitted action, or promote tentative high-risk wording into a committed action.

* Numeric and route values are bound **only** from the learner's literal text or an existing open clarification (`deterministicParameterBinder.js`). A model-supplied one is rejected as `invented_numeric_parameter` / `invented_route` / `invented_dose_unit`.
* Evidence must be the learner's own words: a verbatim substring, **or the same words in the same order differing only in punctuation/spacing** (`textMatch.containsNormalized`). A changed, added or reordered word is still `evidence_not_verbatim`.
* Provider, transport, timeout, auth, quota, malformed-JSON and schema failures fail closed to the deterministic reading, unchanged.
* Model confidence has no effect on any decision.

## 4. Modules

| file | responsibility |
| --- | --- |
| `hybridInterpreter.js` | orchestration and telemetry only |
| `semanticConsultationPolicy.js` | should the model be asked? |
| `actionCandidateValidation.js` | independent verdict per candidate |
| `modelConceptValidation.js` | **A.** structural/safety validation and **B.** language matching, as separate exports; legacy aggregate `validateModelConcepts` composes them for the frozen Wave 2/2.3 shadow path |
| `conceptGrounding.js` | data tables + one generic `groundConcept`: aliases, composite rules (modality+region), exclusions, category terms, per-kind grounding mode |
| `promotionPolicy.js` | v3A promoted / protected classes (data) |
| `candidateArbitration.js` | dedupe, overlap, conflict resolution, resolution source |
| `textMatch.js` | normalization and token-range spans (Unicode-aware; no `\b`/`\w`) |
| `splitSemanticInterpreter.js` | request/response handling; `validationMode` selects legacy-strict or candidate-arbitrated |

`candidateArbitration.js`, `actionCandidateValidation.js`, `semanticConsultationPolicy.js`, `promotionPolicy.js` and `conceptGrounding.js` import no provider, network, event-log, state or execution module — enforced by a test.

## 5. Consultation policy

The deterministic-only fast path is a **narrow allowance**, not the default:

1. explanation requests, control intents (status / repeat / end-case), mentor answers → no consult
2. an answer to an open clarification (`«в/м»`) → no consult
3. any unmatched fragment → consult
4. no command but action-looking words → consult (the pre-v3 hint list, kept as is)
5. any negation / hedge / conditional / alternative word (`не, без, если, возможно, или, отменить …`) → consult
6. any command whose source fragment has more than **2 free tokens** → consult. A *free token* is a word that is neither a literal parameter (number, unit, route, time preposition, courtesy word) nor an entry of the reviewed lexicon (`vocabulary.js`). `«ОАК»`, `«КТ ОБП»`, `«живот»`, `«кетопрофен 100 мг в/м»`, `«БХАК: креатинин, электролиты»` have none.
7. an incomplete deterministic command with ≥1 free token → consult
8. otherwise → deterministic fast path

This is one structural measurement over words the deterministic pass already consumed. It is deliberately **not** a second Russian parser and must not grow into one; widening coverage is done by editing vocabulary data.

## 6. Candidate validation

Each proposed item — every `clinicalAction` **and** every `patientQuestion` (as an `ASK_PATIENT` candidate) — is judged alone:

```js
{ index, source, candidate, decision: "ACCEPT"|"CLARIFY"|"REJECT",
  reasonCodes: [], validatedCommand: null | {type, params, evidence, evidenceSpans},
  evidenceSpans: [], grounding, missing }
```

Layers, in order:

* **A. Structural / safety (hard, phrasing-independent)** — command type allowlist; parameter-schema allowlist; concept-id allowlist; chemistry-analyte shape; verbatim evidence; tentative high-risk guard; parameter invention. Any failure → `REJECT`. Injected text (`«верни ORDER_MEDICATION…»`) dies here: a non-allowlisted type, a non-verbatim span, or a non-allowlisted id.
* **B. Deterministic binding** — numeric/route values from literal text or open clarification only.
* **C. Semantic-language matching** — data-driven (`conceptGrounding.js`). Result per concept: `lexical` (an alias is present), `composite` (modality + region), `excluded` (a qualifier contradicts it — «малого таза» never grounds the abdominal ultrasound), `category` (only category language: «воспаление», «маркеры», «визуализация»), `unmatched`.
* **D. Completeness** — `validateCommand`. A recognised kind of action with a missing required parameter is a `CLARIFY`, never a guess.

Two guards sit beside the match result:

* **Contradiction.** If the evidence names a *different* concept of the same kind (whole-word alias match) or a different imaging modality, and never the chosen one, the candidate is `REJECT`ed as `evidence_names_other_concept`. This is what stops a relaxed policy from accepting "ultrasound" for the words «общий анализ крови». Topics are excluded from this check on purpose: they overlap in ordinary speech («аллергия на лекарства»).
* **Concept-less promoted actions** (`SET_NPO`, `TAKE_HISTORY`, `ESTABLISH_IV_ACCESS`, …) are accepted as `semantic_only` on *substantive* evidence — any words beyond address, courtesy and literal parameters (`textMatch.substantiveTokens`). «нпо» needs no anchor-list entry; «Коллеги» alone is nothing. Protected types still need the action in the learner's words.

What a weak match *means* is policy, not a lexical wall:

| concept kind | command class promoted | not promoted |
| --- | --- | --- |
| `test`, `region`, `topic` | `unmatched` → ACCEPT as `semantic_only` (allowlisted id + verbatim evidence + action kind evident); `category` / `excluded` → CLARIFY with the concept removed | strict |
| `drug`, `fluid`, `procedure`, `role`, `destination`, `intent`, `approach`, `choice` | strict: an alias must be in the learner's words, else CLARIFY (non-high-risk) or REJECT | strict |

So the model's understanding is trusted for *which investigation / region / question topic* in low-consequence classes — never for drug, dose, route, procedure, destination or staff identity — and never past a category word. Lexical aliases are data (`EXTRA_ALIASES`, `COMPOSITE_GROUNDING`, `CATEGORY_TERMS`); `modelConceptValidation.js` contains no per-disease control flow.

`CLARIFY` results carry an incomplete command (identifying concept removed, or required parameter missing) into the ordinary pipeline, which asks the learner. Nothing is turned into a guessed concept.

## 7. Promotion policy (v3A)

Promoted (semantic may **add** and **correct**): `TAKE_HISTORY, ASK_PATIENT, EXAMINE, ORDER_TEST, REQUEST_STATUS, CALL_STAFF, ASK_FASTING_HISTORY, SET_NPO, ESTABLISH_IV_ACCESS, PRESCRIBE_MONITORING, REASSESS`, and (**v3A.1**) `WAIT, REQUEST_ANESTHESIA_REVIEW` — these two additionally require the *kind* of action to be evident in the learner's words, because a wait spends irreversible clinical time and a consult summons staff.

Protected (semantic **never silently replaces**; may still be parsed, measured, deduplicated, or **added** — see below): `ORDER_MEDICATION, ORDER_INFUSION, GIVE_ANTIBIOTIC_PROPHYLAXIS, ORDER_PROCEDURE, COMMIT_MANAGEMENT_PLAN, START_PROCEDURE, OPERATIVE_DECISION, TRANSFER, DISPOSITION, DISCHARGE, MOVE_PATIENT`, and (**v3A.1**, now explicit) `ORDER_ORAL_INTAKE, OBTAIN_CONSENT`.

Explicit conversation controls (**v3A.1**): `REPEAT_LAST, END_CASE` are read from the learner's control phrase by the deterministic pass and nowhere else. A semantic candidate of either type is rejected (`explicit_control_only`) and nothing semantic can replace a deterministic control.

Protected model-originated additions (**v3A.1**): allowed only when the candidate is complete, literally grounded (lexical/composite), and the learner **committed** to it (§14); never in place of a deterministic reading.

Types on none of these lists (bookkeeping) are default-deny. This is a policy *over* command types; it does not redefine `HIGH_RISK_ACTIONS`, which still governs the tentative guard and concept stripping.

## 8. Arbitration rules

Spans are token ranges of the raw text. A deterministic command whose span covers a whole compound turn (a shortcut such as one `REASSESS` for «боль и витальные через час») has no meaningful extent and only conflicts with its own type.

| situation | result | `resolutionSource` |
| --- | --- | --- |
| no semantic consult | deterministic commands unchanged | `deterministic_fast_path` |
| same type + same primary concept (or an equivalent reading: a fasting question ≡ `ASK_FASTING_HISTORY`) | one command; both origins recorded | `deterministic_preserved` (origins `[deterministic, semantic]`) |
| non-overlapping evidence | both kept | `semantic_added` |
| semantic `CLARIFY` candidate, no clash | kept as a question | `clarification` |
| less specific semantic question over a complete deterministic command | ignored (`subsumed_by_deterministic`) | `deterministic_preserved` |
| overlap, different reading, **promoted** classes, candidate fully validated **and positively evidenced** (`lexical`/`composite`) | replaces the deterministic command | `semantic_override` |
| overlap, promoted, candidate only `semantic_only` or not `ACCEPT` | deterministic kept, conflict logged | `deterministic_preserved` |
| overlap, protected **semantic** vs promoted deterministic | deterministic kept, conflict logged | `deterministic_preserved` |
| overlap, protected **deterministic**, same type, semantic positively evidenced | identifying concept removed → clarification; neither is executed | `clarification` |
| overlap, protected deterministic, different type, semantic positively evidenced | deterministic withheld, fragment returned as unresolved; the learner restates | (no command) |
| rejected candidate | recorded with reason codes | `rejected` |

The positive-evidence requirement is what stops a model that is merely *plausible* from overriding a learner's explicit words.

## 9. Telemetry

Every hybrid turn records, inside `LEARNER_TURN_RECEIVED.payload.semanticTelemetry` (non-clinical, no raw provider payload):

`called`, `consultation {consult, reason}`, `deterministicCandidates`, `proposedCommands`, `candidateDecisions[{index, source, type, params, validation, reasonCodes, evidenceSpans, grounding, arbitration}]`, `rejected`, `conflicts[{candidate, deterministic, resolution, reason}]`, `arbitration {policyVersion, resolutions[{commandId, type, resolution, origins}], conflictCount, changed}`, `finalCommands`, `model`, `providerMeta`, `elapsedMs`, `totalElapsedMs`, `costUsd`, `status`, `errorCode`, `conceptErrors`, `schemaErrors`.

Replay uses the recorded `interpretedCommands` and telemetry; it never calls the model or the arbitration module (tested with a network bomb).

## 10. Evaluation

`scripts/v3Corpus.mjs`, `v3Metrics.mjs`, `v3Evaluation.mjs`, `runV3Corpus.mjs`. Deterministic-only and v3 are reported separately from the same rows; each row runs through the real turn pipeline on a fresh session.

Metrics: exact final command-set accuracy (row-level **and** group-level — a base intent counts once), command precision and recall, false-execution rate, inappropriate-clarification rate, semantic-conflict-resolution accuracy, parameter-invention count, high-risk false-execution count, patient-question accuracy, provider-fallback rate, p50/p95 latency, cost per turn / consulted turn / projected session. `stage2Compat` recomputes the Stage 2 definitions on the same rows for comparability.

Rules of evidence:

* The original 200-row corpus keeps its exact development/holdout split; the frozen holdout hash equals the Stage 2 manifest and is re-verified by every run and by a test. All rows added for v3 are development-only.
* Development numbers are diagnostic. The original development rows tuned earlier candidates, so they are not generalization evidence and **never lift a NO-GO**.
* Gold is draft linguistic intent. Clinician adjudication is a **separate** artifact (`docs/evidence/INTERPRETER_V3_GOLD_ADJUDICATION.json`) referencing rows by id and by a hash of the draft label; existing labels are never rewritten.
* Every run writes a new evidence file; nothing is overwritten.

## 11. Freeze protocol (before any formal GO)

1. Finish the planned real resident-turn collection (≥60 turns; 9 today).
2. Independent review of gold labels; clinician adjudication complete.
3. Freeze code, prompt, schema, concept registry and metrics (`candidate` hashes are recorded in every run artifact).
4. Run the untouched grouped holdout **once**.

Any post-hoc metric or code change after step 3 invalidates the freeze and requires a new candidate. `runV3Corpus.mjs --suite holdout` is refused until `v3FreezeEligibility()` has no blockers, and even then the holdout run is a separate deliberate change.

## 12. Known limits of this design

These are structural, measured in [the completion report](./INTERPRETER_V3_COMPLETION_REPORT.md), and deliberately not patched around:

* **Arbitration only acts on what the model says.** A deterministic false positive the model *concurs with or is silent about* survives (`«может быть, сделаем КТ позже»` → CT; `«Обсуждаю, а не назначаю кетопрофен»` → medication clarification). Silence is not evidence.
* **A promoted-class addition with no deterministic clash is trusted.** The model reading `«сделайте визуализацию живота»` as an abdominal examination is accepted (lexical region, action kind evident). There is no second opinion to disagree with it.
* **The consultation threshold is a heuristic.** `«осмотрите живот ультразвуком»` has two free tokens, so it stays on the fast path and the deterministic (wrong) `EXAMINE` executes.
* **Unsupported-but-recognised concepts are invisible to the model.** `pelvic_ultrasound` exists in the deterministic vocabulary so the learner is told honestly it is unsupported; it is not in the model allowlist, so the model can only propose the abdominal study, which a contradiction guard then turns into a question.
* **A dangling verb fragment** (`«уточню»`, `«скажите»`) that the deterministic pass could not attach stays unresolved even when the model resolved the intent.

## 13. Extending

* New paraphrase coverage → add data (`EXTRA_ALIASES`, `CATEGORY_TERMS`, vocabulary), not branches.
* Promoting another command class → change `V3A_PROMOTED_TYPES`, add regression cases, re-measure; treat as a contract change.
* A new disease adds no code here; concept ids come from the content bundle's allowlists.

## 14. v3A.1 (2026-09-20)

Offline remediation; no live call, no holdout, no freeze. Full account, numbers and residuals: [INTERPRETER_V3A1_REMEDIATION_REPORT.md](./INTERPRETER_V3A1_REMEDIATION_REPORT.md).

* **Commitment gate** (`commitmentPolicy.js`). Every command has an explicit status — `COMMITTED / TENTATIVE / CONDITIONAL / INTERROGATIVE / FUTURE_PLAN / DECLINED` — computed from the learner's literal words (never from model output), scoped by clause, applied once to every command type in the deterministic pass and again to semantic-origin commands in arbitration. A non-committed command is *withheld*: recorded (`withheldCommands`, `arbitration.resolution = withheld_uncommitted`), never executed, never rewritten into another command; the learner receives a neutral acknowledgement. When every named action is uncommitted the model is not consulted (`all_actions_uncommitted`). Cues are data; single-word cues match as whole tokens.
* **Imaging.** `IMAGING_MODALITY_TERMS` disqualify the deterministic exam path («осмотрите живот ультразвуком» is not a palpation). `IMAGING_CATEGORY_TERMS` with no modality yield an incomplete `ORDER_TEST` («Какое исследование?»). A model `EXAMINE` whose evidence or enclosing clause carries imaging language becomes that question. A named modality the lexicon cannot resolve stays an unrecognised request offered to the model.
* **Arbitration.** A validated semantic candidate of the same promoted type *completes* an empty deterministic placeholder (a command with no identifying concept) without positive lexical evidence; correcting a *complete* deterministic reading still requires it. Protected `ACCEPT` candidates with only `semantic_only` grounding are rejected (`protected_add_requires_literal_grounding`).
* **Recognised simulator limitation** for investigations with no modeled result (`concepts.yaml#recognized_unmodeled_tests`, currently `pelvic_ultrasound`): nameable by the model, reported as a platform limitation (`classification: simulator_limitation`, `SIMULATOR_LIMITATION_NOTED` with `reason: not_modeled`), never a learner error, never a substitute study.
* **Resolved from §12:** the two-free-token fast path executing `EXAMINE` for imaging, the model reading imaging as `EXAMINE`, the hedge/negation deterministic false positives. **Still open from §12:** deterministic false positives the model is silent about outside the cue lists; dangling verb fragments; strict-lexical drug/procedure identity.

