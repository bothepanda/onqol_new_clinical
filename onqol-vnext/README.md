# ON QOL vNext

Clean-core rebuild of the ON QOL Clinical Trainer, per `CLAUDE_CODE_TASK_ONQOL_VNEXT_REBUILD_v1_2026-08-22.md`. This is a sibling of `../onqol-trainer/` (the legacy app, left untouched and read-only) — see `docs/MIGRATION_AUDIT.md` for what was and wasn't carried over.

## Run it

```bash
npm install
npm run dev
```

### Flexible patient V2 (2026-09-25)

`npm run dev:flexible` adds **Гибкий клинический диалог** to the start screen.
It reuses the existing interpreter, governed Patient Engine, scheduler and replay.
The provider only renders disclosed patient/staff speech through protected clinical
clauses; neither generator nor verifier can create facts or alter time/state.
Missing reviewed treatment responses remain simulator limitations. This is an
internal Russian APP-004/Reference Hospital prototype, not clinical validation.
V1 saved data is retained but cannot be resumed as V2 truth.

See [implementation report](docs/review/FLEXIBLE_PATIENT_V2_GOVERNED_VARIABILITY_2026-09-25.md),
[calibration extension](docs/REVIEWED_SIMULATION_CALIBRATION_V2.md) and
[proposed validation plan](docs/review/CLINICAL_RELIABILITY_VALIDATION_PLAN_v0.1_2026-09-25.md).
Run `npm run test:e2e:flexible` for desktop/mobile fixtures; tests make no paid calls.
The ordinary learner download contains only shown dialogue. Reviewers may save the
local persistence object and run `node scripts/reviewFlexiblePatient.mjs input.json review.json`
for raw attempts, verifier decisions and causal-event references (reviewer-only).

## Verify it

```bash
npm run verify   # content:check + test + lint + build, in that order
```

Individually: `npm run content:build` (compiles `src/content/**/*.yaml` into `src/content/generated/`, required before `test`/`build`/`dev` — already wired into those scripts), `npm test`, `npm run lint`, `npm run build`.

## Start here

- `docs/ARCHITECTURE.md` — the layers, the reducer, the mentor boundary, why a scheduling bug in an early draft broke replay and how it was fixed.
- `docs/CONTENT_AUTHORING.md` — how to add a phenotype, a rule, or a second disease.
- `docs/MIGRATION_AUDIT.md` — what was inspected in the legacy `onqol-trainer/`, what was reused, what wasn't.
- `docs/REPLAY_SCHEMA.md` — the JSON export shape.
- `docs/KNOWN_GAPS.md` — read this before assuming something works. It's specific, not a generic disclaimer.

## Layout

```text
docs/                 the five documents above
migration/legacy-content/   legacy clinical content copied for traceable migration, not imported
server/aiGateway.mjs   provider-neutral AI gateway (server-side key, no key in this env)
src/core/              domain engine: events, state, time, patient, hospital, rules, commands, replay
src/ai/                interpreter / mentor / renderer, each with a deterministic fallback
src/content/           authored clinical content (YAML); generated/ is compiled output, gitignored, rebuilt by `npm run content:build`
src/ui/, src/app/      React shell
```
