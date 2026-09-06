# APP-004 anaesthesia and fasting (NPO) review table

**Date:** 2026-08-25
**Requested by:** `APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25` PR01–PR07, MR05; remediation task §13.2
**Status:** PROPOSAL — `NEEDS_ANESTHESIA_REVIEW` throughout.
**Reviewer required:** anaesthesiology (independent; this is a high-risk cross-specialty domain)

---

## 1. What changed, and what did not

| matrix | decision | implemented in this pass |
|---|---|---|
| PR01 | NPO is **not** a universal hard stop | **yes.** The blocking `npo_status` preop item is gone. `fasting_assessment` replaces it, `blocking: false`. The operation proceeds without it. |
| PR02 | seed last solid-food and clear-liquid timestamps; the anaesthesiologist obtains them if the learner did not ask | **yes.** `findings.yaml#fasting_history` seeds both; `ASK_FASTING_HISTORY` lets the learner ask; a `fasting_discovery` pending item fires on anaesthesia arrival otherwise. |
| PR03 | water <2 h before emergency surgery: flag aspiration risk and manage it; do **not** wait exactly to the 2-hour mark | **NO — deliberately not implemented.** See §3. |
| PR04 | consent: explain operation, risks/alternatives, obtain it; do not quiz every form item | **yes.** One `OBTAIN_CONSENT` action; no consent-form quiz. |
| PR05 | consent is a readiness gate, not a Level-4 physiologic catastrophe | **yes.** `RULE-CONSENT-BEFORE-PROCEDURE` downgraded LEVEL_4 → LEVEL_2, `authority_layer: clinical_workflow`. The operation is still blocked without consent, structurally. |
| PR06 | the consultant's arrival consumes clinical time | **yes** (already true). `anesthesia_review` completes only on the arrival event. |
| PR07 | prophylaxis missed at the OR door | **no** — see the antibiotic table §4; the situation cannot arise while prophylaxis is a hard blocker. |
| MR05 | debrief attributes the missed fasting assessment to the learner if they failed to ask | **yes.** `FASTING_HISTORY_OBTAINED` records `obtainedBy: "learner" \| "anesthesiologist"`. |

---

## 2. Seeded fasting history (patient truth)

| field | current range | what kind of claim this is | review status |
|---|---|---|---|
| last solid food | 4–10 h ago | seeding of a HISTORY fact, not a physiological claim | `pending` |
| last clear liquid | 1–4 h ago | as above | `pending` |
| wording, patient answer | "Последний раз ел(а) {solid} часов назад, пил(а) воду {liquid} часов назад." | authored | `pending` |
| wording, anaesthetist discovery | "Уточнил у пациента сам: последний приём пищи — {solid} часов назад, воды — {liquid} часов назад." | authored | `pending` |

**Question:** are those windows realistic for an emergency acute abdomen presenting at 6–24 h from onset, and should the distribution be weighted rather than uniform?

---

## 3. Aspiration risk management — deliberately absent

Matrix PR03 approves the *concept*: the anaesthesiologist flags aspiration risk and manages it; the operation is not automatically delayed to a 2-hour mark. The remediation task is equally explicit:

> Do not implement details of aspiration management from model memory.

So the seeded interval is stored and can be asked for, and **nothing consumes it**. There is no rapid-sequence-induction model, no delay rule, no risk score, and no consequence attached to a short fasting interval. That is a gap, and it is reported as one rather than filled.

| item | proposal | status | reviewer decision |
|---|---|---|---|
| what the anaesthesiologist SAYS on discovering a short interval | `NEEDS_ANESTHESIA_REVIEW` | not implemented | |
| whether it changes anything the learner can act on | `NEEDS_ANESTHESIA_REVIEW` | not implemented | |
| whether a short interval should ever delay the case, and on what basis | `NEEDS_ANESTHESIA_REVIEW` | not implemented — the matrix forbids a fixed 2 h wait | |
| RSI / airway technique | out of scope (task §24) | not implemented | |
| aspiration as a modelled complication | out of scope (task §24) | not implemented | |

**Consequence for the learner today:** a resident who never asks about fasting is not penalised in any clinical way; the anaesthesiologist obtains the history, and the omission appears in the debrief as a preoperative omission. Whether that is sufficient teaching is an anaesthesia decision.

---

## 4. Preoperative anaesthesia workflow as implemented

| step | who | timing | notes |
|---|---|---|---|
| learner calls the anaesthesiologist | learner | — | `вызываю анестезиолога на осмотр` |
| anaesthesiologist travels | hospital | profile ETA (Reference: 20 min) | hospital operational data, not a clinical claim |
| arrival | system | on ETA | `STAFF_ARRIVED` |
| `anesthesia_review` completes | system | same minute as arrival | blocking preop item; cannot be satisfied by saying it |
| fasting history obtained, if the learner never asked | anaesthesiologist | same minute | `FASTING_HISTORY_OBTAINED`, `obtainedBy: "anesthesiologist"` |

The blocking preoperative set in a KZ hospital is: **consent, IV access, antibiotic prophylaxis, anaesthesia review**. Non-blocking: **fasting assessment**, plus the KZ jurisdictional ABO/Rh and coagulation items.

**Question:** is that blocking set right from an anaesthesia standpoint — in particular, should IV access be blocking (it currently is), and should the fasting assessment be non-blocking (it currently is)?

---

## 5. Consent (PR04, PR05)

| item | current | reviewer decision |
|---|---|---|
| learner behaviour sufficient for v1 | "объясняю операцию, риски/альтернативы, получаю согласие" — a single action | ☐ sufficient ☐ needs more |
| classification | LEVEL_2_EDUCATIONAL, `authority_layer: clinical_workflow` | ☐ accept ☐ change to ______ |
| enforcement | structural: `preop.ready` is false without it, so the operation cannot start | ☐ accept |
| teaching wording | "Плановый оперативный доступ не начинают без оформленного информированного согласия…" | ☐ accept ☐ reword |
| refused consent | `CONSENT_REFUSED` exists as an event but no pathway uses it | out of scope this pass |

---

## Concrete questions for the anaesthesia reviewer

1. What should the anaesthesiologist actually say and do when the patient drank water 1 hour before an emergency appendectomy — in terms a resident can respond to?
2. Are the seeded fasting windows (solids 4–10 h, liquids 1–4 h) realistic for this presentation?
3. Should any fasting interval ever delay this operation, and on what basis if not a fixed clock?
4. Is the blocking preoperative set (consent, IV access, prophylaxis, anaesthesia review) correct, and should prophylaxis stay blocking?
5. Is a single "obtain consent" action sufficient for v1, or should specific risks be named?
