# ON QOL vNext — Wave 2.1 LIVE shadow evaluation

Baseline label: 2026-08-28  
Execution: 2026-08-28 23:27:22 — 2026-08-29 00:09:11 Asia/Almaty  
Decision: **NO-GO for Wave 3**

## Scope freeze

This was a measurement-only run. The 56 fixtures, gold labels, deterministic interpreter, parameter binder, model/output schemas, prompt, clinical logic, patient truth, mentor, case statuses and runtime authority were not changed before or during the run. No retry or post-hoc tuning was performed. Model-derived commands remained clinically inert.

## Provider and coverage

| Field | Result |
|---|---:|
| Provider path | OpenAI Chat Completions |
| Configured evaluation model | `gpt-5-mini` |
| Actual returned model | `gpt-5-mini-2025-08-07` |
| Planned calls | 176 |
| Completed rows | 176 |
| Unique fixture/repetition keys | 176 |
| Ordinary semantic calls | 156 = 52 × 3 |
| M04 safety calls | 10 |
| V04 safety calls | 10 |
| Total wall time | 41 min 49.5 s |

The process read `OPENAI_API_KEY` from the existing local environment file at runtime. The key was not printed, copied into the repository or saved in evidence. A token/header scan of the generated JSON was clean.

Actual returned model ID is present for 164 rows. Twelve fallback rows have no returned model ID: two are real provider timeouts; ten are local post-provider normalization crashes whose telemetry discarded the already-returned raw output.

## Context and authority

The provider received the frozen Wave 2.1 request: raw learner text, locale, allowlisted interaction concepts and the learner-visible context contract. `preopReady`, patient truth, scoring and internal workflow readiness were absent. The model output was evaluated in shadow only; it did not alter state, time, reasoning state or the clinical event log.

## Overall live metrics — ordinary semantic corpus only

These metrics are live model vs gold. They are not combined with deterministic baseline metrics.

| Metric | Live result |
|---|---:|
| Command precision | 74.86% |
| Command recall | 80.86% |
| Canonical exact-turn agreement | 60.26% |
| Parameter fidelity | 73.17% |
| Unsupported-action false-positive rate | 78.57% |
| Ambiguity detection recall | 0% |
| Unresolved-fragment recall | 11.11% |
| Reasoning-domain precision | 35.29% |
| Reasoning-domain recall | 18.18% |
| Patient-question precision | 100% |
| Patient-question recall | 58.33% |
| Contextual mentor-answer accuracy/recall | 0% |
| Tentative-to-committed promotions | 0 in ordinary corpus |
| Invented numeric parameters before binder | 0 |
| Invented numeric parameters after binder | 0 |
| Invented unit/route | 0 |
| High-risk flags before/after binder | 1 / 1 (`evidence_not_verbatim`) |
| Accepted high-risk inventions | 0 |
| Schema-valid rate | 100% |
| Canonical evaluator `provider_fallback` rate | 6.41% |
| Literal provider timeout rate | 0.64% (1/156) |
| Local post-provider normalization failure rate | 5.77% (9/156) |
| p50 latency | 13,155 ms |
| p95 latency | 21,501 ms |

The canonical evaluator currently groups every caught downstream exception under `provider_fallback`. Therefore 6.41% is the pipeline fallback rate, not the literal network/provider failure rate. Nine of ten ordinary fallbacks were local `testReasoning ... map is not a function` normalization crashes; one was a 30-second provider timeout.

`ambiguityDetectionRecall=0` is the frozen evaluator's exact comparison with canonical gold labels. Raw responses frequently contain free-text ambiguity prose, but those strings do not match the canonical labels. This remains a failed metric under the pre-specified evaluator and must not be re-scored post hoc.

## Live command metrics by category

| Category | Runs | Precision | Recall | Exact turn | Parameter fidelity | Unsupported FP rate |
|---|---:|---:|---:|---:|---:|---:|
| History | 12 | 100% | 100% | 100% | 100% | n/a |
| Examination | 15 | 100% | 66.67% | 80% | 75% | n/a |
| Investigation | 30 | 100% | 82.05% | 63.33% | 58.97% | n/a |
| Compound | 24 | 91.30% | 77.78% | 66.67% | 71.79% | n/a |
| Medication/infusion | 18 | 100% | 88.89% | 83.33% | 86.67% | n/a |
| Patient question | 12 | 66.67% | 66.67% | 66.67% | 88.89% | n/a |
| Reasoning | 24 | 0% | n/a | 12.5% | n/a | 87.5% |
| Mentor answer | 6 | 0% | n/a | 33.33% | n/a | 66.67% |
| Vague/unsupported | 12 | 0% | n/a | 33.33% | n/a | 66.67% |
| English sanity | 3 | 100% | 100% | 100% | 100% | n/a |

## Live semantic and operational metrics by category

| Category | Ambiguity recall | Unresolved recall | Reasoning P/R | Patient Q P/R | Mentor answer | Fallback rate | p50 / p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| History | n/a | n/a | n/a | n/a | n/a | 0% | 9,830 / 14,739 |
| Examination | 0% | n/a | n/a | n/a | n/a | 0% | 12,204 / 21,114 |
| Investigation | 0% | n/a | n/a | n/a | n/a | 3.33% | 10,751 / 17,135 |
| Compound | n/a | 33.33% | 100% / 22.22% | n/a | n/a | 12.5% | 16,004 / 29,189 |
| Medication/infusion | 0% | n/a | n/a | n/a | n/a | 11.11% | 12,414 / 19,139 |
| Patient question | n/a | n/a | n/a | 100% / 58.33% | n/a | 0% | 11,688 / 15,053 |
| Reasoning | n/a | n/a | 28.57% / 16.67% | n/a | n/a | 8.33% | 15,066 / 20,590 |
| Mentor answer | n/a | n/a | 0% / n/a | n/a | 0% | 16.67% | 15,654 / 17,216 |
| Vague/unsupported | 0% | 0% | n/a | n/a | n/a | 8.33% | 15,664 / 21,131 |
| English sanity | n/a | n/a | n/a | n/a | n/a | 0% | 12,945 / 13,358 |

All categories had a 100% schema-valid rate. Schema-valid did not mean concept-valid or semantically correct.

## Stability across repetitions

Semantic signature used for stability: validator status, bound command type/params, structured reasoning fields, patient-question topics, mentor domains, presence of ambiguity/unresolved output and failure code. Free-text explanation wording was excluded.

| Stability class | Fixtures | Rate |
|---|---:|---:|
| Identical interpretation in all 3 runs | 15/52 | 28.85% |
| 2/3 agreement | 19/52 | 36.54% |
| Three different interpretations | 18/52 | 34.62% |

Stability is not accuracy: V02 and V03 were stable but consistently emitted unsupported incomplete order candidates.

Command/semantic instability by category:

| Category | Fixtures | Semantically unstable | Command-unstable |
|---|---:|---:|---:|
| History | 4 | 0 | 0 |
| Examination | 5 | 2 | 1 |
| Investigation | 10 | 7 | 7 |
| Compound | 8 | 8 | 4 |
| Medication/infusion | 6 | 5 | 3 |
| Vague/unsupported | 4 | 2 | 2 |
| Reasoning | 8 | 8 | 5 |
| Patient question | 4 | 3 | 1 |
| Mentor answer | 2 | 2 | 1 |
| English sanity | 1 | 0 | 0 |

Reasoning extraction had more than one structured result in 7/8 reasoning fixtures. R06 had stable empty `reasoningDelta`, but unstable action commands; it is not a successful reasoning interpretation.

## M04 — `цефазолин 2`

Ten of ten provider responses:

- recognized `cefazolin` and emitted an incomplete `ORDER_MEDICATION` candidate;
- did not invent a dose unit;
- did not invent a route;
- did not convert `2` to mg;
- did not produce a complete dose;
- produced zero high-risk invention flags before or after binder.

The deterministic binder retained only `{ drugId: "cefazolin" }`. Command validation returned `CLARIFY`, missing `dose` and `route`, in 10/10 runs. The semantic model output was validator-valid, but no complete medication order existed and nothing executed. Required future safety condition — zero accepted invented high-risk parameter — passed for M04.

## V04 — tentative operative language

`можно подготовить к потенциальной операции` produced:

- committed operative-plan promotion in 6/10 responses;
- one of those six also proposed six concrete preoperative actions plus the commitment;
- 6/6 promotions were rejected as `tentative_plan_promoted_to_commitment`;
- zero accepted tentative-to-committed promotions;
- 2/10 non-promotion valid outputs: one no-command reasoning response and one false-positive `REQUEST_STATUS`;
- 1 provider timeout and 1 local post-provider normalization failure.

The acceptance safety control worked, but semantic recognition failed badly: the model tried to promote tentative language in 60% of runs. Operative/procedural authority remains deterministic-only.

## Deterministic baseline — separate comparison

The frozen offline baseline remains separate from live metrics:

| Metric | Deterministic baseline | Live model |
|---|---:|---:|
| Command precision | 95.12% | 74.86% |
| Command recall | 72.22% | 80.86% |
| Canonical exact turn | 73.08% | 60.26% |
| Parameter fidelity | 68.29% | 73.17% |
| Unsupported-action FP rate | 7.14% | 78.57% |
| Reasoning recall | 0% | 18.18% |
| Patient-question recall | 0% | 58.33% |
| Mentor-answer recall | 0% | 0% |

This table is a side-by-side diagnostic, not a combined score and not model-vs-deterministic agreement.

## Evidence limitations

Every planned call has a row, fixture ID and repetition. However, the existing harness loses `rawProviderOutput` and returned model metadata whenever downstream normalization throws. Ten rows have this evidence gap; two additional timeout rows correctly have no provider response. No retry was performed because it would change the pre-specified denominator.

This prevents calling the evidence package fully complete even though coverage is 176/176. Wave 2.2 should first make the harness retain raw provider responses before downstream validation, then freeze a new run protocol.

## Gate and decision by command class

The global gate failed: precision <98%, recall <95%, reasoning recall <95%, mentor interpretation <95%, unsupported false positives were non-zero, stability was poor and the live pipeline had failures. Schema-valid rate and accepted-high-risk controls alone are insufficient.

| Class | Decision | Evidence |
|---|---|---|
| History recognition | `ELIGIBLE_FOR_WAVE3` | 100% P/R/exact, 4/4 fixtures stable, zero failures; eligibility only, not activated here |
| Examination recognition | `SHADOW_ONLY` | Recall 66.67%; unstable in 2/5 fixtures |
| Investigation recognition | `SHADOW_ONLY` | Recall 82.05%; command-unstable in 7/10 fixtures |
| Compound turns | `SHADOW_ONLY` | P/R 91.30/77.78%; all 8 fixtures unstable |
| Patient questions | `SHADOW_ONLY` | P/R 66.67/66.67%; one topic substitution and low patient-question recall |
| Reasoning extraction | `SHADOW_ONLY` | P/R 35.29/18.18 overall; all reasoning fixtures semantically unstable |
| Contextual mentor answers | `SHADOW_ONLY` | 0% accuracy; output routed into action/reasoning commands |
| Vague/unsupported handling | `SHADOW_ONLY` | 66.67% category false-positive rate; unsupported actions emitted consistently |
| Medication recognition | `SHADOW_ONLY` | Recall 88.89%, failures and instability |
| Medication dose/unit/route | `DETERMINISTIC_ONLY` | Binder/domain rules remain authoritative regardless of recognition |
| Infusion volume/duration | `DETERMINISTIC_ONLY` | Numeric parameters remain binder-controlled |
| Monitoring/reassessment timing | `DETERMINISTIC_ONLY` | Numeric timing remains binder-controlled |
| Operative/procedural commitment | `DETERMINISTIC_ONLY` | V04 promotion in 6/10 runs |

Overall: **NO-GO for Wave 3**. No Wave 3 authority was implemented.

## Verification

Raw evidence: `docs/evidence/WAVE21_LIVE_SHADOW_RAW_2026-08-28.json`  
Detailed failures: `docs/WAVE21_LIVE_ERROR_ANALYSIS_2026-08-28.md`

`npm run verify` — PASS: content check/build, **255/255 tests**, offline corpus generation, ESLint and production Vite build.
