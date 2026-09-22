# Interpreter v3 development run 1 — invalid for the v3 rows (retained as diagnostic evidence)

File: `INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-19-run1.json` (left byte-for-byte as written; not overwritten).

Why it is not a measurement of the interpreter:

* 31 of 183 rows fell back to the deterministic reading because of **provider/transport failure**, not interpretation: 4 `provider_timeout` (one call stalled ~508 s), 18 `provider_error` (14–17 ms, i.e. refused locally), 9 `provider_quota` (the Stage 2 gateway ledger `.onqol-stage2-budget.json` had $4.99 of its $5.00 reservation cap used).
* The failures begin at row 151 — exactly where the rows added for v3 begin — so the rows that exercise the new behavior are the ones that were lost. Its reported `providerFallbackRate` of 0.218 and `cost: null` are artefacts of this.
* The first 150 rows (the original Stage 2 development rows) ran cleanly and were used for offline error analysis only. That analysis led to four fixes (fasting-question equivalence, punctuation-tolerant verbatim evidence, substantive-evidence acceptance for concept-less promoted actions, trailing-punctuation boundary in the deterministic route/region matchers), each covered by a regression test.
* Run 1 also pre-dates the "evidence names another concept" guard.

Nothing from run 1 is cited as a v3 result. A clean run from scratch was made on a separate ledger (`.onqol-interpreter-v3-budget.json`, $2.00 reservation ceiling, same per-call/per-session limits); the Stage 2 ledger was not reset or edited (run 1 itself consumed its remaining headroom as an ordinary run; the clean run never touched it).
