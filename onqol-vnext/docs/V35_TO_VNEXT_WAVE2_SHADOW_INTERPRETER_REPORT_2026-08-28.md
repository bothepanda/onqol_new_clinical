# V3.5 to vNext Wave 1.1 and Wave 2 shadow-interpreter report

> **Superseded by Wave 2.1:** the fixture-injected figures in this historical
> report are not model-performance measurements. Current methodology and
> evidence: `docs/V35_TO_VNEXT_WAVE21_LIVE_SHADOW_EVALUATION_2026-08-28.md`.

Date: 2026-08-28  
Decision: **NO-GO for Wave 3 hybrid activation**

## Outcome

Wave 1.1 corrects reasoning semantics without changing clinical truth:

- `observation.active` is a revisable current position; omitted means no update;
- differential items carry `active`, `deprioritized` or `ruled_out`, while current-active and ever-mentioned concepts are separate;
- sticky `workingDiagnosis.uncertaintyStated` is renamed `uncertaintyExpressed`;
- `pilotReady` is derived from session purpose, preset runtime status, complete patient-truth approval and (for production) production release approval.

APP-001 through APP-005 remain `pilotReady: false`. No case, review status,
trajectory, treatment effect, score, safety rule or hospital rule was promoted or
changed.

## Wave 2 architecture

`interpretTurn.js` remains the public entrypoint. Its deterministic result is
the only interpretation passed to command validation and execution. With
`AI_INTERACTION_V2 === true`, a model request is started as a non-blocking
shadow operation. Its result passes through:

1. strict top-level and command/output schema validation;
2. allowlisted command, parameter and concept validation;
3. ordinary command completeness validation;
4. verbatim-evidence and high-risk parameter-invention checks;
5. structured comparison with the deterministic result;
6. append-only `ai_telemetry` storage outside the clinical event log.

The model receives raw text, locale, disclosed observations/results, location,
current management intent, open mentor/staff questions and currently exposed
pending-decision option IDs. It does not receive patient truth, phenotype,
morphology, trajectory, operative truth, future events, expected answers,
scores or safety classifications. The reasoning-concept registry is shared and
case-independent; it records recognizable learner claims, not the current
patient's diagnosis.

Provider timeout, malformed JSON, unknown IDs, invented medication parameters
and tentative-plan promotion all produce telemetry only. They cannot create a
command event, reasoning event, clock change, mentor change or patient change.
Clinical replay remains a pure function of seed/content and domain events.

## Corpus

The reproducible offline corpus contains **56 cases**:

| Category | Cases |
|---|---:|
| Compound turns | 8 |
| Reasoning revisions/claims | 8 |
| Medications/infusions | 7 |
| Investigations | 10 |
| Examination | 5 |
| History | 4 |
| Patient questions | 4 |
| Vague/unsupported | 5 |
| Mentor answers | 2 |
| KK sanity | 1 included in examination |
| English sanity | 1 |
| Injected provider failure | 1 |
| Injected schema failure | 1 |

Sources are tagged per fixture: adapted V3.5 semantic-router/reasoning language,
sanitized replay language, current vNext regressions and adversarial
non-invention cases. These are behavioral-language fixtures only, never
clinical evidence.

## Historical injected-output metrics (invalid as performance evidence)

These figures came from injecting the labels themselves as fixture outputs.
They are retained only to document why Wave 2.1 replaced the methodology and
**must not be used as model or adapter quality evidence**.

| Metric | Result |
|---|---:|
| Deterministic commands | 42 |
| Model commands | 56 |
| Exact command agreement | 34/56 (60.71%) |
| Command-type precision | 96.08% |
| Command-type recall | 96.08% |
| Invented commands against labels | 2 |
| Invented numeric parameters | 1 |
| High-risk invention findings | 4 |
| Reasoning-domain recall | 100% |
| Unresolved-fragment recall | 100% |
| Ambiguity recall | 100% |
| Schema-validation failures | 1 injected case |
| Provider fallbacks | 1/56 (1.79%, injected) |

The full generated evidence is
`docs/evidence/WAVE2_SHADOW_CORPUS_METRICS_2026-08-28.json`.

## Representative disagreements

- `расспрошу подробно`: labeled model recognizes history; deterministic parser misses it.
- `живот пасматреть`: labeled model recognizes the typo; deterministic parser misses it.
- `общий анализ крови и КТ живота`: labeled model returns both tests; deterministic parser returns CT only.
- KK compound examination/history: labeled model returns both; deterministic parser returns history only.

These are shadow observations, not permission to execute model commands.

## Hallucination and invention findings

- `цефазолин 2` was adversarially expanded to `2 г в/в`: dose unit, converted
  numeric dose and route were all flagged; output remained non-authoritative.
- `можно подготовить к потенциальной операции` was adversarially promoted to a
  committed operative plan; the tentative-to-commitment check rejected it.

## Provider and validation failures

An injected timeout produces `provider_fallback`; malformed JSON produces the
same safe fallback class; an unknown test ID produces `validation_failed`; an
incomplete top-level object produces `schema_invalid`. In every case the
deterministic experience and domain event log are unchanged.

## Recommendation

**NO-GO for Wave 3.** The isolation architecture is ready for shadow collection,
but 60.71% exact agreement and the deliberately demonstrated high-risk
invention modes are not an activation basis. Before hybrid authority: run the
same corpus and sanitized replays through the configured live provider, require
zero high-risk invention, investigate every command disagreement, define an
owner-approved acceptance threshold, and repeat provider-failure/latency tests.

## Verification

- `npm run verify`: **253/253 tests passed**;
- content check and generated-content rebuild passed;
- 56-case corpus/report generation passed;
- ESLint and production Vite build passed.

## Exact files changed in this task

- `docs/ARCHITECTURE.md`
- `docs/KNOWN_GAPS.md`
- `docs/REPLAY_SCHEMA.md`
- `docs/V35_TO_VNEXT_WAVE2_SHADOW_INTERPRETER_REPORT_2026-08-28.md`
- `docs/evidence/WAVE2_SHADOW_CORPUS_METRICS_2026-08-28.json`
- `package.json`
- `scripts/runWave2ShadowCorpus.mjs`
- `src/ai/interpreter/deterministicInterpreter.js`
- `src/ai/interpreter/interpretTurn.js`
- `src/ai/interpreter/modelConceptValidation.js`
- `src/ai/interpreter/modelInterpreter.js`
- `src/ai/interpreter/modelOutputSchema.js`
- `src/ai/interpreter/shadowComparison.js`
- `src/ai/interpreter/shadowInterpreter.js`
- `src/ai/interpreter/shadowInterpreter.test.js`
- `src/ai/providerClient.js`
- `src/app/session/useSession.js`
- `src/content/shared/interaction/concepts.yaml`
- `src/core/reasoning/reasoningState.js`
- `src/core/reasoning/reasoningState.test.js`
- `src/core/replay/buildDebrief.js`
- `src/core/replay/replayIntegrity.test.js`
- `src/core/session/createSession.js`
- `src/core/session/sessionPurpose.js`
- `src/core/session/sessionPurpose.test.js`
- `src/core/session/submitLearnerTurn.js`
- `src/core/state/worldState.js`
- `src/tests/fixtures/wave2ShadowCorpus.js`
- `src/tests/wave2ShadowCorpus.test.js`
- `src/tests/wave2ShadowCorpusRunner.js`

The content build also rewrote ignored generated JSON artifacts under
`src/content/generated/`.
