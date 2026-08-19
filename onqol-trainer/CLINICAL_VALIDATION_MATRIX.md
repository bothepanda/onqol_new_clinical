# ON QOL clinical validation matrix

Statuses are deliberately multi-dimensional: `implemented` is not clinical
approval, and source review is not Kazakhstan-local or language review.

| Package | Source review | Clinical review | Kazakhstan local review | RU language review | KK language review | Runtime state | Scoring state |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Stable appendicitis APP-001–004 | partial; versioned citations resolve | pending independent sign-off; P0 overstatements corrected 19.08.2026 | pending | pending independent review | pending; 65 keys missing | active, deterministic to discharge | formative-only |
| Adult risk scores (AIR, AAS) | WSES 2025 names the tools; no cutoff tables in any source | pending | pending | pending | pending | named qualitatively; PAS excluded as paediatric | no numeric score computed or scored |
| Nonoperative management (WSES R5.1) | source and selection conditions recorded | pending | pending | pending | pending | orderable, discussed with its conditions | never penalised, never a safety stop |
| Digital rectal examination | Takada 2015 verified for one negative claim | no authored finding in any phenotype | n/a | n/a | n/a | recognised; answers "not modelled" | ineligible; never expected or critical |
| CRP numeric value | generated distribution explicitly unvalidated | pending reviewed time-response curve | pending | n/a | n/a | generated internally, learner-inactive | ineligible; gates no transition |
| Reproductive safety branch | ACEP measure and ACR criteria recorded | pending obstetric/gynaecologic reviewer | pending | pending | pending | pregnancy status expected; pelvic workup conditional | pregnancy status only; pelvic workup ineligible |
| APP-005 unstable appendicitis | source stubs only | pending surgery + EM/ICU | pending | pending | pending | faculty preview; learner-inactive | ineligible |
| Postoperative complication/rescue | source stubs only | pending | pending | pending | pending | declared states; learner-inactive | ineligible |
| Alternative hidden truths (8) | package-specific sources missing | pending by specialty | pending where applicable | pending | pending | inactive stubs | ineligible |
| KZ resource profiles | operational assumptions documented | pending clinical effect review | pending facility-level review | terminology pending | terminology pending | active only as provisional versioned input | cannot create score |
| WHO Sign In / Time Out / Sign Out | WHO checklist mapped | pending local workflow confirmation | pending | RU copy pending review | KK copy pending | active on stable path | formative safety feedback only |
| Semantic router RU | concept dictionary and tests complete | narrow-intent behavior implemented | terminology pending | pending independent review | n/a | active | cannot create actions from reasoning alone |
| Semantic router KK | concept dictionary and tests complete | behavior parity tests present | terminology pending | n/a | pending full learner-copy review | router vocabulary active; learner locale disabled | ineligible while locale disabled |
| Mentor revealed-facts policy | evidence/source allowlist implemented | teaching policy pending independent review | pending | pending | pending | active with deterministic fallback | cannot change score |
| Mentor V2 behavior contract | product contract versioned; no clinical claims imported | pedagogical review pending | pending | RU behavior tests active | KK copy remains gated | deterministic adequacy/policy/scaffolding active | cannot change score |
| Clinical source registry v1.0 | WSES2025 and KZ_AA_2018 metadata migrated without fabricated check dates | source verification pending | KZ source verification pending | n/a | n/a | provenance scaffold active | no authority by source metadata alone |
| Clinical rule registry v1.0 | first legacy mapping recorded | independent approval pending | pending | n/a | n/a | non-approved rules have zero runtime effects | release-blocking until approved |
| Numeric rubric | provisional source mapping only | not signed | not signed | n/a | n/a | disabled | numeric totals/domains `null` |
| Privacy/retention | technical policy documented | n/a | owner approval pending | participant copy pending | participant copy pending | raw persistence off; 7-day structured local retention | n/a |

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
