# V3.5 source-symbol audit before vNext interaction migration

Date: 2026-08-28  
Donor (read-only): `../onqol-trainer`, content `3.5.7`  
Target: current `onqol-vnext`  
Baseline before Wave 1: 235/235 tests, content check, lint and build passed.

This inventory records actual files and exports in the local V3.5 checkout. It
does not treat a legacy filename as permission to import that runtime. The
vNext architecture test continues to prohibit imports from `onqol-trainer`.

## Required donors

| Donor | Actual symbols and dependencies | Coverage inspected | Decision | Exact vNext target / known defect |
|---|---|---|---|---|
| `src/clinical/semanticRouter.js` | `ROUTER_INTENT_TYPES`, `SemanticRouterUnavailableError`, `buildAllowedConcepts`, `buildSemanticRouterPrompt`, `normalizeActionParameters`, `validateRouterOutput`, `routeUserInput`, Anthropic browser adapters. Depends on case/router schemas and legacy case contracts. | `semanticRouter.test.js` (19 tests: RU/KK, compound turns, hallucinated IDs, exact fragments, parameters). | **ADAPT** | Later waves split into deterministic/model/schema/concept-validation modules. Reject browser provider adapter and clinical-case dependency. Defects: legacy intent vocabulary is single-route oriented and transport is coupled to Case Card shapes. |
| `src/clinical/core/reasoningState.js` | `createEmptyReasoningState`, `verbatimOrNull`, `normalizeReasoningDelta`, `mergeReasoningState`, `mergeTurnReasoningDeltas`, flags and trajectory helpers. No patient engine dependency. | `v31Reasoning.test.js`, especially normalization, cumulative merge, quote guard, differential reordering, trajectory and no-scoring tests. | **ADAPT** | Wave 1 target: `src/core/reasoning/reasoningState.js`. Preserve learner-claim semantics and cumulative merge; rewrite snake_case and legacy action/concept coupling around vNext events. |
| `src/clinical/v25/turnKind.js` | `TURN_KINDS`, `CONVERSATIONAL_KINDS`, `classifyTurn`, pending-mentor interpretation, standalone reasoning, semantic resolution, duplicate suppression. Regex-heavy and tied to legacy session shapes. | Indirectly covered by `v31Reasoning.test.js` and planner/mentor tests. | **ADAPT** | Later parsed-turn planning. Do not port its regex matcher as clinical fallback. |
| `src/clinical/v25/turnPlanner.js` | `classifyOperativeLanguage`, `extractV25Actions`, `GENERIC_ADVANCE_PROMPTS`, `planClinicalTurn`. Depends on action extraction, case schema, scenario engine, reasoning merge, parameter safety, mentor policy and prerequisites. | Planner behavior covered across `v31Reasoning.test.js`, `mentorChannel.test.js` and runtime suites. | **ADAPT** | Keep `src/core/session/submitLearnerTurn.js` as orchestrator. Reject wholesale planner and legacy path assumptions. |
| `src/clinical/core/mentorHeuristics.js` | `SEVERITY`, `HINT`, `ENGINE_PHASES`, heuristic registry, `selectHeuristics`, `firedKey`. Depends on reasoning flags. | Mentor-channel selection, silence, once-per-session, phase and cross-disease tests. | **TEST-ONLY / ADAPT later** | Preserve behavioral fixtures; later translate only policy signals that fit vNext approved-rule boundaries. Disease-specific action proxies are rejected. |
| `src/clinical/core/mentorBrief.js` | `MENTOR_MOVE`, prerequisite/minimum helpers, `buildMentorCaseCard`, `buildRevealedMentorFacts`, `buildMentorBrief`, `renderMentorBrief`. Depends on legacy scenario, operationalization, rule eligibility and case cards. | `mentorChannel.test.js` fact allowlist, revealed-state, prompt and character-behavior tests. | **TEST-ONLY / ADAPT later** | Use as evidence for bounded context. Reject marked case card, hidden-data and legacy path dependencies. |
| `src/clinical/core/mentorAgent.js` | length bounds, leak/number/duplication validators, anchor validation, prompt builder and `runMentorAgent`. Depends on behavior spec, mentor policy and learner-address helpers. | `mentorChannel.test.js` validation, repair, fallback, silence and model-error cases; additional voice suites exist. | **ADAPT later** | Retain validation/fallback ideas, not current provider/prompt wiring. No role in Wave 1. |
| `src/clinical/diseases/appendicitis/router/conceptRegistry.js` | `CONCEPT_KINDS`, `APPENDICITIS_CONCEPTS`, lookup/kind/map helpers. | Direct semantic-router validity and map tests. | **ADAPT later** | Source for a vNext concept allowlist only; registry membership is recognition, never clinical approval. |
| `src/clinical/__tests__/semanticRouter.test.js` | 19 source tests. | Direct. | **TEST-ONLY** | Convert representative natural-language fixtures in later shadow-interpreter wave. Never treat transcripts as clinical evidence. |
| `src/clinical/__tests__/v31Reasoning.test.js` | 35 source tests. | Direct. | **TEST-ONLY / REUSE assertions** | Wave 1 ports schema initialization, merge, non-erasure, claim-vs-truth and replay assertions. Reject legacy engine/scoring/path assertions. |
| `src/clinical/__tests__/mentorChannel.test.js` | 43 source tests. | Direct. | **TEST-ONLY** | Preserve mentor boundary/silence/validation behavior for later waves; no mentor runtime migration in Wave 1. |

## Later supporting files located

| Concern | Actual source | Decision |
|---|---|---|
| adequacy and mentor policy | `src/clinical/core/mentorPolicy.js`: `ADEQUACY`, `MENTOR_MODE`, `SCAFFOLDING_LEVEL`, `classifyLearnerAdequacy` | **ADAPT later**; deterministic safety remains vNext-owned |
| persisted pending question | legacy working-memory fields consumed by `mentorPolicy.js`, `turnKind.js`, `turnPlanner.js` | **ADAPT later** to existing vNext `state.mentor.openQuestion` |
| strict router schema | `src/clinical/schemas/routerSchema.js`, schema `router-v3` | **ADAPT later**; one schema source, strict allowlists |
| model gateway | `server/openaiGateway.mjs`, gateway `2026-08-13.1` | **REJECT runtime copy / ADAPT security concepts**; vNext has its own gateway seam |
| provider client | `src/clinical/v25/openAIBackendClient.js` | **ADAPT later**; keep task separation and telemetry, not legacy endpoint contract |
| telemetry | client `.telemetry`, gateway telemetry, `src/clinical/analytics.js` | **ADAPT later** to vNext replay/export |
| hard-coded runtime path | `src/clinical/v35/runtimePath.js` | **REJECT**; must not replace vNext event/state/rule engines |

## Wave 1 boundary

Wave 1 ports only the reasoning-state concept: initialization, normalization,
cumulative merge and replay/export visibility. It makes no provider call,
executes no new clinical command, changes no patient truth, applies no score and
introduces no legacy pathway logic.

## Wave 1 completion

Completed on 2026-08-28 behind explicit session flag `AI_INTERACTION_V2`, which
defaults to `false` and is recorded in session state and replay export. The new
`reasoning-v2` state is cumulative learner-authored metadata; it cannot mutate
patient truth or physiology. Five Wave 1 regression tests cover initialization,
cross-turn merge, non-erasure, learner-claim isolation and replay/export.

Final verification after governance and Wave 1: 241/241 tests, content check,
lint and production build passed.
