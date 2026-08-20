# Kazakhstan resource profiles — owner review gate

Status: `WORKFLOW_ASSUMPTIONS_PENDING_OWNER_REVIEW`  
Runtime version: `2026-08-10-review.1`  
Scoring eligibility: `false`

**Текущий ограниченный пилот:** этот pending review не является блокером для
RU/reference/APP-001–004/formative-only/N=8. Для него отдельно утверждён только
`REFERENCE-FULL`; evidence —
`REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md`. Таблица ниже нужна
исключительно для будущего real-mode продукта и не может влиять на текущий
пилот.

These rows make runtime internally consistent; they do not claim that every
Kazakhstan hospital of the named level has these capabilities. Confirm or
replace every cell before a site pilot. A site-specific profile must receive a
new id/version rather than silently changing an existing session definition.

| Capability | KZ-R1-DISTRICT | KZ-R2-URBAN | KZ-R3-TERTIARY | Owner decision |
| --- | --- | --- | --- | --- |
| CT | not installed | 24/7 | 24/7 | pending |
| Ultrasound | specialist from 09:00; `readyAt=380` from session start | 24/7 | 24/7 | pending |
| Laboratory | 24/7 | 24/7 | 24/7 | pending |
| Operating room | 24/7 | 24/7 | 24/7 | pending |
| Anaesthesia | 24/7 | 24/7 | 24/7 | pending |
| Laparoscopy | absent | one unit | two units | pending |
| ICU | present; prolonged ventilation not assumed | present | present | pending |
| Gynecology | on call | 24/7 | 24/7 | pending |
| Transport to next level | 150 min baseline | 45 min baseline | 20 min baseline | pending |
| Blood products | not authored | not authored | not authored | **blocking gap** |
| Transfer destination | not authored | not authored | not authored | **blocking gap** |

Required owner answers:

1. Confirm the R1 limited-resource row (CT absent, ultrasound from 09:00,
   laparoscopy absent, transfer about 150 minutes) or supply a site-specific row.
2. Confirm whether operating room and anaesthesia are truly 24/7 for each row.
3. Add blood-product availability and the named transfer destination.
4. Decide whether a reviewed no-surgery/transfer-first profile is required for
   the pilot; the engine supports `transfer_only`, but no clinical branch is
   activated until its endpoint is authored and reviewed.

Reference mode is a logged `REFERENCE-FULL` override and is not a Kazakhstan
facility claim. Real mode uses the case preset's one effective KZ profile; it no
longer selects an unrelated facility template from the seed. Release gate
запрещает включение real mode под reference-only approval.
