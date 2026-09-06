# APP-004 Pilot Readiness Wave completion report — 2026-08-30

## A. Executive result

`GO_FOR_CLINICAL_APPROVAL`

The engineering vertical slice is ready to receive reviewed clinical content. It is **not** `GO_FOR_RESIDENT_PILOT`: active content has zero `approved_for_training` objects, patient truth remains development-only, and the release gate remains closed.

## B. What changed

### Authoritative-spec migration

- Installed the five supplied 2026-08-30 specifications byte-for-byte and indexed their SHA-256 hashes.
- Archived the old Product Behavior Contract; implementation comments and tests now cite the consolidated Core Runtime Spec rather than treating old contracts as parallel authority.

### Patient journey

- Added a generic route invariant: an operative-path patient cannot enter recovery/surgical ward or discharge before a successfully completed procedure.
- A successful source-control procedure now enters recovery explicitly; ward transfer remains a separate learner action.

### Patient dynamics framework

- Added a disease-neutral bounded state-transition evaluator for approved natural-course and postoperative-recovery content.
- Added governed, seeded treatment-response envelopes, deterioration events with rule/source traceability, and generic content-defined discharge conditions.
- Pending/null content remains inert and produces auditable simulator limitations; no APP-004 effect, probability, threshold or complication was invented.

### Reasoning and mentor

- Added deterministic RU capture for explicit stability, working diagnosis, uncertainty, differential/ranking, rationale, observation/reassessment, contingency, consultation and disposition claims.
- Learner claims remain separate from patient truth; reasoning plus action and contextual mentor answers preserve both channels. Wave 2.3 remains telemetry-only.

### Debrief/UI and persistence

- Rendered the deterministic end-of-case debrief with learner behavior, misses, consequences, resource limitations, simulator limitations, governance warning and export; no numeric competence score.
- Added versioned local resume by seed plus causal turn replay, with exact event-log verification and fail-closed handling of corrupt/incompatible storage.
- APP-004 is honestly RU-only; KZ/EN controls are disabled and labelled “скоро”.

### Tests and packaging

- Added cross-file content-reference validation, deterministic dynamics/reasoning/route/persistence tests and four Playwright learner-visible journeys.
- Safe packaging excludes dependencies, builds, secrets, VCS data, nested ZIPs and browser-test artifacts; the archive was installed and verified from a fresh temporary extraction.

## C. Authoritative-spec migration evidence

Active contracts:

1. `docs/contracts/ONQOL_SPECS_README.md` — SHA-256 `98f6c35df12e12057e096527a1c38111d76429b48fbfcbdb0b13bf0ffbee8afd`
2. `docs/contracts/ONQOL_NORTH_STAR_v1.1_2026-08-30.md` — `1ea26df619c2da1068f99c97f5d4ff500786b581cc9551cba28f9bbbfa6514af`
3. `docs/contracts/ONQOL_CORE_RUNTIME_SPEC_v2.0_2026-08-30.md` — `cb9d4d47e981d499cc8eadbc56b40097f3da94e68b7d0bd39b1c2dc990905615`
4. `docs/contracts/ONQOL_CLINICAL_GOVERNANCE_SPEC_v1.1_2026-08-30.md` — `6b14e83d1924aec10836baab881ded5ea0d987f8399f12a0b394f991e111bf85`
5. `docs/contracts/ONQOL_MENTOR_SPEC_v1.1_2026-08-30.md` — `1a6fc69dad44014d51349e4811a99a19887d71eed8c5f53ee2d3f8b4f61c819a`

Superseded archive: `docs/archive/contracts/ONQOL_PRODUCT_BEHAVIOR_CONTRACT_v1.0_2026-08-22.md`. The former Core Foundation Spec is not an active repository contract. `docs/contracts/CONTRACT_INDEX.md`, source comments and `src/tests/coreRuntimeContract.test.js` enforce the consolidated authority and exact Core Runtime hash.

## D. Route-integrity evidence

Before the fix, a refused operation left `operative.completed=false`, but a later `перевожу в хирургическое отделение` could set a postoperative location. After the fix, both missing-anaesthesia and missing-consent scenarios return `PREOP_NOT_READY`, the subsequent ward command returns `DISPOSITION_NOT_READY`, location remains `emergency_department`, and replay is byte-identical. A successful operation produces `SOURCE_CONTROL_COMPLETED` and `PATIENT_MOVED(recovery)`; only then does the ward transfer execute.

Evidence: `src/core/session/pilotRouteIntegrity.test.js` and Playwright Journey B.

## E. Clinical governance state

Recursive inventory of active generated disease/shared content objects carrying a review state:

| review status | count |
| --- | ---: |
| `reviewed_internal` | 6 |
| `pending` | 57 |
| `not_a_clinical_rule` | 3 |
| `approved_for_training` | 0 |
| **total** | **66** |

No item was promoted in this wave. Clinical source conflicts are recorded in `docs/review/APP004_SOURCE_CONFLICT_MAP_2026-08-30.md`; the review backlog is in `docs/review/APP004_CLINICAL_ACTIVATION_DELTA_2026-08-30.md`.

## F. Remaining clinical decisions

1. Approve a coherent baseline APP-004 phenotype/range/correlation set.
2. Supply and approve bounded uncomplicated natural-course states, windows, probabilities and deterioration markers.
3. Approve drug/route/dose validity and drug-specific analgesic response envelopes (including specialty/second review).
4. Approve the locally usable antibiotic-prophylaxis regimen, dose, route and timing.
5. Approve postoperative recovery milestones and timing ranges.
6. Approve functional discharge-ready conditions without unsupported arbitrary thresholds.
7. Reconcile KZ-versus-reference operation timing, analgesia and imaging workflow, and approve any remaining safety-critical parameter rule.

The evidence basis remains the current [WSES guideline (2026)](https://doi.org/10.1001/jamasurg.2025.6218), [IDSA intra-abdominal infection guideline update (2024)](https://www.idsociety.org/practice-guideline/intra-abdominal-infections/), [Kazakhstan anesthesia standard and amendments (2023–2025)](https://adilet.zan.kz/rus/docs/V2300032409), and [ASA fasting guideline (2023)](https://doi.org/10.1097/ALN.0000000000004381). These sources structure review; they do not automatically confer runtime authority.

## G. Wave 2.3 status

Frozen decisions are unchanged: Action `REJECT`; Reasoning `REJECT`; Contextual Mentor Answer `SHADOW_ONLY`. `npm run wave23:bakeoff` was **not run** because the frozen evidence records exhausted provider credit. Status: `BLOCKED_BY_PROVIDER_BUDGET`; the 80-turn holdout and safety suite remain unexposed, with no provider substitution or gold-label replay.

## H. Verification table

| command | result | exact result | evidence |
| --- | --- | --- | --- |
| `npm run content:check` | PASS | appendicitis + 7 shared categories validated | command output |
| `npm test` | PASS | 292/292, 0 failed | Node test summary |
| `npm run wave2:corpus` | PASS | 52 semantic fixtures | `docs/evidence/WAVE2_SHADOW_CORPUS_METRICS_2026-08-28.json` |
| `npm run lint` | PASS | ESLint exit 0 | command output |
| `npm run build` | PASS | Vite production build, 73 modules | `dist/` build output (excluded from ZIP) |
| `npm run wave23:freeze:check` | PASS | canonical freeze manifest verified | `docs/evidence/WAVE23_FREEZE_MANIFEST_2026-08-29.json` |
| `npm run pack:safe` | PASS | 0 forbidden paths | pack output |
| `npm run test:e2e` | PASS | 4/4 Playwright journeys | browser test output |
| clean `npm ci` + `npm run verify` | PASS | fresh extraction; 292/292 plus corpus/lint/build | `/private/tmp/onqol-safe-release.6YVQ6Y` |
| clean `npm run test:e2e` | PASS | 4/4 from fresh extraction | `/private/tmp/onqol-safe-release.6YVQ6Y` |
| `npm run wave23:bakeoff` | BLOCKED | `BLOCKED_BY_PROVIDER_BUDGET`; intentionally not run | frozen holdout/safety blocked artifacts |

## I. Known remaining gaps

### Clinical-content blockers

- Zero active objects are approved for training; baseline patient truth, dynamics, treatment effects, recovery and functional discharge remain review-gated.
- Clinical conflicts require named decisions, dates and any required second reviewer before promotion.

### Interpreter/model-quality blockers

- Deterministic RU coverage is materially better but intentionally bounded to content allowlists.
- Wave 2.3 action/reasoning paths are rejected; contextual mentor answer remains shadow-only; untouched holdout stability and safety are unmeasured.

### Product polish not required for this gate

- No cloud sync/accounts; persistence is local-device only.
- Debrief wording can receive further visual/copy polish after clinical approval.

### Intentionally deferred

- Full KZ/EN clinical simulation, second disease, APP-005/sepsis, new complications, authoritative model interpretation and numeric competence scoring.

## J. Clean handoff artifact

Path: `dist-pack/onqol-vnext-source.zip` (absolute: `/Users/botagozkaukenova/Documents/ChatGPT/on-qol/onqol-vnext/dist-pack/onqol-vnext-source.zip`). Exact `pack:safe` size output: `2.54 MB`. The archive contains zero forbidden paths and was verified through a clean extraction, fresh `npm ci`, full `npm run verify`, freeze check and 4/4 Playwright suite.
