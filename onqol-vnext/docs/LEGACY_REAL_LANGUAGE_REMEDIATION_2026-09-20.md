# legacy_real_language_development — corpus, v3A.1 measurement, remediation waves (2026-09-20)

**Status: development evidence only. Targets NOT met. Holdout not run, not read, not modified.**
No learner word appears in this file, in Git, or in any tracked evidence file (owner ruling 2026-09-20). Raw text, the review
file, the alias map, the salt, the provider journal and the raw run files are under `private/legacy-real-language/`.

## 1. What was built

| | |
|---|---|
| Sources | 11 historical ON QOL sessions (4 `.docx`, 7 `.md`), all the files supplied. `.docx` learner turns are identified by the file's own font colour (white); the `.md` exports lost all styling, so their learner lines are a curated line list checked against question→answer→feedback alternation. One source (P07) is truncated at the end in the file itself; nothing after the truncation exists. |
| Turns | **93** genuine learner utterances, byte-for-byte (typos, slang, RU/EN mixing, punctuation kept; UI text such as the «конец кейса» hint is not a turn, the learner typing it is). Verified: every turn is a verbatim substring of its source. |
| Per turn | stable id `lrd-<alias>-tNN`, opaque session alias (salted HMAC, so it says nothing about the file), minimum preceding system prompt (context only), raw text, channel, commitment state, expected structured commands (with per-command `execute / clarify / either / optional`, `must-stay-unfilled` parameters and alternative readings), named-but-not-to-be-committed items, ambiguity, scope + reason, annotator confidence. |
| Scope | **69 IN_SCOPE / 24 OUT_OF_CURRENT_SCOPE.** IN_SCOPE = at least one action the current command + registry vocabulary can express, or a turn whose correct handling is "execute nothing" (stuck, deflection, refusal, pause). OUT = only unmodeled studies/procedures/drugs or disease-specific reasoning (ECG, X-ray, endoscopy, drains, oncology staging, operative technique…). |
| Channels | compound 42 · clinical_action 21 · clinical_reasoning 11 · conversation_management 12 · mentor_answer 7 · **patient_question 0 as a primary channel** (residents in these sessions issued instructions; patient questions occur only inside compound turns). |
| Freeze | v1 frozen `60406a6d…` **before any interpreter code was touched or any interpreter output seen**; v1.1 `1004137e…` (4 recorded amendments, below). Manifest: `docs/evidence/legacy-real-language/CORPUS_MANIFEST.json`. |
| Review file | `private/legacy-real-language/ANNOTATION_REVIEW.md` — one block per turn, with a `Reviewer` line; low-confidence labels are marked. |

**The annotation is model-drafted, not human- or clinician-reviewed** (12 of 93 labels are `low`, 44 `medium`, 37 `high`). Gold is *draft linguistic
intent* in terms of the commands the simulator can express — never clinical truth, never copied from what the legacy ON QOL replied.

### Amendments after the freeze (v1 → v1.1) — all annotator errors found while auditing the baseline, none made to move a metric

1. A turn stated a monitoring target the v1 label omitted (label note already mentioned it).
2. + 3. A neurological-status examination is an `EXAMINE` region (`EXAMINE` executes for any region; v1 counted the rectal exam as modeled and this one as unmodeled — inconsistent). Two turns.
4. A first-person consult *intention* was labelled not-to-commit while the identical construction in another turn was labelled committed; now `optional`.

The baseline is reported under both versions. Two further label questions are **left as they are** and flagged for the reviewer rather than amended a second time
to fit the code: (a) one monitoring turn where the label unions two clauses into one command; (b) an infinitive «confirm by CT» labelled as an order (low confidence) while
the same "by CT" construction elsewhere is labelled not-an-order — after wave 6 the interpreter treats "by/under CT" consistently as a *method*, so this row now fails (48→47 exact).

## 2. Baseline: the current interpreter (v3A.1, working tree) on the 69 IN_SCOPE turns

"Current v3A.1" is the **uncommitted working tree** (the v3/v3A.1 modules are untracked or modified against `HEAD 9173a01`); a tarball + SHA-256 list of it is in `private/legacy-real-language/baseline-v3a1/`. 545/545 tests passed before any change.

| run | status | exact | precision | recall | false exec (high-risk) | invented | notes |
|---|---|---|---|---|---|---|---|
| deterministic only | free | 43.5% → 47.8% (v1→v1.1) | 0.74 | 0.46–0.50 | 16 | 0 | |
| live, **production timeouts** (6/7/8 s) | **INVALID** | 44.9% | 0.70 | 0.51 | 21 (3) | 0 | **19 of 59 consulted turns (32%) timed out and fell back**; rule: >5% ⇒ invalid |
| live, relaxed timeouts (30 s), measurement only | valid | 50.7% (v1) / **52.2%** (v1.1) | 0.716 / **0.745** | 0.630 / **0.636** | 24 / **21 (3)** | 0 | model cost $0.09 |

### Finding for the owner, independent of interpretation quality: the latency budget
gpt-5-mini answers in ~4.6–5.6 s even when it succeeds; the gateway budget is 6 s. On real resident turns roughly **a third of consulted turns silently degrade to the deterministic reading**. Both the invalid and the relaxed run are recorded; the relaxation is an opt-in harness flag (`--relax-timeouts-ms`) — no product constant was changed.

## 3. Failure taxonomy (baseline, 69 IN_SCOPE turns; a turn can carry several classes)

Mechanical tags are in every `RUN_*.json` (`failureClassCounts`, `perTurn`); row-level detail with text: `private/legacy-real-language/TAXONOMY_baseline_row_detail.md`.

| # | Systemic class | Mechanism | Turns | After wave 6 |
|---|---|---|---|---|
| C1 | **Not-a-commitment executed** | declined, counterfactual ("it would be possible to…"), scheduled ("in 72 h"), predicted need, a study named as a *reported finding*, a study named as the *method/guidance* of another act | 4 in + 2 OOS | 3 of 4 fixed; 1 open (an argument turn) |
| C2 | **Noun read as an action** | role noun → `CALL_STAFF` (deterministic *and* model), symptom noun in a declarative → `ASK_PATIENT`, substring of a longer word → history, observation → status check | 7 | fixed |
| C3 | **Unmodeled study / region / target collapsed onto a modeled one** | X-ray→CT, "CT of the pelvis"→abdominal CT, invented monitoring target = a word from the text, bare analyte inside a nutrition item / stop-criterion | 5 | partly (chest/pelvic/X-ray fixed; **4 rows open**: analyte or study named inside a subordinate clause) |
| C4 | **One phrase multiplied into several orders** | model expands a generic label into IV access + NPO + review; «all the tests» into CT + US | 2 (+1 live) | fixed (one-span-many-actions gate; category language) |
| C5 | **Whole-turn shortcut swallows a compound turn** | reassess / monitoring / chemistry shortcuts return one command and drop the rest of the turn | 2 | fixed (shortcuts yield to the fragment path) |
| C6 | **Model picks the wrong command type / unconstrained parameter** | `TRANSFER` for an ICU stay (high-risk, ×2), free-text `approach`, monitoring target not an id | 5 | fixed (structural validation) |
| C7 | **Quantity / unit / segmentation** | litres, abbreviated fluid names ("saline sol." written short), spaced dash between two orders, decimal comma split into two fragments, the one-letter Cyrillic abbreviation for hours (`\b` on Cyrillic — 5th occurrence of the trap) | ~6 | fixed |
| C8 | **The UI's own control phrase not understood** | «конец кейса» (the string the interface tells the learner to type) → nothing | 1 | fixed |
| C9 | **Management-intent wording** | "conservative for now", an English surveillance formula, bare operation names, "we are preparing for surgery" | 8 | 4 fixed; **4 open** (bare noun lists, sequenced plans) |
| C10 | **Interval / monitoring target** | `everyMinutes` vs schema `intervalMinutes` (nothing read it), "hourly", short target abbreviations (blood pressure) | 4 | fixed |
| C11 | **Spurious clarification** | asking "which procedure / which staff / which fluid" about something the learner named but the registry cannot hold | 8 | 5 → 4 rows open |
| C12 | **Ruling-blocked** | an opener-less sequence connective ("then" / "further" at the start of the next step) is a deferral by the r2 ruling, so ordered steps are withheld | 3 rows | **unchanged — needs your decision** |
| C13 | **Latency** | 32% of consulted turns time out at 6 s | 19 of 59 | unchanged (owner constants) |
| C14 | **Elliptical answer needing the system question** | a bare noun answering «ward or ICU?» | 1 | open: no prompt-context channel exists |
| C15 | **Lexicon gaps** | the short form of the biochemistry order, brand/slang drug names, typos in a keyword | ~5 | the biochemistry short form and the blood-pressure abbreviation added; brands **not** added (unreviewed lexicon) |

## 4. Remediation waves (systemic mechanisms only; no sentence special-cased)

Every wave is replayed offline on the full 69 IN_SCOPE turns using the model responses recorded in the live baseline, then the final code is **measured live**.
A replay whose request did not change is a faithful re-run of everything downstream of the model (`requestChanged` is recorded in each evidence file).

| wave | change | exact | precision | recall | false exec (HR) | invented | notes |
|---|---|---|---|---|---|---|---|
| baseline v1.1 | — | 52.2% (36) | 0.745 | 0.636 | 21 (3) | 0 | |
| 1 | commitment cues (counterfactual "would have been", predicted need, **delay = scheduled, unless it is a reassess/wait/monitoring parameter**); staff needs a request cue; other-region CT ≠ abdominal CT; unmodeled modality contradicts a modeled study; one-span-many-actions gate; `END_CASE` phrase | 56.5% | 0.824 | 0.636 | 12 (2) | 0 | 2 rows not replayable |
| 2 | whole-turn shortcuts yield; reassess as a fragment; litres; infusion names; spaced dash; symptom noun ≠ question; intents; structural validation (TRANSFER destination, target ids, approach); kind-must-be-evident widened | 62.3% | 0.898 | 0.775 | 9 (**0**) | 0 | spurious clarifications 7→11 |
| 3 / 3b | one-letter hours unit, `intervalMinutes`, bare "solution" abbreviation, continuation, procedure/specialist not turned into a question; history stem, status anchoring, monitoring default, unmodeled CT region | 69.6% | 0.905 | 0.775 | 8 (0) | 0 | |
| 4 | bare operation name = plan; analgesia intent yields to a named drug; region stems; ICU/radiology roles in the model allowlist | 73.9% (replay; request changed) | 0.909 | 0.806 | 8 (0) | 0 | **live: 65.2%, prec 0.858, 12 FE, 1 invented** (see below) |
| **4-live** | the same code, **measured live** | **65.2% (45)** | 0.858 | 0.783 | 12 (0) | **1** | model cost $0.10; 0 provider failures |
| 5 | staff request cue also for model candidates; category language («all the tests»); identity-based span gate; anchors fixed (a two-letter fasting anchor matched inside an unrelated verb); empty monitoring is not a command | 69.6% | 0.897 | 0.806 | 8 (0) | **0** | faithful replay of the 4-live recordings |
| **6 (final)** | reported-result and "by/under CT" (method) guards | **68.1% (47)** | **0.896** | **0.798** | **8 (0)** | **0** | OOS probe: **0** executions on the 24 OOS turns (was 2) |

### Final position against the development targets (IN_SCOPE, final code, replay of live recordings)

| target | result |
|---|---|
| false executions = 0 | **8 — not met** (baseline 21) |
| high-risk false executions = 0 | **0 — met** (baseline 3) |
| invented parameters = 0 | **0 — met** |
| precision ≥ 0.95 | **0.896 — not met** (baseline 0.745) |
| recall ≥ 0.90 | **0.798 — not met** (baseline 0.636) |
| exact ≥ 0.90 | **68.1% — not met** (baseline 52.2%); action turns 62%, restraint turns 88% |

Turn-level regressions between consecutive waves (a turn exact before and not after), stated in full: **wave 1: 1** (a turn the new policy consults but the recording never did — replay fails closed; an artefact of replay, not of the code);
**wave 2: 2** (both my own over-broad matching of a bare "solution" abbreviation / the verb "to drip"; fixed in wave 3); **wave 3b: 1** (a long compound turn that now fails differently); **wave 6: 1** (the label question above).
Wave 4→5 is **not comparable turn by turn**: wave 5 replays the *live* wave-4 recordings, wave 4 replayed the baseline recordings, and the two model outputs differ (5 turns flip in each direction because the request — the allowlist — changed).
The first live measurement of the wave-4 code was *worse* than its replay (65.2% vs 73.9%) for the same reason: changing the allowlist changed what the model proposed, which a replay cannot see. The wave-5/6 numbers are a replay of the wave-4 live recordings with an
**unchanged request** (`requestChanged = 0`), so they are faithful for everything after the model, but **no live run has measured waves 5–6**. The new ledger is at $1.82 of $2.00 reserved (real spend $0.24); another
live run needs a decision from you (see §6).

Two facts worth stating plainly: (1) on this corpus the deterministic layer alone (exact 66.7%, precision 0.92) is now about as good as the hybrid; the model layer still adds
false executions on long compound turns, which is a property of the semantic layer, not something more cue-lists will fix. (2) The remaining false executions are 8 commands in 5 turns, in classes C3/C1, that need
clause-level understanding (a test named inside a stop-criterion, an argument turn), not lexicon.

## 5. What changed (all under `src/ai/interpreter`, `concepts.yaml`, scripts; Patient Engine, clinical truth, APP-004 rules, trajectories and scoring untouched)

Commitment policy `commitment-2026-09-20-r3-legacy-wave1`, promotion policy `v3a1-2026-09-20-legacy-wave2`. 30 tests added since the 545-test baseline (20 mechanism tests in
`src/ai/interpreter/legacyRealLanguageWaves.test.js` with **synthetic** sentences, 10 for the metrics/taxonomy harness; 5 schema tests were already in the 545); 3 existing tests were edited and each edit is a deliberate contract statement
(the version regex; a semantic-only example moved off `SET_NPO`, whose kind must now be evident; a hedged CT is now *reported as withheld* instead of silently absent). **575/575 tests, lint, content check and governance check pass.**
`npm run wave2:corpus` was not run (it rewrites a tracked evidence file that already has uncommitted changes).

Owner rulings **not** changed, and one attempted then reverted: I first extended the r2 sequence ruling to an opener-less "then / further" at the start of a step; an existing r2 test
asserts the opposite, so I reverted it and list it as decision 2. The bare subjunctive particle is *not* a hedge (existing tests: "I would ask for a CBC" is a polite order); only the counterfactual "would have been" is.

## 6. Decisions I need from you

1. **Latency:** 6 s gateway vs ~5 s model latency loses ~a third of consulted turns to fallback. Raise the budget, choose a faster model, or accept fallback as the product behaviour?
2. **Sequence ruling (r2):** should "X, then Y" / "Further, Y" — a step connective that *opens* the next step after an action — be an ordered step (committed) rather than a deferral? Three turns (≈4 required commands) are blocked by it. It is your ruling, so I did not change it.
3. **Promotion policy:** I widened `KIND_MUST_BE_EVIDENT` to `TAKE_HISTORY`, `SET_NPO`, `ESTABLISH_IV_ACCESS`, `REQUEST_STATUS` (the model can no longer add them on "substantive words"), and added `icuPhysician`/`radiologist` to `staff_roles` in `concepts.yaml` (they already exist in the hospital profiles and the deterministic lexicon). Keep, or revert?
4. **Lexicon:** The short biochemistry form and the blood-pressure abbreviation were added to `vocabulary.js` (unreviewed lexicon). Brand/slang drug names seen in the corpus were deliberately *not* added — they need the lexicon reviewer.
5. **Elliptical answers** ("ward or ICU?" → "ICU") cannot be resolved without the system's question. Add a prompt-context channel (grounded only in options the prompt literally offered)?
6. **Human/clinician review of the 93 labels** (`ANNOTATION_REVIEW.md`), starting with the 12 low-confidence ones and the two flagged rows; any change is a new corpus version.
7. **Spend:** a live confirmation of waves 5–6 needs a new ledger (the current one has ≈$0.18 of headroom; a run reserves ≈$0.63).
8. Nothing is committed: the whole v3/v3A.1 line and this work sit in the working tree on `feat/onqol-vnext-clean-core`.

## 7. Files

- Tracked: `scripts/legacyRealLanguage/{extract_sources.py, buildCorpus.mjs, corpusSchema.mjs, legacyMetrics.mjs, taxonomy.mjs, runLegacyCorpus.mjs, *.test.js}`, `src/ai/interpreter/legacyRealLanguageWaves.test.js`, `docs/evidence/legacy-real-language/{CORPUS_MANIFEST.json, RUN_*.json}` (ids, counts, tags, hashes — no words), this document.
- Small edits to existing harness plumbing (defaults unchanged): `scripts/stage2Runtime.mjs` (`journalDir`, `timeoutMs`), `scripts/v3Evaluation.mjs` (`hybridTimeoutMs`), `server/aiGateway.mjs` (`timeoutMs`).
- Private (gitignored): corpus, review file, alias map + salt, extracted paragraphs, annotations, freeze seal, raw runs with model text, provider journal, row-level taxonomy, remaining failures, baseline tarball.
