# ON QOL clinical validation matrix

Statuses are deliberately multi-dimensional: `implemented` is not clinical
approval, and source review is not Kazakhstan-local or language review.

| Package | Source review | Clinical review | Kazakhstan local review | RU language review | KK language review | Runtime state | Scoring state |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Stable appendicitis APP-001–004 | partial; versioned citations resolve | pending independent sign-off | pending | pending independent review | pending; 65 keys missing | active, deterministic to discharge | formative-only |
| APP-005 unstable appendicitis | source stubs only | pending surgery + EM/ICU | pending | pending | pending | faculty preview; learner-inactive | ineligible |
| Postoperative complication/rescue | source stubs only | pending | pending | pending | pending | declared states; learner-inactive | ineligible |
| Alternative hidden truths (8) | package-specific sources missing | pending by specialty | pending where applicable | pending | pending | inactive stubs | ineligible |
| KZ resource profiles | operational assumptions documented | pending clinical effect review | pending facility-level review | terminology pending | terminology pending | active only as provisional versioned input | cannot create score |
| WHO Sign In / Time Out / Sign Out | WHO checklist mapped | pending local workflow confirmation | pending | RU copy pending review | KK copy pending | active on stable path | formative safety feedback only |
| Semantic router RU | concept dictionary and tests complete | narrow-intent behavior implemented | terminology pending | pending independent review | n/a | active | cannot create actions from reasoning alone |
| Semantic router KK | concept dictionary and tests complete | behavior parity tests present | terminology pending | n/a | pending full learner-copy review | router vocabulary active; learner locale disabled | ineligible while locale disabled |
| Mentor revealed-facts policy | evidence/source allowlist implemented | teaching policy pending independent review | pending | pending | pending | active with deterministic fallback | cannot change score |
| Numeric rubric | provisional source mapping only | not signed | not signed | n/a | n/a | disabled | numeric totals/domains `null` |
| Privacy/retention | technical policy documented | n/a | owner approval pending | participant copy pending | participant copy pending | raw persistence off; 7-day structured local retention | n/a |

## Minimum signatures before changing a row to clinically reviewed

- Stable clinical path: independent surgeon and Kazakhstan-local reviewer.
- Unstable path: surgeon plus emergency medicine or intensive-care reviewer.
- Imaging findings: radiology reviewer.
- Scoring: clinical panel plus assessment methodologist and pilot calibration.
- Kazakh learner mode: Kazakhstan clinical reviewer and medical-language reviewer.

