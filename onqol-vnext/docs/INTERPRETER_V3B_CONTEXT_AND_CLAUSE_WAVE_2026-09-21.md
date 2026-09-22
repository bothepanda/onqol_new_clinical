# Interpreter v3B — conversational context, clause-level parsing, narrowed consultation (2026-09-21)

**Status: development evidence only. Offline only: no live provider call, holdout not run, read or modified, nothing frozen, nothing committed.
The live-run gate was NOT met, so no live run was made.** No learner word appears in this file (owner ruling 2026-09-20).

## 1. Label review first (before any code)

23 rows read: all 12 low-confidence, the 2 flagged rows (one is also low-confidence, so 1 extra) and a seeded random 10 of the other 80.
Record: `docs/evidence/legacy-real-language/LABEL_REVIEW_2026-09-20.json` (ids and verdict codes only); reasoning with quotes is private.

| verdict | rows |
|---|---|
| confirmed | 13 |
| confirmed + note | 6 |
| **disputed (unresolved — owner rules)** | **3**: `lrd-e1c493-t05` (two commands), `lrd-e1c493-t08` (flagged b), `lrd-324b0a-t05` (flagged a) |
| clinician question | 1: `lrd-4d67d8-t07` |

**Limit, stated plainly:** the reviewer is the same model family as the annotator. This is a second read, not an independent, human or clinician review, and
it does not satisfy the freeze condition. The low-confidence flag was informative (2 of 12 disputed vs 0 of 10 sampled); 0/10 leaves a one-sided 95% upper
bound of about 26% on the error rate of the 70 unread labels. One annotation note is factually wrong (formulary claim, `lrd-e89230-t10`).
`CORPUS.json` (v1.1) is untouched. **No code change was motivated by a disputed row**; the harness reports every run on all 69 rows *and* on the 66 without them.

## 2. What was built

| # | Requirement | Mechanism |
|---|---|---|
| 1 | Context channel | `conversationContext.js`. The previous system utterance is read into a frame (questions, kind: yes/no · choice · wh · expectation, subject domains, the options it literally offered). A short reply is resolved **before generic routing** through three data-driven paths: a *slot* noun answering a where-question (the question supplies the preposition), *polarity* to a yes/no question, an *ordinal* over listed options. **Identity rule:** when the learner's own word names the act, any type may result; when the identity comes only from the question, the result is never a protected type and never carries a dose/route/volume/duration taken from the question. Expectation questions make a nominal reply a mentor answer, not an unrecognised action. The frame (system's words only) is added to the model request. |
| 2 | Clause-level parsing | `clauseParser.js` is the single segmentation (the deterministic pass and the commitment gate used two different ones). The deterministic pass now reads **clause → judge each clause's commands in that clause → only then merge duplicate orders among the committed ones**. Every result carries `clauses[]` with channel, commitment, command ids. |
| 3 | Sequence ruling | Already implemented in r2 (`сначала X, затем/далее/после этого Y`: both COMMITTED, ordered, recorded in `commandSequence`); now locked by tests for all three connectives. `позже`, `на потом` stay FUTURE_PLAN; bare `потом` with no opener stays deferred. **Fixed a defect this exposed:** a connective that opens a clause *with its own content* («…, потом X») defers X, not the action before it; a postponement adverb or a condition that trails an action still qualifies it. |
| 4 | Keep protections | `KIND_MUST_BE_EVIDENT` (TAKE_HISTORY, SET_NPO, ESTABLISH_IV_ACCESS, REQUEST_STATUS) and `icuPhysician`/`radiologist` staff roles unchanged; locked by a test. |
| 5 | No sentence patches | All new rules are structural or data tables (domain stems, polarity words, ordinals, scope breakers). Tests use synthetic phrasing. |
| 6 | Narrow consultation | `semanticConsultationPolicy.js` decides per clause. In doubt = *unresolved*, *ambiguous* (non-canonical form or incomplete with free words), *conflicting* (negation/alternative in a committed clause), *contextual*. Final and **not sent**: canonical committed clauses, clauses the gate would withhold whatever is read from them (own hedge, or a governing «если …»; decided by asking the gate itself), reasoning, courtesy, expectation answers. Only the clauses in doubt are sent; a turn that is entirely canonical never reaches the provider. |

Also: verb ellipsis in coordination («X вызываю и Y»: the bare second object borrows the previous clause's own verb words, and counts only for the same command type); leading focus particles («только если …») no longer hide a governing condition; an adversative («но …») or an explicit-decision clause ends a leading hedge's scope.

**Deliberate contract edits to 5 existing tests (each states why):** the hedged-only turn and the hedged-candidate turn are no longer consulted, because the gate would withhold whatever the model returned (candidate-level guards keep direct tests); three model-fixture tests now put their candidates on the clause that still reaches the model (the canonical clause is no longer the model's to re-read). 18 tests added (`interpreterV3B.test.js`). **593/593 pass; lint, content check and governance check clean.**

## 3. Offline replay (recorded wave-4 live responses, final code)

Replay is **not faithful for the model layer** in this wave: the request changed for every consulted row (clause-only text, and the frame), so `requestChanged` = consulted rows. Recorded responses whose evidence lies in a clause no longer sent are dropped as non-verbatim — pessimistic for model recall, correct for the narrowing. Deterministic layer, gates and arbitration are exercised for real.

| run | exact | exact excl. 3 disputed | precision | recall | false exec (high-risk) | invented | consulted rows |
|---|---|---|---|---|---|---|---|
| previous wave, replay (baseline reproduced) | 68.1% | — | 0.896 | 0.798 | 8 (0) | 0 | 61 |
| v3B, replay, **no context** | 72.5% | 75.8% | 0.907 | 0.822 | 7 (0) | 0 | 58 |
| **v3B, replay, with context** | **73.9% (51/69)** | **77.3% (51/66)** | **0.908** | **0.829** | **7 (0)** | **0** | 56 |
| v3B deterministic only, with context | 71.0% | — | 0.919 | 0.775 | 6 (0) | 0 | 0 |
| OOS probe, 24 out-of-scope turns (deterministic) | 0 false executions (was 0) | | | | | | |

Consultation: 352 clauses in 69 rows; 239 sent (32% fewer). 56 of 69 rows still reach the model (was 61): 21 sent whole, 35 partially. Of the sent clauses 183 are unresolved statements, 53 ambiguous, 3 conflicting. **Honest reading:** on long resident narratives most clauses are statements nothing matched, so the model is still consulted on most rows; the saving is per clause (cost, latency, cross-clause errors), not per row.

### Live-run gate (yours): NOT MET → no live call
| gate | required | measured (with context) |
|---|---|---|
| false executions | 0 | **7** (6 excluding disputed) |
| high-risk false executions | 0 | 0 ✔ |
| invented parameters | 0 | 0 ✔ |
| precision | ≥ 0.95 | **0.908** |
| recall | ≥ 0.90 | **0.829** |
| exact | ≥ 0.90 | **73.9%** |

### Remaining false executions (7 commands, 5 rows) — none is fixable by a further mechanism I can defend without tuning to the corpus
Unmodeled study or region resolved to a modeled one, or a parameter altered, inside a long compound turn (3 rows); a deferral that lives in a *later sentence* («all this when the patient is stable») and cannot be reached by clause-local scope (1 row); one is the disputed row. Other failing rows: an unmodeled study named next to a modeled one makes the model ask "which study?" (recognised-unmodeled registry is data the owner reviews); reported speech («I said that I will ask…») has no commitment state; a medication order that follows a bare «потом» (`lrd-e1c493-t01`: the label asks for execution; the ruling defers it — a label/ruling conflict in a row I did not review, flagged).

## 4. Decisions for you
1. Rule on the 3 disputed labels (proposals in the review record) and the clinician question on the English surveillance formula. Each ruling is a new corpus version, not an edit.
2. Independent (human) label review: this one cannot stand in for it.
3. `lrd-e1c493-t01`: label vs the bare-«потом» ruling.
4. Recognised-unmodeled study registry (chest CT, X-ray…) is a data decision for the lexicon reviewer; it would remove the spurious "which study?" clarifications.
5. Reported speech («я сказал, что спрошу…») needs a seventh non-executable state; the test that pins six states would change, so I did not.
6. Latency (6 s budget vs ~5 s model): narrowing shortens requests but does not by itself settle it.

## 5. Files
`src/ai/interpreter/{conversationContext,clauseParser}.js` (new); changed `commitmentPolicy.js`, `deterministicInterpreter.js`, `semanticConsultationPolicy.js`, `hybridInterpreter.js`, `splitSemanticInterpreter.js`; `scripts/legacyRealLanguage/runLegacyCorpus.mjs` (`--context prompt|none`, disputed-excluded view); tests `interpreterV3B.test.js` + 5 edited. Tracked evidence: `docs/evidence/legacy-real-language/{LABEL_REVIEW_2026-09-20.json, RUN_wave7-*.json}` (ids, counts, tags). Private: review reasoning and raw runs under `private/legacy-real-language/`.
