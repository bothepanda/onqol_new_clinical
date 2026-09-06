# APP-004 antibiotic prophylaxis review table

**Date:** 2026-08-25
**Requested by:** `APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25` AB01–AB09; remediation task §16
**Status:** PROPOSAL — no regimen, dose or timing rule below is active.
**Reviewers required:** clinical + pharmacy + independent second review (high-risk medication domain)

---

## 1. The audit the matrix asked for (AB05, task §16.3)

The existing rule was:

```
RULE-CEFAZOLIN-PROPHYLAXIS-DOSE   review_status: reviewed_internal
reviewers: ["Сарина Т.Т.", "Каукенова Б.Н."]   reviewed_at: 2026-08-20
teaching_point_ru: "Стандартная периоперационная профилактика цефазолином — 2 г в/в
                    (3 г при массе тела 120 кг и более), в пределах 60 минут до разреза."
```

**Finding:** the claim as worded endorses **cefazolin monotherapy** as *the* standard periopertive prophylaxis for this operation. ASHP/SIS/SHEA/IDSA surgical prophylaxis guidance (SRC-ASHP-PROPH) lists appendectomy prophylaxis as **cefazolin + metronidazole**, or a single agent with anaerobic activity such as **cefoxitin/cefotetan**. Cefazolin alone does not cover the anaerobic flora the operation exposes.

**Action taken in this pass:**

- the rule was **downgraded** from `reviewed_internal` to `pending`, and the prior internal review is preserved in the content as `provenance.superseded_review` with the reason for withdrawal — a review that approved a claim the source does not support is a record, not a warrant;
- the teaching text was rewritten so it no longer asserts monotherapy sufficiency: it now asks the learner to check the dose **and** what covers the anaerobes;
- `second_review_required: true`.

This is the one place in this pass where a previously *approved-by-someone* claim was actively withdrawn. It is called out here because the reviewer's own names are on it.

---

## 2. Regimen table (matrix AB04: multiple accepted regimens, not one answer)

| regimen | drug(s) | dose | route | timing window | redosing rule | beta-lactam allergy alternative | KZ availability / formulary | source | review status | reviewer |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | cefazolin **+** metronidazole | `NEEDS_PHARMACY_REVIEW` | IV | `NEEDS_CLINICAL_REVIEW` (WSES 2020: 0–60 min before incision) | `NEEDS_PHARMACY_REVIEW` | see R4 | `NEEDS_PHARMACY_REVIEW` | SRC-ASHP-PROPH | `pending` | — |
| R2 | cefoxitin (single agent, anaerobic cover) | `NEEDS_PHARMACY_REVIEW` | IV | as above | `NEEDS_PHARMACY_REVIEW` | see R4 | **availability in KZ unconfirmed** | SRC-ASHP-PROPH | `pending` | — |
| R3 | cefotetan (single agent) | `NEEDS_PHARMACY_REVIEW` | IV | as above | `NEEDS_PHARMACY_REVIEW` | see R4 | **not currently recognized by the formulary** | SRC-ASHP-PROPH | `pending` | — |
| R4 | beta-lactam allergy alternative | `NEEDS_PHARMACY_REVIEW` | `NEEDS_PHARMACY_REVIEW` | as above | `NEEDS_PHARMACY_REVIEW` | n/a | `NEEDS_PHARMACY_REVIEW` | SRC-ASHP-PROPH | `pending` | — |
| R5 | cefazolin **alone** | 2–3 g (ASHP weight-based surgical dose) | IV | as above | `NEEDS_PHARMACY_REVIEW` | see R4 | recognized | SRC-ASHP-PROPH does **not** support it for appendectomy | **NOT ACCEPTED without a named local protocol** | — |

**Question the reviewer must answer before anything here is promoted:** which of R1–R4 should exist in the KZ Reference Hospital, and does the KZ national protocol or the KNF sanction a regimen that differs from ASHP? The content already carries the known discrepancy as a note: *"КНФ РК приводит отличную схему (1 г, редозинг 0.5-1 г q6-8h)"*, which is to be discussed in debrief and never used as an automatic correction of the resident.

---

## 3. Behaviour implemented in this pass

| matrix | requirement | implemented |
|---|---|---|
| AB01 | preoperative prophylaxis is a required preparation step | yes — `antibiotic_prophylaxis`, `blocking: true`, `authority_layer: clinical_rule`, `second_review_required: true` |
| AB03 | "антибиотикопрофилактика" alone is an intent, not an order | yes — drug, dose **and** route are all required; the incomplete command returns CLARIFY and the **nurse** asks. The system never fills any of the three in. |
| AB04 | no single uniquely correct regimen | yes — no rule matches on "the correct regimen"; the only dose rule is the (downgraded) cefazolin one |
| AB05 | audit the cefazolin rule | done — see §1 |
| AB07 | an antibiotic given hours earlier is not automatically valid prophylaxis | **partially** — the administration time is recorded on the preop item as `administeredAtMinutes`, and the item explicitly carries `timingValidated: false` with `timingValidationBlockedBy: "no approved drug-specific pre-incision timing/redosing content"`. Nothing marks the timing valid, and nothing invents a redosing rule. |
| AB09 | no invented SSI-risk delta | yes — prophylaxis is recorded structurally only; `superficial_ssi` is gone from the first slice entirely |
| AB02 | timing intent understood, verified from drug-specific rule | intent understood; verification is blocked pending §2 |
| AB06 | beta-lactam allergy modifier | **not implemented** — the patient model carries no allergy field, and generating one without a reviewed alternative regimen would be a pathway to nowhere |
| PR07 | missing prophylaxis noticed in the OR by anaesthesia | **not implemented** — see §4 |

---

## 4. Known gap: prophylaxis missed at the operating-room door (PR07)

The matrix approves the behaviour — the anaesthesiologist states it was missed, ensures administration before incision if still appropriate, and gives brief corrective feedback — with gate **SECOND REVIEW**.

It is **not implemented in this pass**, because in the current build `antibiotic_prophylaxis` is a **blocking** preoperative item: the operation cannot start without it, so the situation the behaviour describes cannot arise. Making it non-blocking so the scene can occur would be a clinical decision about whether an appendectomy may proceed with prophylaxis outstanding, and that is the reviewer's to make, not this pass's.

**Question:** should `antibiotic_prophylaxis` remain a hard blocker, or become non-blocking so the OR-door catch can be modelled?

---

## 5. Postoperative antibiotics (matrix AB08, PO04)

| item | decision | implemented |
|---|---|---|
| routine postoperative antibiotics after uncomplicated appendectomy | **REMOVE** | the system never administers any medication on its own — pinned by test 24 |
| a prolonged course the learner orders | allowed if otherwise safe; challenged once the rule is approved | `RULE-NO-ROUTINE-POSTOP-ANTIBIOTICS-UNCOMPLICATED` authored (LEVEL_2, class-matched on the `antibiotic` tag), `pending` — so it is currently inert |

Its teaching text needs sign-off before promotion:

> "После аппендэктомии по поводу неосложнённого аппендицита продолжение антибиотиков не рекомендовано. Какое показание к продолжению курса ты видишь у этого пациента?"

---

## Concrete questions for the clinical / pharmacy reviewer

1. Which antibiotic prophylaxis regimens should exist in the KZ Reference Hospital for appendectomy — R1, R2, R4, or another?
2. Exact drug, dose and route for each accepted regimen.
3. Is cefoxitin actually available in the KZ setting these residents will practise in?
4. What pre-incision timing window and redosing rule should apply, per agent?
5. Should `antibiotic_prophylaxis` stay a hard preoperative blocker (see §4)?
6. Does the KZ national protocol / KNF regimen differ from ASHP, and if so, which is taught as the reference and which is discussed as a local variant?
