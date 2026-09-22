# Interpreter v3A.1 — final offline remediation

Date: 2026-09-20 · Branch: `feat/onqol-vnext-clean-core` · Builds on: [v3 completion report](./INTERPRETER_V3_COMPLETION_REPORT.md), [v3 architecture](./INTERPRETER_V3_ARCHITECTURE.md)

Scope was one offline remediation. **No live provider call was made, no live tuning loop was started, the holdout was not run (its fingerprint was only verified), and nothing was frozen.**

## Verdicts

| question | answer |
| --- | --- |
| Are the three false-execution classes fixed? | **Yes, in the code paths I control** (deterministic pass, candidate validation, arbitration, one gate). Whether the *live model* now proposes the right thing for the new prompt/allowlist is **not measured** and cannot be offline. |
| Offline verification | `npm run verify` (content check, unit/integration tests **498**, Wave 2 corpus, lint, build) **pass**; `test:e2e` 4/4; `test:e2e:hybrid` 8/8. |
| Freeze / holdout | **Not eligible, NO-GO stands.** Blockers (from `node scripts/freezeReadiness.mjs`): clinician adjudication 0/242, no independent blind labels 0/242, real resident turns 9/60, candidate not frozen. |
| Do the diagnostic numbers lift NO-GO? | **No.** They are development rows that tuned earlier candidates, replayed with model responses recorded under the *previous* prompt. |

## 1. What changed, by requirement

| requirement | change | where |
| --- | --- | --- |
| `WAIT`, `REQUEST_ANESTHESIA_REVIEW` promotable | added to the promoted list; both additionally need the *kind* of action evident in the learner's words (`KIND_MUST_BE_EVIDENT`), because a wait spends irreversible clinical time and a consult summons staff | `promotionPolicy.js`, `actionCandidateValidation.js` |
| `ORDER_ORAL_INTAKE`, `OBTAIN_CONSENT` protected | now on the protected list explicitly (previously default-deny by omission) | `promotionPolicy.js` |
| `REPEAT_LAST`, `END_CASE` explicit controls only | a semantic candidate of either type is rejected (`explicit_control_only`); the deterministic control phrase is tightened so «повторите ОАК» is a repeat-the-test order, not a control | `promotionPolicy.js`, `actionCandidateValidation.js`, `deterministicInterpreter.js` |
| protected model-originated additions | added only when complete, literally grounded (lexical/composite), and COMMITTED; never replace a deterministic reading (unchanged) | `candidateArbitration.js` |
| keep positive grounding for override, no second parser | override still requires `lexical`/`composite`; nothing was added to the grounding tables except the pelvic composite rule | `candidateArbitration.js`, `conceptGrounding.js` |
| **F1** generic imaging language, unspecified modality → imaging clarification, not `EXAMINE` | deterministic: category words («визуализация», «снимок») with no modality → incomplete `ORDER_TEST` («Какое исследование?»). Semantic: a model `EXAMINE` whose evidence *or enclosing clause* carries imaging language is turned into that same question (`imaging_language_not_examination`) | `deterministicInterpreter.js`, `actionCandidateValidation.js`, `vocabulary.js` (`IMAGING_*`) |
| **F2** explicit modality token disqualifies the physical-exam fast path | the exam path is skipped when any imaging-modality word is in the fragment (all modalities, modeled or not); the unresolved fragment goes to the semantic pass instead of executing an examination | `deterministicInterpreter.js` |
| **F3** commitment status, explicit and generic | one enum (`COMMITTED / TENTATIVE / CONDITIONAL / INTERROGATIVE / FUTURE_PLAN / DECLINED`), one gate applied to every command type in both the deterministic pass and semantic arbitration. A non-committed command is **withheld**, recorded with status and cues, never executed and never rewritten into another command. The learner gets a neutral acknowledgement | `commitmentPolicy.js` (new), `deterministicInterpreter.js`, `candidateArbitration.js`, `hybridInterpreter.js`, `submitLearnerTurn.js`, `renderStatus.js`, `useSession.js` |
| pelvic ultrasound | see §3 | content, allowlist, executor, debrief, renderer |

### The commitment gate in one paragraph

Status is computed from the learner's **literal words**, never from model output, so the model can neither create nor waive it. Cues are function-word classes (hedge, condition, deferral, question form, refusal of the act), not a second parser. Scope is the clause: a cue affects its own fragment; a leading cue-only clause («Если станет хуже, …», «Возможно, …») affects the fragments after it in the *same sentence*; a trailing one («КТ, если понадобится») the nearest preceding action. «КТ без контраста» is untouched. Explicit-commitment words («решил», «точно», «всё же») lift a hedge or deferral, never a condition, question or refusal. Pure inquiries (`ASK_PATIENT`, `TAKE_HISTORY`, `ASK_FASTING_HISTORY`) ignore the question form; pure reads (`REQUEST_STATUS`, `REPEAT_LAST`) and bookkeeping are exempt; an authored operative-decision phrase that contains a negation is not read as a refusal; the nil-by-mouth order is not refused by its own «не давать». Single-word cues match as whole tokens (see §5, bug 1).

### Recorded per turn

`LEARNER_TURN_RECEIVED.payload` now carries `interpretedCommands[].commitment = "COMMITTED"` (everything that executes) and `withheldCommands[] {type, params, sourceText, commitment{status, cues, scope}}`; the export carries `withheldCommands`; semantic telemetry carries them too, and a withheld candidate has `arbitration.resolution = "withheld_uncommitted"`.

## 2. Decisions I made that you may want to change

1. **Refusal («не назначаю КТ», «отмените КТ», «КТ не нужен») is a sixth status, `DECLINED`.** You listed four; I added refusal because the same gate needed it and it was the cause of the open «Обсуждаю, а не назначаю кетопрофен» failure. It is a narrow phrase list, not a negation parser.
2. **A question mark on an order is a question.** «КТ обп?» is withheld. Inquiry types (asking the patient) are exempt. If residents habitually end orders with «?», this will be the first thing to show up in real turns.
3. **Sequencing words defer**: «Сначала ОАК, затем КТ» orders ОАК and withholds КТ. Bare «планирую» and «хочу» are *not* cues (residents use them to state an order).
4. **Protected candidates that need a question** («which drug?») are still allowed as clarifications when committed; only executable protected additions need full literal grounding.
5. **A validated semantic candidate completes an empty deterministic placeholder** (a same-type command with no identifying concept, e.g. `EXAMINE{}`) without positive lexical evidence; a *complete* deterministic reading still needs positive evidence to be corrected. Logged as `completes_incomplete_deterministic`, resolution `semantic_added`.
6. **A named imaging modality the lexicon cannot resolve is *not* turned into «Какое исследование?»** («ультразвуком осмотрите живот»): the learner already answered that. It stays an unrecognised request and is offered to the model. I first built it the other way; the replay showed deterministic-only inappropriate clarifications rising 7 → 31, so I narrowed it.
7. `pelvic_ultrasound` (the existing id) was kept rather than introducing `ultrasound_pelvis`.

## 3. Pelvic ultrasound: determination

**No approved modeled `ultrasound_pelvis` (or `pelvic_ultrasound`) result exists for APP-004.** Evidence: `trajectories.yaml#investigation_timing` models exactly `cbc, chemistry, crp, urinalysis, betahcg, coagulation, blood_group_rh, ultrasound_abdomen, ct_abdomen`; APP-004 is the retrocecal phenotype; the only pelvic-ultrasound text in content is one sentence inside the *abdominal* ultrasound report of the `pelvic` phenotype (APP-003, not the pilot case) — not a separate study, and it has no reviewed provenance as one. A test pins this (`no disease content defines one`).

So it is represented as a **recognised simulator limitation**:

* `concepts.yaml#recognized_unmodeled_tests` lists it; the model allowlist gains `recognizedUnmodeledTests` (nameable, never a modeled result). If a future case adds it to `investigation_timing` it becomes an ordinary supported test with no interpreter change (tested).
* Ordering it → `UNSUPPORTED_CONTENT` with `classification: "simulator_limitation"`, a `SIMULATOR_LIMITATION_NOTED` event (`kind: investigation_not_modeled`, `reason: not_modeled`), a message that names the study and says it is a platform limit, not a mistake, and suggests **no alternative test**; the debrief lists it under simulator limitations with its own note and does **not** count it as withheld clinical content.
* The abdominal study is never substituted in either direction (composite/exclusion/contradiction guards, tested).
* Reported wording is `pelvic_ultrasound`; changing the id is a content decision, not an interpreter one.

## 4. Diagnostic recomputation (offline, no network)

`node scripts/replayV3RecordedRun.mjs` replays the **recorded** model responses of `INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-20-run1.json` (read back from its provider journal; `fetch` is replaced by a bomb) through the **current** code on the same 183 development rows. Output: `docs/evidence/INTERPRETER_V3A1_OFFLINE_REPLAY_DEVELOPMENT_2026-09-20.json`.

| development rows (183, draft linguistic gold) | v3 recorded | **v3A.1 replay** | deterministic-only recorded → replay |
| --- | --- | --- | --- |
| exact final command set (row) | 87.4% | **89.1%** | 49.2% → 51.4% |
| exact final command set (group) | 85.1% | **88.3%** | 52.1% → 55.3% |
| command precision | 0.976 | **1.000** | 0.947 → 0.982 |
| command recall | 88.9% | **89.5%** | 42.5% → 43.8% |
| false executions | 3 | **0** | 2 → 0 |
| inappropriate clarifications | 11 | **10** | 7 → 0 |
| parameter invention / high-risk false executions | 0 / 0 | 0 / 0 | 0 / 0 |
| rows fixed / regressed | — | **3 / 0** | — |

**Read these as diagnostic, not as evidence.** (a) Same development rows that tuned earlier candidates. (b) The recorded responses predate the new prompt sentences and the pelvic allowlist entry, so the replay cannot show what the model does now. (c) One row (`v3-001`, «осмотрите живот ультразвуком») was on the fast path in the recorded run and so has no recorded response; it is replayed deterministically only. (d) The regression tests were written by the same author as the fixes. (e) `v3Metrics.mjs` was not changed; its "high-risk" count uses the promotion policy, so `REQUEST_ANESTHESIA_REVIEW` (now promoted) no longer counts as high-risk there. **No development-set fix was made from these numbers** other than the two bugs in §5, both found *by the replay before it was reported* and both defects of the new gate itself.

## 5. Bugs found while doing this (all fixed, each with a regression test)

1. **My own gate, caught by the replay:** the hedge cue «пожалуй» (*perhaps*) stem-matched «пожалуйста» (*please*) and withheld every polite request (28 regressions, exact accuracy 87.4% → 73.8%). The same family — a cue that is the prefix of a common unrelated word (`потом`/«потому что», `возможно`/«возможность», `допустим`/«допустимо») — is now matched as whole tokens.
2. **Pre-existing, found while writing the WAIT tests:** «подождём полчаса» was read as **60 minutes** (`час` inside «полчаса»); «пару часов» as 1 hour. A wait spends irreversible time, so the amount is now read exactly (explicit number, «час» alone, «полчаса» = 30) or not at all.
3. **Pre-existing:** «опрос» matched inside «вопрос» / «попросил» and executed `TAKE_HISTORY` («Я бы попросил ОАК»). Left-bounded.
4. `не нужен` was not recognised as a refusal (stem mismatch); the courtesy idiom «если можно» is no longer reported as an unrecognised request.

## 6. Residual failures

### 6a. The 20 development rows that still fail exact-match (after replay)

| rows | what | why | safe? |
| --- | --- | --- | --- |
| 9 (`stage2-055…063`) | pelvic-ultrasound phrasings end in «Какое исследование?» | the recorded model could not name `pelvic_ultrasound` (not allowlisted then). Live, with the new allowlist, it *may* — **unverified** | yes; nothing executes |
| 2 (`v3-001`, `v3-002`) | «осмотрите живот ультразвуком», «ультразвуком осмотрите брюшную полость» | were **false executions** (`EXAMINE`); now nothing executes. `v3-001` unresolved (no recorded response); `v3-002` clarifies because the recorded model chose `EXAMINE`. A live model told «imaging is never an examination» should name the ultrasound — **unverified** | yes |
| 4 (`stage2-094…096`, `v3-009`) | correct command executes but a dangling verb («уточню», «скажите») stays "unrecognised" | deterministic pass cannot attach a bare verb; unchanged known limit | yes |
| 2 (`stage2-101`, `stage2-168`) | «ничего не давать через рот», «нпо» not resolved | model non-determinism across runs; deterministic has no rule | yes |
| 2 (`stage2-160`, `stage2-164`) | «кетопрофн», «ктшку» | drug/procedure identity is strict-lexical by design | yes |
| 1 (`v3-019`) | «хочу увидеть воспалительные показатели» | category with no clarification issued (fragment stays unresolved) | yes |

**Every original false execution is gone** (`«осмотрите живот ультразвуком»`, `«сделайте визуализацию живота»`, `«может быть, сделаем КТ позже»`) and the dev-run false-execution count is 0 with precision 1.0. The four failure classes that *execute something unasked* are now closed structurally.

### 6b. Found by probing, **not** in the corpus, **not fixed** (deliberately: no further dev-style fixes)

* **Period-separated compounds share one scope.** The deterministic splitter does not split on «.», so «КТ. ОАК сейчас.» is one fragment; a leading condition in the previous sentence withholds *both* orders. Safe direction (over-withholds), wrong for the second order.
* **«посмотр*» is an examination.** «давайте посмотрим, что будет дальше» → `EXAMINE{}` («Что именно осматриваешь?»), because «посмотрим» contains «осмотр». Pre-existing substring behaviour.
* **«Иду оперировать, лапароскопически»** stays unrecognised (pre-existing).
* **The gate is lexical.** Hedges in phrasings not in the cue lists (a Kazakh/English phrase beyond the markers the repo already recognised, an idiom) will execute. Real resident turns are the only honest measurement of that.
* **The model is not asked to report commitment.** The status is computed from the words; asking the model would be a schema change and could not be measured offline.
* **English/Kazakh coverage** is limited to the markers the repo already had (`мүмкін`, `possibly`, `if needed`, `maybe`, `later`, …).
* **`wave2:corpus`** regenerates `WAVE2_SHADOW_CORPUS_METRICS_2026-08-28.json`; the deterministic baseline moved *up* (precision 0.886 → 0.909; one `role: surgeon` binding), nothing went down.

## 7. Not verified

Live model behaviour under the changed ACTION prompt (two new sentences) and allowlist; whether a live model now proposes `pelvic_ultrasound`, `ORDER_TEST` for «ультразвуком осмотрите…», or complies with the imaging sentence; real resident phrasing; the acknowledgement message in front of real users.

## 8. Files

New: `commitmentPolicy.js`, `interpreterV3A1.test.js` (39 tests), `scripts/replayV3RecordedRun.mjs`, `scripts/residentTurnCollection.mjs` + CLI + test, `scripts/goldReview.mjs` + CLI + test, `scripts/freezeReadiness.mjs`, `docs/RESIDENT_TURN_COLLECTION_AND_GOLD_REVIEW_PROTOCOL.md`, evidence `INTERPRETER_V3A1_OFFLINE_REPLAY_DEVELOPMENT_2026-09-20.json`, `resident-turns/` ledger.
Modified: `promotionPolicy.js`, `candidateArbitration.js`, `actionCandidateValidation.js`, `conceptGrounding.js`, `semanticConsultationPolicy.js`, `hybridInterpreter.js`, `deterministicInterpreter.js`, `vocabulary.js`, `modelConceptValidation.js`, `splitSemanticInterpreter.js` (prompt: two sentences, allowlist field), `executeCommand.js`, `governance.js`, `worldState.js`, `buildDebrief.js`, `exportSession.js`, `submitLearnerTurn.js`, `renderStatus.js`, `useSession.js`, `concepts.yaml`, `interpreterV3.test.js` (premises updated: A, promotion list, consultation), the adjudication artifact (9 resident rows added, undecided).
Not touched: clinical truth, trajectories, reviewed rules, disease content, `HIGH_RISK_ACTIONS`, scoring, mentor, replay semantics, the holdout, the Stage 2 corpus/manifest/ledger, `v3Metrics.mjs`.

Because the ACTION prompt, allowlist, grounding tables, deterministic pass and `promotionPolicy` changed, **the candidate hashes changed**: any future live run or freeze is a new candidate.
