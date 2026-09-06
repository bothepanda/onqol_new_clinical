# APP-004 analgesia review table

**Date:** 2026-08-25
**Requested by:** `APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25` M01–M09, PO02, PO03; remediation task §12
**Status:** PROPOSAL — no dose, no response magnitude and no contraindication rule below is active.
**Reviewers required:** clinical + pharmacy (`NEEDS_PHARMACY_REVIEW`, `NEEDS_SECOND_REVIEW`)

---

## What was withdrawn

```
analgesia_iv_nsaid:
  applies_to: [ketorolac, ketoprofen]
  pain_score_delta: -3
  onset_minutes: 20
  duration_minutes: 240
```

Matrix M04: one universal magnitude applied to two different drugs by any route. Deleted. Replaced by one content object per **(drug, route)** pair, each with `response_envelope: null` — so the order still executes and is recorded, and nothing pretends to know what happens next.

Matching now requires drug **and** route (`core/commands/executeCommand.js#scheduleGovernedTreatmentEffect`), so an intramuscular order can never inherit an intravenous response envelope.

---

## 1. Reference formulary candidates (matrix M01)

The reviewer named these as acceptable in principle; every dose is a separate decision.

| drug | dose | route | onset | expected qualitative response | possible response envelope | contraindications / checks | KZ / reference formulary status | source | review status |
|---|---|---|---|---|---|---|---|---|---|
| paracetamol | `NEEDS_PHARMACY_REVIEW` | IV | `NEEDS_CLINICAL_REVIEW` | partial relief; base of a multimodal regimen | `NEEDS_CLINICAL_REVIEW` | hepatic impairment; cumulative daily dose | recognized, not approved | — | `pending` |
| paracetamol | `NEEDS_PHARMACY_REVIEW` | oral | `NEEDS_CLINICAL_REVIEW` | postoperative base analgesia (PO02) | `NEEDS_CLINICAL_REVIEW` | as above | recognized, not approved | — | `pending` |
| ibuprofen | `NEEDS_PHARMACY_REVIEW` | oral | `NEEDS_CLINICAL_REVIEW` | NSAID relief | `NEEDS_CLINICAL_REVIEW` | see §2 | recognized, not approved | — | `pending` |
| ketoprofen | `NEEDS_PHARMACY_REVIEW` | IV | `NEEDS_CLINICAL_REVIEW` | NSAID relief | `NEEDS_CLINICAL_REVIEW` | see §2 | recognized, not approved | — | `pending` |
| ketoprofen | `NEEDS_PHARMACY_REVIEW` | IM | `NEEDS_CLINICAL_REVIEW` | NSAID relief; onset differs from IV | `NEEDS_CLINICAL_REVIEW` | see §2 | recognized, not approved | — | `pending` |
| ketorolac | `NEEDS_PHARMACY_REVIEW` | IV | `NEEDS_CLINICAL_REVIEW` | NSAID relief | `NEEDS_CLINICAL_REVIEW` | see §2; duration-of-therapy limits | recognized, not approved | — | `pending` |
| ketorolac | `NEEDS_PHARMACY_REVIEW` | IM | `NEEDS_CLINICAL_REVIEW` | NSAID relief | `NEEDS_CLINICAL_REVIEW` | see §2 | recognized, not approved | — | `pending` |
| tramadol | `NEEDS_PHARMACY_REVIEW` | `NEEDS_PHARMACY_REVIEW` | `NEEDS_CLINICAL_REVIEW` | uncommon stronger option; rescue (PO03) | `NEEDS_CLINICAL_REVIEW` | interactions, seizure threshold, nausea | recognized, not approved | — | `pending` |
| metamizole | — | — | — | — | — | — | **NOT recognized** | — | excluded (M02) |
| metamizole + diphenhydramine | — | — | — | — | — | — | **NOT recognized** | — | excluded (M02) |

Matrix M02 is **NEEDS SOURCE**: reported local practice is not enough to make a combination reference teaching. Metamizole is deliberately absent from the formulary, so an order for it resolves as `unsupported_content` — an honest simulator limitation, never phrased to the learner as a stock-out. It is listed in `formulary.yaml#not_in_reference_set` with the reason, so the exclusion is a recorded decision rather than an omission.

---

## 2. NSAID suitability checks (matrix M03) — prepared, inactive

Authored in `formulary.yaml#nsaid_suitability_checks`. Inactive for two reasons: the rules are unapproved, and the patient model does not yet carry the fields they read. Matrix M03 is explicit that the LLM must not decide suitability.

| check | patient field it needs | currently modelled? | review status |
|---|---|---|---|
| known NSAID allergy | `allergies` | no (history says "аллергии не отмечает") | `pending` |
| renal dysfunction | `renal_function` | no (creatinine is qualitative only) | `pending` |
| GI ulcer / bleeding history | `gi_history` | no | `pending` |
| anticoagulation | `anticoagulants` | no | `pending` |
| pregnancy when relevant | `pregnancy_status` | **deliberately not modelled** — never invented | `pending` |

**Question for the reviewer:** should APP-004 ever generate a patient who has one of these, so the pathway is exercised? Matrix AB06 says yes for beta-lactam allergy ("generate rarely"); the equivalent decision for NSAIDs has not been made.

---

## 3. Response envelope (matrix M05)

The reviewer's decision was "variable improvement rather than a fixed delta". That is a shape, not a number.

| item | proposal | status |
|---|---|---|
| pain reduction | a bounded range, per drug and route | `NEEDS_CLINICAL_REVIEW` |
| onset | per drug and route | `NEEDS_PHARMACY_REVIEW` |
| duration | per drug and route | `NEEDS_PHARMACY_REVIEW` |
| effect on pain-driven HR/RR | conditional on a seeded pain-driven component | `NEEDS_CLINICAL_REVIEW` (see the vitals/labs table §3) |
| repeat dosing / rescue | not modelled | `NEEDS_PHARMACY_REVIEW` |

---

## 4. Fluids (matrix M06–M09)

| item | decision | implemented |
|---|---|---|
| IV fluids mandatory in stable APP-004 | **REMOVE** (M06) | nothing requires fluids; omitting them is not a miss |
| a modest reasonable infusion in a stable patient | **APPROVE** (M07) | accepted and recorded; never labelled "wrong because unnecessary" |
| `500 mL → HR −6 / SBP +4` | **REMOVE** (M08) | deleted; a fluid order does not move vitals |
| volume-deficit modifier | **APPROVE** concept (M09) | seam only: `requires_patient_state: volume_deficit`, and base APP-004 has no such state |

| item | status |
|---|---|
| what a volume-deficit state should consist of, and when APP-004 should generate one | `NEEDS_CLINICAL_REVIEW` |
| fluid response envelope conditional on that state | `NEEDS_CLINICAL_REVIEW` |

---

## 5. Postoperative analgesia (matrix PO02, PO03)

| item | decision | status |
|---|---|---|
| multimodal base (paracetamol ± NSAID) with a rescue option | **APPROVE** concept, SECOND REVIEW for doses | doses `NEEDS_PHARMACY_REVIEW` |
| "PRN analgesia" alone | nurse must clarify to a specific order | implemented: `ORDER_MEDICATION` requires drug, dose and route |
| tramadol as rescue | **NEEDS SOURCE** (PO03) | proposed, not authoritative |
| a single mandatory regimen | not required | no rule forces one |

---

## Concrete questions for the clinical / pharmacy reviewer

1. Which exact ketoprofen dose and route should be approved for an adult in the KZ Reference Hospital?
2. Same for ketorolac, paracetamol IV, and paracetamol oral postoperatively.
3. What bounded pain reduction should an effective IV NSAID produce in this patient — expressed as a range, not a point?
4. Should tramadol be in the reference set at all, or remain a KZ-practice note?
5. Should APP-004 ever generate a contraindication to NSAIDs, and if so which one and how often?
