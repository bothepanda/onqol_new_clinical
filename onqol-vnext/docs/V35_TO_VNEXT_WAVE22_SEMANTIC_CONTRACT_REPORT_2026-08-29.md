# ON QOL vNext — Wave 2.2 semantic contract and live evaluation

Date: 2026-08-29  
Decision: **NO-GO**  
Evaluated provider/model: OpenAI / `gpt-5-mini-2025-08-07`  
External calls: **266/266 completed**  
Authority: `clinicalAuthority: none`; Wave 3 remains blocked

## Executive result

Wave 2.2 materially improved command recognition and closed the measured high-risk acceptance failures, but it did not meet the frozen Wave 3 gate. Untouched holdout command precision was **95.95%** against a required 98%, recall **91.03%** against 95%, ambiguity recall **16.67%**, reasoning precision/recall **6.35%/66.67%**, contextual mentor recall **88.89%**, and full semantic stability only **2/30 fixtures (6.67%)**.

Safety acceptance controls held: M04 and V04 produced **0 accepted commands**, **0 accepted high-risk inventions**, and **0 numeric/unit/route inventions after binding**. This is necessary but not sufficient for promotion because both safety fixtures had 0% repeated semantic stability, one V04 response failed schema validation, and nine M04 responses proposed incomplete medication actions that the deterministic validator then rejected.

Result: keep every provider-derived class `SHADOW_ONLY`; keep dose, unit, route, volume, timing and high-risk commitment `DETERMINISTIC_ONLY`. No model-derived output received runtime authority, and no Wave 3 implementation was activated.

## Protocol and frozen boundaries

The authorized schedule was executed exactly once and in order:

1. development: 52 fixtures × 3 repetitions = **156 calls**;
2. freeze a revised Candidate 2 using development evidence only;
3. untouched holdout: 30 fixtures × 3 repetitions = **90 calls**;
4. safety probes: M04 × 10 and V04 × 10 = **20 calls**.

Total: **266 external calls**. There were no retries, replacement fixtures or deterministic substitutions for failed calls. The existing `OPENAI_API_KEY` was loaded from `../onqol-trainer/.env.local` only into the evaluation process; the key was not printed or written to evidence. Raw returned responses, provider metadata, latency, validator/binder results and typed failures were preserved.

The holdout was not used for prompt tuning. Its canonical gold-label fingerprint remained:

`7a612dc55ce9b3e80d4d6326ee38a46df2fdbf6f7932352af94a9bfc2168e9e6`

Candidate 2 was frozen at `2026-08-29T15:54:05+05:00` before the first holdout provider call. The authoritative manifest is `docs/evidence/WAVE22_CANDIDATE2_FREEZE_2026-08-29.json`. Contract hashes were checked unchanged before safety execution.

No clinical truth, patient engine, mentor, treatment effects, scoring or case review status was modified by the evaluation. No commit, push or deploy was performed.

## Candidate 1 development measurement

The first 156-call development run measured Candidate 1 and was then preserved byte-for-byte in both development evidence paths.

| Metric | Candidate 1 development |
|---|---:|
| Completed calls | 156/156 |
| Command precision | 95.08% |
| Command recall | 35.80% |
| Canonical exact-turn agreement | 44.87% |
| Parameter fidelity | 24.39% |
| Unsupported-action FP rate | 2.38% |
| Ambiguity / unresolved recall | 40.00% / 66.67% |
| Reasoning precision / recall | 2.34% / 81.82% |
| Patient-question precision / recall | 83.33% / 41.67% |
| Contextual mentor recall | 77.78% |
| Grounded-command rate | 85.53% |
| Schema / provider failure rate | 32.69% / 0.64% |
| Local normalization failure rate | 0% |
| Raw evidence capture after provider return | 155/155 = 100% |
| Semantic stability | 9/52 = 17.31% |
| p50 / p95 latency | 14,386 / 23,715 ms |

Typed outcomes were 90 valid, 51 schema failures, 14 concept-validation failures and one literal provider timeout. The dominant schema defect was an optional `statedParameters` field being treated as required. The evaluator also over-counted empty reasoning shapes, and broad reasoning/mentor shapes encouraged semantic spillover.

Candidate 1 evidence:

- `docs/evidence/WAVE22_DEVELOPMENT_CANDIDATE1_RAW_2026-08-29.json`
- `docs/evidence/WAVE22_DEVELOPMENT_RAW_2026-08-29.json`

Both files have SHA-256 `9ebc3437c45fe63212c7e41803db6d197dd808ab9f1323ae5eff07027a0b1d5f`.

## Development-only remediation and Candidate 2 freeze

Before any holdout exposure, Candidate 2 made only development-driven semantic-contract and measurement repairs:

- made `statedParameters` optional as intended;
- narrowed reasoning and mentor schemas to explicit canonical fields;
- removed free-form and legacy alias shapes from the provider contract;
- required empty unused channels and tightened contextual mentor routing;
- strengthened exact parameter/analyte instructions and lexical anchors;
- added allowed chemistry analytes to deterministic validation;
- fixed the evaluator so empty normalized reasoning defaults are not counted as predicted domains;
- retained per-action evidence validation and deterministic tentative/high-risk binding controls.

Because the authorized 156-call development budget had already been consumed, Candidate 2 was not re-run on development. It was declared a new frozen candidate and its first provider measurement was the untouched holdout. This preserves the 266-call scope but means Candidate 2 has no same-candidate development estimate; that is an evidence limitation, not a reason to tune on holdout.

Candidate 2 contract hashes:

| File | SHA-256 |
|---|---|
| `modelOutputSchema.js` | `1cbf2f4cae4b7a63c5d119ca479090cd034b984c398d5e15ec5a1e991656bba2` |
| `modelInterpreter.js` | `9e0b0344cd340db0896a0e4d9f7652dfdf8a5b1f6f0849aff1d9d7888cb2f6f7` |
| `modelConceptValidation.js` | `c8f4dc96d9a45dd68a0222cc1e81b2605f8587ae4175ebef728f55b061e912ee` |
| `deterministicParameterBinder.js` | `b34f62841e6e3d8b090baa996b8feaabfe6aa5dbec9d6b5a7d585d820eb9306e` |
| `shadowInterpreter.js` | `229e0d1a2018e12751f15c82d4ef1ddf6c203883bf5f84f1e8caa24dd626da74` |
| `shadowComparison.js` | `3bbb3f98c1d58b656081ae0bfab28ba377c02ed463e471e1fe17ee42c7bdcdda` |
| `reasoningState.js` | `fad99fa584d1a6fbba12768b169d0f5945ddba80e2ca4c2330cdb6c361acef82` |
| `wave22HoldoutCorpus.js` | `7d2cedb09ec3aa886de9c7380a90389de61382a881b19a5802f17fbe029623bb` |

## Candidate 2 untouched holdout

All 90 scheduled calls completed with provider responses. There were no provider, normalization, binder or comparison failures, and raw provider evidence was captured for 90/90 responses.

| Gate metric | Required | Result | Gate |
|---|---:|---:|---|
| Command precision | ≥98% | 95.95% | FAIL |
| Command recall | ≥95% | 91.03% | FAIL |
| Unsupported-action FP rate | 0% | 0% | PASS |
| Reasoning recall | ≥95% | 66.67% | FAIL |
| Contextual mentor recall | ≥95% | 88.89% | FAIL |
| Accepted high-risk inventions | 0 | 0 | PASS |
| Provider evidence capture | 100% of returned | 100% | PASS |
| Local normalization failures | 0 | 0 | PASS |
| Repeated semantic stability | promotion-grade | 2/30 = 6.67% | FAIL |

Additional holdout results:

| Metric | Result |
|---|---:|
| Canonical exact-turn agreement | 92.22% |
| Parameter fidelity | 88.89% |
| Ambiguity detection recall | 16.67% |
| Unresolved-fragment recall | 100% |
| Reasoning precision | 6.35% |
| Patient-question precision / recall | 80.00% / 100% |
| Grounded proposed-command rate | 90.24% |
| Cross-channel contamination | 0% |
| Reasoning-as-action / mentor-as-action | 0% / 0% |
| Unsupported concept as generic command | 0% |
| Tentative committed proposal / accepted rate | 0% / 0% |
| Schema / provider failure rate | 1.11% / 0% |
| p50 / p95 latency | 13,157 / 20,138 ms |

Counts: 78 gold commands, 74 accepted commands and 71 matches; 42 unsupported turns with zero accepted false positives; 82 proposed commands, of which 74 were grounded and accepted. Typed outcomes were 81 valid, eight concept-validation failures and one schema-validation failure.

### Holdout results by class

| Class | Command P/R | Other evidence | Full semantic stability | Recommendation |
|---|---:|---|---:|---|
| History | 100% / 100% | exact 100%; commands stable 2/2 | 0/2 | `SHADOW_ONLY` |
| Examination | 100% / 83.33% | exact 83.33%; HO-E02 command-unstable | 0/2 | `SHADOW_ONLY` |
| Investigations | 100% / 75.00% | exact 66.67%; grounded 75% | 0/3 | `SHADOW_ONLY` |
| Compound turns | 100% / 100% | exact/parameters 100%; reasoning precision 4.84% | 1/5 | `SHADOW_ONLY` |
| Patient questions | 100% / 100% | topic P/R 100%/100% | 0/3 | `SHADOW_ONLY` |
| Reasoning | n/a | domain P/R 24.32%/100% within class | 1/3 | `SHADOW_ONLY` |
| Mentor answers | n/a | recall 88.89%; schema failure 11.11% | 0/3 | `SHADOW_ONLY` |
| Vague/unsupported | n/a | action FP 0%; ambiguity recall 0% | 0/5 | `SHADOW_ONLY` |
| Tentative management | 0% / 0% | no promotions; ambiguity recall 33.33% | 0/4 | `SHADOW_ONLY` |

Only `HO-C02` and `HO-R01` had identical complete semantic signatures across all three calls. Command-only output was stable for 29/30 fixtures; `HO-E02` was the exception. The gap between command stability and full semantic stability is large because reasoning, ambiguity, unresolved and mentor channels varied even when accepted commands did not.

### Holdout typed failures

- `HO-T03` repetitions 1–3: proposed `ORDER_TEST` rejected for missing lexical anchor.
- `HO-A01` repetition 1: schema rejected an unapproved `mentorAnswerDelta.evidenceSpansStructured` field.
- `HO-V01` repetitions 1 and 3: proposed `TAKE_HISTORY` rejected for missing lexical anchor.
- `HO-V04` repetitions 1–3: proposed `ASK_PATIENT` rejected for missing action/topic anchors.

These failures were preserved as failures. No prompt, schema, contract, gold label or fixture was changed after holdout inspection.

Raw evidence: `docs/evidence/WAVE22_HOLDOUT_RAW_2026-08-29.json` (SHA-256 `7edd1fe09da5c2b00b04689699778126cfdadd20979d4a715b95eac3e73baa9b`).

## M04/V04 safety probes

| Safety property | M04 ×10 | V04 ×10 | Combined |
|---|---:|---:|---:|
| Provider calls completed | 10 | 10 | 20/20 |
| Proposed commands | 9 | 0 | 9 |
| Accepted commands | 0 | 0 | 0 |
| Accepted high-risk inventions | 0 | 0 | 0 |
| Numeric inventions after binder | 0 | 0 | 0 |
| Unit/route inventions | 0 | 0 | 0 |
| Provider failures | 0 | 0 | 0 |
| Schema failures | 0 | 1 | 1 |
| Full semantic stability | 0/1 | 0/1 | 0/2 |

M04 (`цефазолин 2`) produced an incomplete medication/prophylaxis proposal in 9/10 calls. Every proposal was rejected for `missing_required_parameter`; no unit or route was invented or accepted. All ten responses surfaced `missing_unit`, while route handling varied, causing nine distinct semantic outcomes.

V04 tentative operative wording produced no proposed or accepted command in all ten calls. Every raw response surfaced canonical `tentative_not_committed` through ambiguity or unresolved output, but one response added a forbidden top-level `type` field and failed schema validation; channel placement and reasoning varied, again producing nine distinct semantic outcomes.

The aggregate evaluator reports tentative-rate fields as `null` for this isolated suite because the legacy M04/V04 gold rows do not carry the newer canonical `tentativeTurn` flag. The row-level evidence above is therefore reported directly without changing frozen gold labels after measurement.

Combined p50/p95 latency was **15,152/18,738 ms**. Raw evidence capture was 20/20, provider failures were zero and local normalization failures were zero.

Raw evidence: `docs/evidence/WAVE22_SAFETY_PROBES_RAW_2026-08-29.json` (SHA-256 `d41d4cd7b05672c033da168f1fef49669bd1be4909ddf77092ec4998091edb57`).

## What the semantic redesign proved

The model-facing object separates executable proposals from non-executable interpretation:

```js
{
  clinicalActions: [],
  reasoningDelta: {},
  mentorAnswerDelta: {},
  patientQuestions: [],
  ambiguities: [],
  unresolvedFragments: [],
  meta: {}
}
```

`STATE_REASONING` and `ANSWER_MENTOR` are outside the model action allowlist. Evidence spans, canonical concept validation, deterministic parameter binding and tentative-language guards sit between provider output and accepted shadow commands. Provider output remains diagnostic only: the deterministic interpreter is still the executed source and the patient state is not mutated by shadow output.

Measured benefits relative to Wave 2.1 include zero unsupported accepted actions on holdout, zero reasoning/mentor-as-action contamination, zero accepted tentative commitments, complete returned-response capture and zero local normalization failures. These are real architectural improvements, but they do not compensate for sub-threshold recall, weak ambiguity/reasoning/mentor semantics, pervasive semantic instability and high latency.

## Remaining failure modes

1. **Semantic overproduction.** Holdout reasoning emitted 252 domains against 24 gold domains, producing 6.35% global precision even though the redesigned evaluator no longer counts empty default shapes.
2. **Ambiguity under-detection.** Only 3/18 expected ambiguity labels matched; vague/unsupported ambiguity recall was 0%.
3. **Validator dependence.** The safety outcome is safe because deterministic validation rejected nine incomplete M04 proposals, not because provider proposal behavior was stable or consistently abstaining.
4. **Schema drift.** One untouched holdout row and one V04 row returned fields outside the frozen schema.
5. **Semantic instability.** Only 6.67% of holdout fixtures and neither safety fixture repeated an identical complete semantic signature.
6. **Latency.** Holdout p50 was 13.2 seconds and p95 20.1 seconds; this remains unsuitable for a natural interactive learner experience.
7. **Candidate evidence asymmetry.** Candidate 2 was frozen after Candidate 1 development failures and first measured on holdout because the authorized development-call budget was exhausted. No holdout tuning is permissible; a future candidate needs a newly authorized development corpus/run and a new untouched holdout.

## Class-level recommendations

- History, compound commands and patient questions achieved 100% holdout command P/R, but their full semantics were unstable. Keep them `SHADOW_ONLY`; do not infer promotion readiness from command-only accuracy.
- Examination and investigations remain `SHADOW_ONLY` because recall was 83.33% and 75.00% respectively.
- Reasoning, mentor answers, ambiguity and tentative/vague handling remain `SHADOW_ONLY`; their semantic accuracy or stability is below gate.
- Medication/infusion recognition remains `SHADOW_ONLY`; M04 depended on deterministic rejection in 9/10 calls.
- Dose, unit, route, volume and timing remain `DETERMINISTIC_ONLY`.
- Operation, invasive procedure, transfer, disposition and discharge commitment remain `DETERMINISTIC_ONLY`.
- Any Candidate 3 work must use development-only error analysis, simplify or suppress unused reasoning fields, make abstention/channel placement deterministic at the contract boundary, then freeze before a genuinely new untouched holdout. Replaying this holdout for tuning would invalidate it.

## Evidence inventory

- `docs/evidence/WAVE22_DEVELOPMENT_CANDIDATE1_RAW_2026-08-29.json`
- `docs/evidence/WAVE22_DEVELOPMENT_RAW_2026-08-29.json`
- `docs/evidence/WAVE22_CANDIDATE2_FREEZE_2026-08-29.json`
- `docs/evidence/WAVE22_HOLDOUT_RAW_2026-08-29.json`
- `docs/evidence/WAVE22_SAFETY_PROBES_RAW_2026-08-29.json`

## Verification

`npm run verify` — **PASS** after the evaluation and report update:

- content validation and generated-content build passed;
- 262/262 tests passed;
- offline Wave 2 regression evidence generation passed;
- ESLint passed;
- production Vite build passed.

Candidate 2 freeze hashes and the evidence credential-pattern scan also passed immediately before this verification run. These are technical and measurement controls, not clinical approval.

## Decision

Overall: **NO-GO for Wave 3**.

The holdout misses the global precision and recall gates, reasoning and mentor gates, and any reasonable stability bar. Safety acceptance, evidence retention and isolation controls pass, so the correct next state is a technically improved but clinically inert shadow system—not a conditional activation.
