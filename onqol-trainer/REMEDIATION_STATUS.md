# ON QOL remediation status

Verified implementation snapshot: 2026-08-20. This file distinguishes code
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
| Replay/audit | verified | versions, seeds, provider latency/token telemetry, scenario, actions, terminal status and same-session clinical reports exported; transcript is identifier-scrubbed, not claimed anonymous |
| Resource engine | verified | delayed resources use absolute `readyAt`; delayed, unavailable and transfer-only are distinct; canonical versioned KZ profiles drive runtime |
| Patient path | verified for learner scope | stable V3.5 path states drive runtime through discharge/complete; faculty-preview complication states remain unreachable |
| Reasoning snapshots | verified | state-specific learner-claim snapshots are emitted once, source-separated from patient truth and identifier-redacted |
| WHO checkpoints | verified | Sign In, Time Out and Sign Out remain separate recordable actions; CDR-18 removes them as resident-path gates while consent and anaesthesia notification still block procedure start |
| Main model gateway | verified locally | server-side credential, exact origin, authenticated preflight, pilot token, strict task schemas, size/time limits, per-client and per-session quotas, safe errors, `store:false` |
| Evaluation grouping | verified | every turn is logged as `model_backed` or `local_fallback` with component execution source, provider/model/schema versions |
| Browser privacy | verified | raw persistence off; seven-day TTL covers structured sessions, reports and browser pseudonym; export boundary and provider retention are disclosed before mandatory consent |
| Release gate | verified closed | Vercel build runs a manifest-backed `release:check`; arbitrary env strings cannot replace reviewer/date/evidence records |
| Model grounding | verified technically | diagnosis actions and reasoning hypotheses that are not grounded in learner wording are dropped; postoperative broad observation is narrowed by path state |

## P0 clinical remediation, 19.08.2026

An independent clinical read found six places where learner-facing content
overstated its evidence. All are corrected in code, data and tests; none of them
is a pilot-wide APP-001–004 sign-off.

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
verified; pilot-wide clinical sign-off is approved for the exact scoped pilot,
while language and assessment validation remain open. REFERENCE-FULL is approved
only for the scoped pilot; Kazakhstan
real-facility review remains open but does not block reference mode.** The product is a candidate for a small
formative/usability pilot and is not clinically validated, not efficacy
validated, not production-ready and not suitable for summative assessment.

## External/owner gates still open

1. Rotate the provider credential that previously appeared in a shared archive,
   revoke the old key and record a manifest approval plus matching
   `ONQOL_PROVIDER_KEY_ROTATION_ID`.
2. Configure the protected HTTPS origin, strong internal pilot token, hosting
   authentication and durable hosting-level rate/spend controls; record the
   matching hosting manifest approval.
3. Bind the signed pilot-wide APP-001–004 approval in production with
   `ONQOL_CLINICAL_SIGNOFF_ID=ONQOL-CLINICAL-20260820`. The signed original is
   `PILOT_CLINICAL_SIGNOFF_APP001_004_SARINA_TT_2026-08-20.pdf`; its scope does
   not include KK, real mode, APP-005, complications, alternative hidden truths
   or numeric scoring. `REFERENCE-FULL` is already approved for this pilot,
   while blood products and transfer destination remain future real-mode work.
4. Approve participant information, consent, retention, controlled JSON transfer
   and deletion policy.
5. Review all 50 reachable entries / 49 unique blocks in
   `PILOT_RU_RUNTIME_COPY_REVIEW_2026-08-20.md` or the matching PDF and record
   the owner decision. Reproducible evidence is stored in
   `PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json`. Kazakh learner mode remains
   disabled: 65 V3.5 learner-facing keys still require authored review.
6. Run **8/8 technical router requests**, then the protected desktop/mobile live
   test on the exact participant URL. The real cohort is N=8 residents; technical
   smoke requests are not participant sessions. V1 remains internal.

## Audit traceability

| Item | Audit priority | Status | Evidence | Tests | Clinical gate | Remaining blocker |
| --- | --- | --- | --- | --- | --- | --- |
| Secret incident and release archive | P0 | `blocked_external` / technical controls verified | server-only gateways, `.env.example`, manifest-backed release gate | gateway, product-boundary and release-gate checks | none | owner must rotate/revoke and record evidence |
| V1/V2 exposure and public history | P0 | `verified` | isolated `legacy-v1/`; main app has no version switch; root history API removed | V1 4 tests + main boundary tests | V1 score stays internal/unvalidated | protected-host live smoke remains |
| Simulator hidden-information leak | P0 | `verified` | turn-scoped patient view; deterministic reveal validator | simulator architecture/repository suites | none | none for stable slice |
| V3.5 scoring contradiction | P0 | `verified` disabled | case and raw scorer fail closed to `formative_only` | scoring and manifest suites | scoring review and calibration | numeric assessment remains disabled |
| State graph and stable endpoint | P0 | `verified` for learner scope | 16-state manifest; stable runtime path reaches discharge/complete | runtime-path and end-to-end engine tests | unstable/complication packages | inactive paths need independent authoring |
| Temporal/resource model | P0 | `implemented_unreviewed` | absolute `readyAt`, resource queue, canonical KZ profile, current-state repeat results | resource/temporal/replay suites | intervention magnitudes and final KZ assumptions | CDR-01, CDR-04, CDR-08 |
| Patient/coherence corrections | P0/P1 | `implemented_unreviewed` | population gates, targeted findings, consistent generated envelopes | 1000-seed invariants and manifest suite | independent clinical/outlier review | CDR-02, CDR-03, CDR-05 |
| Mentor contract | P0/P1 | `verified` technically | revealed-only cited fact allowlist; one focused move/question; deterministic fallback | transcript-level mentor and engine suites | teaching-policy review | live provider dialogue review on protected host |
| Router narrow concepts and reasoning | P1 | `verified` technically | canonical RU/KK concept dictionary; reasoning separated from actions/scoring | router and reasoning suites | KZ terminology/language review | KK learner mode disabled |
| WHO safety states and management | P1 | `implemented_unreviewed` | separate Sign In, Time Out and Sign Out gates | core/engine/manifest suites | local workflow confirmation | validation-matrix sign-off |
| Privacy, replay and lifecycle | P0/P1 | `verified` technically | consent preflight, provider disclosure, 7-day sessions/reports/pseudonym, redacted replay, explicit terminal states | repository, report, gateway and replay suites | participant/owner approval | CDR-12 and controlled transfer evidence |
| Responsive UI/accessibility | P2 | `verified` for main local build | 390x844 and 1366x720 live smoke; no horizontal overflow; explicit interruption dialog; >=12 px chrome labels | live browser smoke + lint/build | RU/KK copy review | protected deployment smoke and V1 live smoke |
| Dependencies, bundle and CI | P2 | `verified` locally | CI workflow, Node floor, production audit and release-gated Vercel build | test, lint, build and audit | none | remote CI and deployed build still must run |
| Alternative diagnoses and evaluative release | P1/P2 | `blocked_external` | stubs remain learner-inactive | learner randomizer exclusion tests | full disease packages and scoring panel | CDR-09 and CDR-10 |

## Current release decisions

| Target | Decision | Reason |
| --- | --- | --- |
| Local main internal demo | GO with explicit dev setup | coherent stable path and formative-only output; local fallback requires an explicit development-only flag and is never pilot evidence |
| Local V1 regression testing | GO with internal-only label | isolated app and automated gates pass; no clinical/evaluative use |
| Protected hosted V1 testing | NO-GO | key rotation, hosting protection and deployed desktop/mobile smoke are unconfirmed |
| External formative pilot | NO-GO | clinical approval is recorded, but its production binding, RU copy, privacy/consent, remaining production configuration and other deployment bindings remain open; future KZ real-mode review is outside this pilot |
| Public or evaluative release | NO-GO | numeric rubric, alternative truths, unstable/complication paths and bilingual review are not signed |

## Scope that remains intentionally inactive

- V3.5 numeric assessment remains disabled until independent review and pilot
  calibration; this is not a deploy flag.
- `APP-005`, the eight alternative-disease stubs and the complication pathway
  (`deterioration`, `complication_workup`, `source_control_2`) remain faculty
  preview/inactive until their clinical packages are authored and reviewed.
- Central multi-user storage and cross-device resume are not implemented; the
  current repository is a local structured-session pilot baseline.

Run `npm test`, `npm run lint`, `npm run build`, `npm audit` and
`npm run release:check`. The first four must pass. The last command must remain
`NO-GO` until every manifest-backed external gate and production variable is
present; that failure is the intended release control, not a build defect.
