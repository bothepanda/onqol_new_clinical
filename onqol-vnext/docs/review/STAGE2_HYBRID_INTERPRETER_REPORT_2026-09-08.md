# Stage 2 hybrid interpreter: engineering changes and blocked live acceptance

Date: 2026-09-08. Verdict: **NO-GO**. Stage 2 is not accepted for resident use.

The infrastructure repairs are implemented and locally verified. Live semantic quality is **not measured**: the models endpoint returned 200 and listed `gpt-5-mini`, but the first completion returned **429 / credit_balance_exhausted / insufficient_quota**. No corpus calls were attempted. A separate intentionally invalid credential returned 401 and preserved the learner turn.

## Decisions delegated by the owner

The owner requested execution and then delegated the six implementation choices with “сделай как лучше”. Selected scope is ACTION only; REASONING and MENTOR_ANSWER remain deterministic. Runtime latency budgets are hybrid 8000 ms, browser provider 7000 ms, gateway 6000 ms. The model candidate is `gpt-5-mini`, Chat Completions, minimal effort, at most 2048 completion tokens. This is an available candidate, not a measured winner.

Server limits: at most 40 calls and $0.25 reserved per session, $5 reserved per pilot process/ledger. The selected deployment is a single Node process behind the site's controlled access boundary. Its local JSON budget ledger survives restarts. Separate replicas and independent ledgers do not share a budget; distributed/authenticated enforcement remains a deployment requirement.

Raw completions are excluded from hybrid learner-session exports. Explicit local evidence scripts retain upstream responses; they do not transmit patient truth or API keys. Gold annotations describe literal requested intent, not clinical correctness. They are `draft_linguistic`, with no claimed independent reviewer or clinical approval.

Model pricing and schema structure were checked against official documentation (accessed 2026-09-08): [GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Documentation does not establish access or billing for this account; those were checked separately.

## Infrastructure (A)

| Item | Result and evidence |
| --- | --- |
| A1 key/history | Current local key not found in `git log -p --all -S sk-`. Six long pattern matches were inspected by JSON path: all were substrings inside historical `encrypted_content`, not standalone API keys. Rotation is **not performed or verified**; account credential administration is unavailable here. |
| A2 access/balance | Models: 200, requested model present. Completion: 429 `credit_balance_exhausted`. Listing models does not establish usable credit. |
| A3 model config | `src/ai/modelConfig.js` owns the live candidate, endpoint, effort, prices and budgets. Gateway and smoke use it; Wave 2.3 imports its explicitly historical three-model configuration and rates. Historical Wave 2.3 defaults are deliberately not replaced with a new benchmark candidate. |
| A4 strict schema | Stage 2 uses `stage2ActionFormat`: closed objects, every field required, nullable optional concept fields, no generated numeric treatment parameters. Recursive schema test passes. Historical non-strict Wave 2.3 schema remains available to its old path. Live schema acceptance remains **unverified** because of quota. |
| A5 format forwarding | Browser client -> gateway -> provider body is tested end to end with a mock. Raw live 429 is retained in `STAGE2_HYBRID_LIVE_SMOKE_2026-09-08.json`; there is no valid live completion. |
| A6 errors | Browser errors use the fixed public codes. Provider error bodies and exception messages are not proxied. Server logs contain normalized code and upstream status. |
| A7 timeout | 8/7/6-second ladder; browser AbortError is converted into a fresh typed error (DOMException.code is read-only). Export records fallback and provider_timeout. |
| A8 slow UI | Visible live status, disabled composer, in-flight submission guard, busy reset in finally. Desktop/mobile e2e verifies timeout recovery and exactly one recorded turn. |
| A9 explicit build/CI | `npm run build:hybrid`; separate mock-browser config and vNext CI workflow. Default build remains deterministic. An explicit diagnostic build is not a pilot release decision. |
| A10 built host | `server/pilotServer.mjs` serves dist and gateway together; preview also mounts the gateway. Local built-host check: HTML 200, API 501 when no key, not 404. Unavailable gateway is reported in telemetry and browser console. Static-only hosting still cannot serve this API. |

## Hybrid behavior (B)

| Item | Result and limit |
| --- | --- |
| B1 telemetry | Event payload `semanticTelemetry` and `export.interpreter.telemetryByTurn` contain status, errorCode, elapsedMs, model, proposed count/commands, added count/commands, rejected entries, schemaErrors, conceptErrors and costUsd. Unknown cost stays null. Legacy `byTurn` mode strings are preserved. Raw output is not included. |
| B2 confident wrong readings | Escalation policy is unchanged. The task's `‹pilot turn E› -> ultrasound_abdomen` example does not reproduce now: it maps to `pelvic_ultrasound` (support in content is a separate issue). A different read-only probe found whole-turn chemistry matching can consume `бхак и сделай процедуру Z` without escalating. Corpus runner records `silentlyWrongDeterministicTurns`; no population rate is claimed without a run. A future agreement check needs a separate product decision. |
| B3 scope | ACTION only. No semantic reasoning/mentor activation. |
| B4 ellipsis/context | Narrow staff clarification only; Stage 2 explicitly filters its keys and params before transport. Draft corpus includes 30 contextual/elliptical surface variants. Live ellipsis quality is unmeasured. |
| B5 merge | Same primary test cannot be appended again with a different analyte list; duplicate rejection is now recorded. Dedicated chemistry merge regression passes. |
| B6 economics | Actual usage-derived cost exported when present. Gateway reserves a conservative byte-based input bound plus maximum output cost before a call; failed calls retain reservations. Node host persists the ledger. IP cap still exists alongside session limits. Session identities are client-supplied, so this is not a substitute for production authentication. |
| B7 caching | No shared text+allowlist cache: clarification context and repeated clinical actions make that key unsafe. UI suppresses concurrent duplicate submissions. Network retries across requests are not idempotent; there is no automatic retry in the evaluation runner. |
| B8 injection | Ten draft injection cases prepared. Live injection suite **not run**; mock behavior is not substituted for live evidence. |
| B9 hidden truth | Request sentinel test covers patient/future fields at top level and inside staff clarification. Only the approved narrow request keys leave the interpreter. |
| B10 replay | Hybrid event export reproduces state with network access replaced by a throwing provider. No model call is made during replay. |

The existing lexical concept validator remains restrictive: a mock proposal mapping `ультразвук живота` to abdominal ultrasound was rejected as `lexical_anchor_missing`. A different existing validated mapping (`общий анализ крови -> cbc`) exercises successful mock addition. No dictionary or clinical rule was tuned to manufacture a live quality improvement.

## Corpus and freeze

200 draft surface records: 9 real pilot turns, 111 paraphrase variants, 30 ellipsis variants, 20 slang/typo, 20 negative and 10 injection. Split: 150 development / 50 holdout. The 111 paraphrases come from 37 base groups, and the 30 ellipses from 10 base groups; surface variants are not independent observations. Related variants and the real pilot session stay in one partition.

**C1 is not satisfied:** 51 additional real pilot turns are missing; synthetic cases do not replace them. Independent gold review is missing. The candidate freeze is `CANDIDATE_FROZEN_NOT_ACCEPTANCE_ELIGIBLE`; it hashes prompt source, strict schema, interpreter/binder/validator, model configuration, relevant runtime/evaluation files, generated content and both corpus splits. Development/holdout artifacts have null metrics and explicit `BLOCKED_BEFORE_CALLS`, not synthetic successful responses. Holdout has not been consumed by a provider run or used to tune prompts.

`stage2:prepare` verifies an existing candidate freeze rather than silently overwriting a changed one. `stage2:development` requires a green live strict-schema probe. `stage2:holdout` additionally blocks incomplete corpus/review. The runner refuses replacement of any started suite, journals attempted rows, retains failures in the denominator and records returned payloads. A flushed per-response JSONL journal is written before JSON parsing and gateway normalization; malformed bodies and transport errors are retained, and an echoed credential is redacted. The evaluator was tested end to end with an independent successful mock row and a quota-failure row, including execution outcomes and unchanged denominator.

After this measurement-infrastructure hardening, the unconsumed candidate was explicitly re-frozen with the same prompt, model and corpus. Its prior manifest and both blocked corpus artifacts are retained in `docs/evidence/stage2-candidate-history/`. The earlier smoke is retained in `stage2-smoke-history/`; the final smoke again returned live 429 `credit_balance_exhausted`. No held-out completion was requested.

## C2 gates

| Metric | Required | Observed | Verdict |
| --- | --- | --- | --- |
| Paraphrase improvement | >=20 percentage points | Not measured | NO-GO |
| Executed command precision | >=0.98 | Not measured | NO-GO |
| Invented parameters | 0 | Live population not measured; binder/schema unit checks pass | NO-GO |
| Ungrounded high-risk commands | 0 | Live population not measured | NO-GO |
| Injection commands | 0 | Live suite not run | NO-GO |
| Fail-closed errors | 100% | Tested 401, 429, malformed JSON, timeout; live 401 and live quota 429 preserved commands | PASS for tested cases |
| Turn p95 | <=8000 ms | Live corpus p95 unavailable; browser timeout scenarios recover | NO-GO |
| Deterministic regression | 0 | 384/384 unit tests, 4/4 standard e2e, 8/8 hybrid mock e2e | PASS |
| Session cost | <=$0.25 | Reservation cap implemented; fresh successful live session absent | NO-GO |

No threshold was changed. The metrics module keeps missing costs unknown and has tests for denominator retention, parameter invention and all-gates-required logic. A corpus score alone cannot promote the pilot.

## Acceptance and commands

| Command | Result |
| --- | --- |
| `npm run verify` | PASS: content check, 384 tests, existing offline regression, lint, production build |
| `npm run test:e2e` | PASS 4/4 |
| `npm run test:e2e:hybrid` | PASS 8/8 across desktop/mobile, screenshots in test-results |
| `npm run build:hybrid` | PASS, explicit diagnostic build |
| `npm run stage2:host-check` | PASS, built HTML and API route |
| `npm run hybrid:smoke` | PROVIDER_UNAVAILABLE, nonzero exit, live 429 |
| `npm run stage2:broken-key` | PASS, live 401 and deterministic fallback |
| `npm run stage2:prepare` | 200 draft records frozen, subsequent check unchanged |
| `npm run stage2:acceptance` | BLOCKED_BEFORE_CALLS, export null, nonzero exit |
| `node scripts/acceptanceInteractionWave.mjs` | PASS 10 checks; deterministic baseline only, dated 2026-09-08 |

To run the built diagnostic app locally: `npm run build:hybrid`, then `npm run start:hybrid` (default http://127.0.0.1:4180). Server-side `.env.local` supplies the key. Do not run multiple processes against the same file ledger. No public deployment, commit or push was performed.

## Remaining work

1. Rotate the server credential through the account's credential controls and restore completion credit. Retest models and one strict-schema completion; do not send the key in chat.
2. Supply at least 51 further real pilot utterances with provenance; independently review literal-intent gold, and create a new versioned acceptance corpus rather than silently editing this candidate freeze.
3. Run development once, freeze the accepted candidate, run untouched holdout and live injection cases once, and record a fresh successful learner_pilot session. Evaluate every C2 gate separately; independent gold and evaluator review remain prerequisites for acceptance claims.
4. Resolve production access control and shared transactional budgets if deployment extends beyond one controlled Node process.

Clinical content, calibration scope, review_status, deterministic commands and clinical authority boundaries were not changed. **NO_GO_FOR_RESIDENT_PILOT** remains the honest release outcome.
