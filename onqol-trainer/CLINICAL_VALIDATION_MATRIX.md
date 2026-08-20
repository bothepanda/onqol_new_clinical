# ON QOL clinical validation matrix

Statuses are deliberately multi-dimensional: `implemented` is not clinical
approval, and source review is not Kazakhstan-local or language review.

Pilot scope: **N=8 residents**, RU, `REFERENCE-FULL`, APP-001–004,
`formative_only`.

| Package | Source review | Clinical review | Kazakhstan local review | RU language review | KK language review | Runtime state | Scoring state |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Stable appendicitis APP-001–004 | versioned source registry; normative currency separately marked where unconfirmed | pilot-wide handwritten approval from Сарина Т.Т. dated 20.08.2026 is recorded in `PILOT_CLINICAL_SIGNOFF_APP001_004_SARINA_TT_2026-08-20.pdf`; manifest approval id `ONQOL-CLINICAL-20260820`; exact scope excludes KK, real mode, APP-005, complications, alternative hidden truths and numeric scoring | owner local-applicability review exists for subsets; real-facility claims excluded | 50 reachable entries / 49 unique displayed blocks prepared in MD/PDF with reproducible JSON snapshots; owner approval pending | pending; 65 keys missing | active, deterministic to discharge | formative-only |
| Adult risk scores (AIR, AAS) | WSES 2025 names the tools; no cutoff tables in any source | pending | pending | pending | pending | named qualitatively; PAS excluded as paediatric | no numeric score computed or scored |
| Nonoperative management (WSES R5.1) | source and selection conditions recorded | pending | pending | pending | pending | orderable, discussed with its conditions | never penalised, never a safety stop |
| Digital rectal examination | Takada 2015 verified for one negative claim | no authored finding in any phenotype | n/a | n/a | n/a | recognised; answers "not modelled" | ineligible; never expected or critical |
| CRP numeric value | generated distribution explicitly unvalidated | pending reviewed time-response curve | pending | n/a | n/a | generated internally, learner-inactive | ineligible; gates no transition |
| Reproductive safety branch | ACEP measure and ACR criteria recorded | pending obstetric/gynaecologic reviewer | pending | pending | pending | pregnancy status expected; pelvic workup conditional | pregnancy status only; pelvic workup ineligible |
| APP-005 unstable appendicitis | source stubs only | pending surgery + EM/ICU | pending | pending | pending | faculty preview; learner-inactive | ineligible |
| Postoperative complication/rescue | source stubs only | pending | pending | pending | pending | declared states; learner-inactive | ineligible |
| Alternative hidden truths (8) | package-specific sources missing | pending by specialty | pending where applicable | pending | pending | inactive stubs | ineligible |
| Reference resource profile | `REFERENCE-FULL` decision recorded in `REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md` | approved by clinical owner only for the scoped formative pilot | not a Kazakhstan facility claim; KZ-R1/R2/R3 remain pending and non-blocking | terminology included in full RU runtime package | KK outside pilot | reference-only active; real-facility mode forbidden by gate | cannot create score |
| KZ resource profiles | operational assumptions documented | pending clinical effect review | pending facility-level review, including blood products and transfer destination | terminology pending | terminology pending | learner-inactive; future real-mode work only | cannot create score |
| WHO Sign In / Time Out / Sign Out | WHO checklist mapped | CDR-18 owner decision recorded; local workflow confirmation remains open | pending | RU copy manifest review pending | KK copy pending | recordable; no longer blocks resident path | formative safety feedback only |
| Semantic router RU | concept dictionary and tests complete | narrow-intent behavior and diagnosis-grounding guard implemented | terminology pending | pilot-wide independent review pending | n/a | active; ungrounded diagnosis/reasoning is dropped | cannot create actions from reasoning alone |
| Semantic router KK | concept dictionary and tests complete | behavior parity tests present | terminology pending | n/a | pending full learner-copy review | router vocabulary active; learner locale disabled | ineligible while locale disabled |
| Mentor revealed-facts policy | evidence/source allowlist implemented | teaching policy pending independent review | pending | pending | pending | active with deterministic fallback | cannot change score |
| Mentor V2 behavior contract | product contract versioned; no clinical claims imported | pedagogical review pending | pending | RU behavior tests active | KK copy remains gated | deterministic adequacy/policy/scaffolding active | cannot change score |
| Clinical source registry v1.0 | WSES2025 and KZ_AA_2018 metadata migrated without fabricated check dates | source verification pending | KZ source verification pending | n/a | n/a | provenance scaffold active | no authority by source metadata alone |
| Clinical rule registry v1.0 | reviewed source mapping recorded | stable teaching rules carry two recorded reviewers; registry validates cleanly | owner applicability review recorded | n/a | n/a | approved teaching-only rules active; non-approved rules fail closed | formative-only; no numeric effects |
| Dosing rule registry v0.1 | three exact-source rows recorded; source-currency caveats explicit | three teaching-only rows carry two recorded reviewers dated 20.08.2026 | KNF divergence recorded and local dose cannot be marked wrong | live wording regression-tested; pilot-wide RU review pending | pending | mentor may teach only approved numbers; no patient effect | zero weight; never scored |
| Numeric rubric | provisional source mapping only | not signed | not signed | n/a | n/a | disabled | numeric totals/domains `null` |
| Privacy/retention | provider and local data-flow documented | n/a | owner approval pending | RU participant copy implemented; owner approval pending | KK outside pilot | consent gate; raw persistence off; 7-day local TTL; provider boundary disclosed | n/a |

## Minimum signatures before changing a row to clinically reviewed

- Stable clinical path: independent surgeon and Kazakhstan-local reviewer.
- Unstable path: surgeon plus emergency medicine or intensive-care reviewer.
- Imaging findings: radiology reviewer.
- Scoring: clinical panel plus assessment methodologist and pilot calibration.
- Kazakh learner mode: Kazakhstan clinical reviewer and medical-language reviewer.
- Imaging findings and image-guided drainage: radiologist.
- Antibiotic implementation, agents and doses: pharmacist, infectious-disease clinician or antimicrobial-stewardship reviewer.
- Reproductive branches: obstetrician-gynaecologist.
- Any future numeric score: assessment methodologist.
- Facility capability and routing claims: Kazakhstan-local reviewer.

Two signatures are a project minimum, not proof of validity. A high-risk rule
that touches one of the areas above needs that area's reviewer as well.
