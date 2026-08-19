# ON QOL remediation status

Verified implementation snapshot: 2026-08-12. This file distinguishes code
completion from approvals that cannot be manufactured in the repository.

## Implemented and regression-tested

| Area | Status | Enforced boundary |
| --- | --- | --- |
| Recovery point | verified | Git tag `pre-remediation-2026-08-10` points to `d11744d` |
| V1 separation | verified | standalone `legacy-v1/`; no import, route or query switch from the main learner app |
| V1 credential/history cleanup | verified | same-origin gateway; no browser provider key; public history API and Blob dependency removed |
| Simulator information policy | verified | model receives only the handoff plus findings authorized for the current turn; hidden case, answer key, rubric and retrieval corpus are absent |
| Mentor information policy | verified | `revealed_only` fact allowlist with source ids; exact cited excerpts; uncited numbers and unrevealed findings fail validation |
| V3.5 scoring | verified disabled | every playable V3.5 case is `formative_only`; numeric totals/domains are `null`; raw scoring fails closed |
| Session lifecycle | verified | explicit `completed`, `abandoned`, `incomplete`, `expired` and `unsafe_terminated`; only discharge endpoint can complete V3.5 |
| Replay/audit | verified | versions, seeds, selection attempts, scenario, resource profile, actions, events and terminal status exported; learner text redacted |
| Resource engine | verified | delayed resources use absolute `readyAt`; delayed, unavailable and transfer-only are distinct; canonical versioned KZ profiles drive runtime |
| Patient path | verified for learner scope | stable V3.5 path states drive runtime through discharge/complete; faculty-preview complication states remain unreachable |
| Reasoning snapshots | verified | state-specific learner-claim snapshots are emitted once, source-separated from patient truth and identifier-redacted |
| WHO checkpoints | verified | Sign In, Time Out and Sign Out are separate leaf actions and gates; Sign Out blocks theatre handover until recorded |
| Main model gateway | verified locally | server-side credential, exact origin, pilot token, strict task schemas, size/time limits, per-client and per-session quotas, safe errors, `store:false` |
| Evaluation grouping | verified | every turn is logged as `model_backed` or `local_fallback` with component execution source, provider/model/schema versions |
| Browser privacy | verified | raw persistence off by default; seven-day structured snapshot retention; deletion removes all local session artifacts |
| Release gate | verified closed | Vercel build runs `npm run release:check`; deployment cannot proceed without the owner-controlled confirmations below |

## P0 clinical remediation, 19.08.2026

An independent clinical read found six places where learner-facing content
overstated its evidence. All are corrected in code, data and tests; none of them
approved a rule.

| # | Overstatement | Corrected behaviour |
| --- | --- | --- |
| P0.1 | PAS offered to adults alongside AIR and AAS | adult slice names AIR or AAS only; PAS kept as paediatric metadata; no numeric cutoff anywhere |
| P0.2 | nonoperative management sat in `unsafe_actions` with a penalty | conditional option carrying its selection conditions; never penalised, never a safety stop; unqualified recurrence range withdrawn |
| P0.3 | a morning operation inside the 24-hour window read as an error | acceptable for a stable uncomplicated adult; the window is a ceiling, and deterioration still escalates |
| P0.4 | prophylaxis taught "broad-spectrum" as a local choice | one dose per the local approved protocol; no molecule, dose or interval |
| P0.5 | two conditional recommendations encoded as bans | postoperative antibiotics: no penalty, no ban, debrief only; normal appendix: "may be considered", inactive |
| P0.6 | the pregnancy modifier made a whole pelvic workup expected | pregnancy status expected; pelvic ultrasound, pelvic examination and gynaecology consultation orderable and conditional |
| P0.7 | every APP-003 patient received the same positive rectal finding | no phenotype carries an authored DRE result; recognised, answered as not modelled; source re-attributed to Takada 2015 |
| P0.8 | an unvalidated CRP curve was printed as a number | generated internally for physiology coherence, never shown; gates no transition, diagnosis, endpoint or score |
| P0.9 | ICD note claimed K35.0/K35.1/K35.9 as the Kazakhstan codes | claim withdrawn; category K35 only pending formal local coding review |

18 regression tests hold these, including repository-wide text guards so a
corrected sentence cannot drift back through documentation alone.

Status after this work: **P0 clinical remediation implemented and technically
verified; independent clinical, Kazakhstan-local, language and assessment
validation remain open.** The product is a candidate for a small
formative/usability pilot and is not clinically validated, not efficacy
validated, not production-ready and not suitable for summative assessment.

## External/owner gates still open

1. Rotate the provider credential that previously appeared in a shared archive
   and record `ONQOL_PROVIDER_KEY_ROTATED=confirmed`.
2. Configure the protected production origin, internal pilot token, hosting
   authentication and durable hosting-level rate/spend controls.
3. Record independent clinical sign-off and approve the provisional resource
   profile, including blood products and transfer destination.
4. Approve participant information, consent, retention and deletion policy.
5. Complete independent Russian copy review. Kazakh learner mode remains
   disabled: 65 V3.5 learner-facing keys still require authored review.
6. Run protected desktop/mobile live smoke tests for both the current product
   and the isolated V1 comparison stand.

## Audit traceability

| Item | Audit priority | Status | Evidence | Tests | Clinical gate | Remaining blocker |
| --- | --- | --- | --- | --- | --- | --- |
| Secret incident and release archive | P0 | `blocked_external` / technical controls verified | server-only gateways, `.env.example`, `pack:safe`, archive manifest | gateway, product-boundary and clean-package checks | none | owner must rotate the exposed provider key |
| V1/V2 exposure and public history | P0 | `verified` | isolated `legacy-v1/`; main app has no version switch; root history API removed | V1 4 tests + main boundary tests | V1 score stays internal/unvalidated | protected-host live smoke remains |
| Simulator hidden-information leak | P0 | `verified` | turn-scoped patient view; deterministic reveal validator | simulator architecture/repository suites | none | none for stable slice |
| V3.5 scoring contradiction | P0 | `verified` disabled | case and raw scorer fail closed to `formative_only` | scoring and manifest suites | scoring review and calibration | numeric assessment remains disabled |
| State graph and stable endpoint | P0 | `verified` for learner scope | 16-state manifest; stable runtime path reaches discharge/complete | runtime-path and end-to-end engine tests | unstable/complication packages | inactive paths need independent authoring |
| Temporal/resource model | P0 | `implemented_unreviewed` | absolute `readyAt`, resource queue, canonical KZ profile, current-state repeat results | resource/temporal/replay suites | intervention magnitudes and final KZ assumptions | CDR-01, CDR-04, CDR-08 |
| Patient/coherence corrections | P0/P1 | `implemented_unreviewed` | population gates, targeted findings, consistent generated envelopes | 1000-seed invariants and manifest suite | independent clinical/outlier review | CDR-02, CDR-03, CDR-05 |
| Mentor contract | P0/P1 | `verified` technically | revealed-only cited fact allowlist; one focused move/question; deterministic fallback | transcript-level mentor and engine suites | teaching-policy review | live provider dialogue review on protected host |
| Router narrow concepts and reasoning | P1 | `verified` technically | canonical RU/KK concept dictionary; reasoning separated from actions/scoring | router and reasoning suites | KZ terminology/language review | KK learner mode disabled |
| WHO safety states and management | P1 | `implemented_unreviewed` | separate Sign In, Time Out and Sign Out gates | core/engine/manifest suites | local workflow confirmation | validation-matrix sign-off |
| Privacy, replay and lifecycle | P0/P1 | `verified` technically | raw persistence off, 7-day structured retention, delete, redacted replay, explicit terminal states | repository, lifecycle and replay suites | participant/owner approval | CDR-12 |
| Responsive UI/accessibility | P2 | `verified` for main local build | 390x844 and 1366x720 live smoke; no horizontal overflow; explicit interruption dialog; >=12 px chrome labels | live browser smoke + lint/build | RU/KK copy review | protected deployment smoke and V1 live smoke |
| Dependencies, bundle and CI | P2 | `verified` locally | Blob chain removed; clinical and Markdown chunks split; CI workflow added | audit, clean build and safe-package extraction | none | CI must run on remote push |
| Alternative diagnoses and evaluative release | P1/P2 | `blocked_external` | stubs remain learner-inactive | learner randomizer exclusion tests | full disease packages and scoring panel | CDR-09 and CDR-10 |

## Current release decisions

| Target | Decision | Reason |
| --- | --- | --- |
| Local main internal demo | GO | coherent stable path, formative-only output, local fallback is labeled, no public history or browser key |
| Local V1 regression testing | GO with internal-only label | isolated app and automated gates pass; no clinical/evaluative use |
| Protected hosted V1 testing | NO-GO | key rotation, hosting protection and deployed desktop/mobile smoke are unconfirmed |
| External formative pilot | NO-GO | independent clinical, RU copy, privacy/consent and KZ resource review remain open |
| Public or evaluative release | NO-GO | numeric rubric, alternative truths, unstable/complication paths and bilingual review are not signed |

## Scope that remains intentionally inactive

- V3.5 numeric assessment remains disabled until independent review and pilot
  calibration; this is not a deploy flag.
- `APP-005`, the eight alternative-disease stubs and the complication pathway
  (`deterioration`, `complication_workup`, `source_control_2`) remain faculty
  preview/inactive until their clinical packages are authored and reviewed.
- Central multi-user storage and cross-device resume are not implemented; the
  current repository is a local structured-session pilot baseline.

Run `npm test`, `npm run lint`, `npm run build` and `npm run release:check`.
The first three must pass. The last command must return `NO-GO` until every
owner-controlled variable is present; that failure is the intended release
control, not a build defect.

Latest local verification: main 290/290 tests, isolated V1 4/4 tests, both
lint/build checks, and both production dependency audits passed. The safe
archive was then extracted into a clean temporary directory; `npm ci`, tests,
lint and build passed again for both applications. The companion manifest
records 181 entries, zero forbidden entries and the archive SHA-256.
