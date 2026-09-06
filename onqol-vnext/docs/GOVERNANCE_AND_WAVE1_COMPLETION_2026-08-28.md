# Governance closure and V3.5 migration Wave 1

Date: 2026-08-28  
Target: current `onqol-vnext`

## Release-audience gate

Every application session must provide one explicit purpose:

- `internal_development`: accepts known development, preview, pending or later statuses;
- `faculty_preview`: accepts only `development_only` or `faculty_preview` presets;
- `learner_pilot`: accepts only `learner_enabled` or `approved_for_training` presets and requires the complete patient-truth inventory to be approved;
- `production`: requires `approved_for_training`, approved patient truth and `release_gate.production_allowed: true`.

Missing or unknown purpose, preset, status or required approval fails closed.
The decision is made in `createSession()` before patient generation. Direct
`generatePatient()` remains available for internal development and content tests.
The gate is an engine boundary and does not depend on whether a UI selector exists.

Current expected outcomes are locked by regression tests: APP-001 cannot run as
`learner_pilot`; APP-004 runs as `internal_development` but not `learner_pilot`;
APP-005 runs only in explicit development/faculty preview contexts; a future
learner-enabled or approved preset passes pilot only with approved patient truth.

## Migrated provenance

The four phenotype records migrated from V3.5 (`early_subtle`, `classic`,
`pelvic`, `late_complicated`) and APP-002's migrated demographic constraint now
use `evidence_strength: NEEDS_SOURCE`. The legacy `phenotypes.js` source is not
represented as independent expert consensus. Their review statuses remain
pending; no clinical approval was promoted.

## Wave 1

Wave 1 adds a cumulative `reasoning-v2` schema and reducer for learner claims:
stability, problem representation, working diagnosis, differential,
investigations, management, observation, reassessment, contingency,
disposition and consultation. Later partial turns preserve prior claims.
`REASONING_STATED` stores a normalized delta, while replay/export stores the
full cumulative reasoning state. Reasoning cannot change patient truth,
physiology, scores or clinical transitions.

The explicit `AI_INTERACTION_V2` flag defaults to `false`, is stored with the
session and is exported for deterministic replay. Wave 1 makes no provider call
and does not migrate the legacy router, planner or mentor runtime.

## Verification

- generated disease content rebuilt successfully;
- `npm run verify`: 241/241 tests passed;
- ESLint passed;
- production Vite build passed;
- `git diff --check` passed.

## Exact source files changed by this task

- `docs/GOVERNANCE_AND_WAVE1_COMPLETION_2026-08-28.md`
- `docs/KNOWN_GAPS.md`
- `docs/NORMAL_OPERATION_AUDIT_2026-08-28.md`
- `docs/V35_SOURCE_SYMBOL_AUDIT_2026-08-28.md`
- `scripts/smokeApp004.mjs`
- `src/ai/interaction/featureFlags.js`
- `src/app/session/useSession.js`
- `src/content/diseases/appendicitis/phenotypes.yaml`
- `src/core/commands/executeCommand.js`
- `src/core/hospital/dynamicConstraints.test.js`
- `src/core/patient/appendicitisVariantMigration.test.js`
- `src/core/reasoning/reasoningState.js`
- `src/core/reasoning/reasoningState.test.js`
- `src/core/replay/buildDebrief.js`
- `src/core/replay/exportSession.js`
- `src/core/replay/replayIntegrity.test.js`
- `src/core/session/app004Remediation.test.js`
- `src/core/session/createSession.js`
- `src/core/session/learnerJourney.e2e.test.js`
- `src/core/session/reportedSessionRegression.test.js`
- `src/core/session/session.e2e.test.js`
- `src/core/session/sessionPurpose.js`
- `src/core/session/sessionPurpose.test.js`
- `src/core/state/painProvenance.test.js`
- `src/core/state/worldState.js`
- `src/core/state/worldState.test.js`
- `src/tests/productBehaviorContract.test.js`

The content rebuild rewrote the ignored generated artifacts
`src/content/generated/appendicitis.json`, `contentIndex.json` and `shared.json`.
They are packaging inputs, not tracked source files.
