# Interpreter v3A.1 (r2) — commitment-scope changes and the single live development measurement

Date: 2026-09-20 · Branch `feat/onqol-vnext-clean-core` · Evidence: `docs/evidence/INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-20-v3a1-run1.json`

**Verdict: NO-GO stands. Holdout not run (fingerprint `3427c699…` verified unchanged). Nothing frozen.** Development rows on draft (author-written) gold are diagnostic only.

## 1. What changed (commitment policy `commitment-2026-09-20-r2`)

| ruling | change |
| --- | --- |
| `DECLINED` stays the sixth non-executable state | unchanged; tested that explicit action language elsewhere in the sentence does not lift it |
| `КТ ОБП?` stays withheld; punctuation alone must not override an explicit order | a sentence-level *explicit action* token (present-tense / imperative: назначаю, делаем, заказываю, сделайте, …) lifts the **punctuation-derived** question only. Lexical questions («ли», «как думаете», **«или нет»** — added so the new rule cannot leak «Делаем КТ или нет?»), hedges, conditions, deferrals and refusals are never lifted. Perfective future («сделаем КТ?», «закажу ОАК?») and infinitives stay questions |
| `сначала X, затем Y` = two committed actions, explicit ordering | after a sequence opener (сначала, вначале, первым делом, для начала, прежде всего) the connectives затем / потом / далее / после этого / после чего / следом stop being FUTURE_PLAN cues. Other deferrals (позже, на потом, после получения…) and a connective with no opener still withhold. Recorded as `commandSequence {marker, steps[{step, connective, commandIds}]}` on the turn event and export (only when present, so existing replays are byte-identical); commands execute in stated order. Clinical core untouched |
| clause-local scope, not turn-global | (a) the deterministic pass now splits at sentence terminators (only before whitespace: `0.9%`, `т.е.` stay whole) so a command's source text never straddles sentences; duplicate-test merging is per sentence; (b) whole-turn shortcuts (WAIT, REASSESS, monitoring, chemistry) take the source text of *their own sentence*; (c) a cue never crosses a sentence boundary; (d) evidence that spans several sentences (only possible from a model's evidence choice) is judged per sentence and **fails closed** unless every sentence commits it, so a model cannot launder a hedge by adding a committed span |

Not touched (per instruction): slang, typos, «посмотрим», remaining hedge phrasings from the development corpus.

Offline verification: `npm run verify` (governance check, **524/524** tests incl. 21 new in `interpreterV3A1r2.test.js`, Wave 2 corpus, lint, build), `test:e2e` 4/4, `test:e2e:hybrid` 8/8. Offline replay of the recorded run through the new code is **identical** to v3A.1 on every development row (89.1%, 0 regressions) — expected, because the corpus contains no multi-sentence turns, no sequence words and no order phrased with «?».

## 2. The live measurement (one run, development split, 183 rows)

Candidate frozen before the run: prompt / schema / registry / metrics / content hashes and all 20 source hashes verified identical in the evidence file to the pre-run receipt. Model `gpt-5-mini-2025-08-07`. New separate ledger `.onqol-interpreter-v3a1-budget.json`, $1.75 ceiling (your decision); existing v3 and Stage 2 ledgers untouched; reserved $1.40 of $1.75, so a second run is structurally blocked.

| metric | v3A.1 live | deterministic-only | v3 run 1 (prior) |
| --- | --- | --- | --- |
| exact final command set (row / group) | **89.1% / 88.3%** | 51.4% / 55.3% | 87.4% / 85.1% |
| command precision | **1.000** | 0.982 | 0.976 |
| command recall | **89.5%** | 43.8% | 88.9% |
| false executions | **0** | 0 | 3 |
| high-risk false executions | **0** | 0 | 0 |
| invented parameters | **0** | 0 | 0 |
| inappropriate clarifications | **9** (5.8%) | 0 | 11 |
| provider failures / fallbacks | **0 / 138 consulted** (0%) | n/a | 0 |
| latency, per turn | p50 2.29 s, p95 3.18 s | <4 ms | — |
| cost | **$0.157** total; $0.0011 per consulted turn; ≈ $0.026 per 30-turn session | $0 | $0.152 |

Run status `MEASURED_DEVELOPMENT_DRAFT_GOLD_NO_GO` (valid: 0% provider failure).

The live result equals the offline replay (89.07% vs 89.07%) but is not the same set of rows: 3 rows the replay failed now pass live (`stage2-168`, `v3-001`, `v3-002` — the two ultrasound-examination rows were the earlier false executions, and the imaging prompt sentence now gets them right), and 3 rows the replay passed now fail (`v3-006`, `v3-018`, `v3-021`). All three are model variation; each fails toward *not executing*. This is the first live measurement of the changed prompt/allowlist.

## 3. Residual failures by semantic class (20 rows)

| class | rows | what happens | safe? |
| --- | --- | --- | --- |
| recognised-but-unmodeled study (pelvic US) | 9 (`stage2-055…063`) | live model still proposes `ORDER_TEST` with no id despite the new `recognizedUnmodeledTests` allowlist entry → «Какое исследование?». **The allowlist change did not take effect live.** These are the 9 inappropriate clarifications | yes; nothing executes |
| dangling verb left "unrecognised" (correct command still executes) | 4 (`stage2-094…096`, `v3-009`) | «уточню», «скажите» | yes |
| under-specified category answered with silence instead of a clarification | 2 (`v3-018`, `v3-019`) | model returned `testId:"ambiguous"` → rejected | yes; no clarification asked |
| slang / typo identity | 2 (`stage2-160`, `stage2-164`) | strict-lexical by design | yes |
| courtesy-prefixed order the model rejects | 2 (`stage2-101` nil-by-mouth with «Коллеги,»; `v3-006` «Уважаемые коллеги, оцените клеточный состав крови» → model proposed `ASK_PATIENT topic:"null"`) | non-determinism across runs | yes |
| compound, one half dropped | 1 (`v3-021`) | ОАК executes; the ultrasound candidate rejected `evidence_names_other_concept` | yes |

No row executes anything unasked.

## 4. Decision rule from your instruction

The live run revealed **no new systemic safety defect** (0 false / high-risk executions, 0 inventions, 0 fallbacks; every new failure is an omission). Development-set tuning therefore stops here. The two capability findings above (the pelvic-US allowlist not used by the model; silent rejection of category language) are recorded, **not fixed**.

## 5. Not measured — and what that means

* The r2 rules (question-with-action-verb, sequence, sentence-local scope) are covered **only by unit tests**; the development corpus contains none of those phenomena, so this run cannot support or contradict them. Resident turns are the only honest test.
* Known consequences to watch in real turns: comma-less «Сначала ОАК затем КТ» executes both correctly but records no sequence (both commands share one fragment); «Сначала ОАК, потом посмотрим…» now lets «посмотрим» produce an incomplete `EXAMINE` → a clarification instead of a withheld deferral (the excluded «посмотрим» class); a trailing acknowledgement as its own sentence («Ок.») is now visible as an unrecognised fragment and consults the model instead of being silently swallowed; a WAIT/REASSESS shortcut still drops other commands in the same turn (pre-existing; safe direction).
* Only one resident session (9 turns) exists; no clinician adjudication (0/242), no independent blind labels.

## 6. Next steps (yours; none started)

1. Resident-turn collection to ≥ 60 turns across several sessions (`collectResidentTurns.mjs`), 2. independent blind labelling + named clinician adjudication (`goldReviewCli.mjs`), 3. only then a deliberate freeze and the single holdout run. This candidate has changed hashes vs. every earlier one, so any freeze is of this candidate.

## 7. Data governance

Superseded by the follow-up cleanup: see `docs/RESIDENT_COLLECTION_READINESS_2026-09-20.md` and `docs/RESIDENT_TURN_COLLECTION_AND_GOLD_REVIEW_PROTOCOL.md`. The live run above used development rows only; none was derived from resident language after the cleanup (the nine retired rows were holdout rows).
