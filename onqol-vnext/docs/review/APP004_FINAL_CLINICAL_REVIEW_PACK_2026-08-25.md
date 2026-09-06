# APP-004 final clinical review pack

**Date:** 2026-08-25
**For:** the APP-004 clinical reviewer (and, where marked, pharmacy / anaesthesia second reviewers)
**Supersedes:** the ~20 scattered reviewer questions raised by the 2026-08-25 remediation pass
**Governing documents:** `APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25`,
`ONQOL_CLINICAL_EVIDENCE_GOVERNANCE_SPEC_v1.0_2026-08-13`

---

## What you are being asked to do

APP-004 is **mechanically playable end to end** and **clinically unapproved**.
Zero content objects are `approved_for_training`. Everything the simulator
would need in order to change the patient — disease course, treatment
response, complication risk, discharge readiness — is withheld at runtime and
recorded as a simulator limitation, never faked.

That is the intended state. It is also why the case cannot go to residents yet.

This pack is the single list of the medicine that still needs a human
decision. It replaces the previous questionnaire; you should not need to open
anything else to answer a row, though every row links to the detailed table
that holds its full context.

**You are not being asked to approve the software.** You are being asked to
decide clinical content. A row you approve becomes active runtime behavior
exactly as described in its *Runtime effect if approved* column — nothing more.

## The five tables

Every unresolved item belongs to exactly one of these. There is no sixth
"miscellaneous" table.

| # | table | domain | open decisions |
| --- | --- | --- | --- |
| 1 | [`APP004_VITALS_LABS_REVIEW_TABLE.md`](APP004_VITALS_LABS_REVIEW_TABLE.md) | baseline vitals, inflammatory profiles, labs, disease course over time | 22 |
| 2 | [`APP004_ANALGESIA_REVIEW_TABLE.md`](APP004_ANALGESIA_REVIEW_TABLE.md) | analgesic drugs, doses, routes, response model, fluids | 20 |
| 3 | [`APP004_ANTIBIOTIC_PROPHYLAXIS_REVIEW_TABLE.md`](APP004_ANTIBIOTIC_PROPHYLAXIS_REVIEW_TABLE.md) | surgical prophylaxis regimens, timing, KZ formulary | 12 |
| 4 | [`APP004_ANESTHESIA_NPO_REVIEW_TABLE.md`](APP004_ANESTHESIA_NPO_REVIEW_TABLE.md) | fasting, aspiration risk scope, preoperative blocking set, consent | 11 |
| 5 | [`APP004_DISCHARGE_REVIEW_TABLE.md`](APP004_DISCHARGE_REVIEW_TABLE.md) | functional discharge readiness, discharge bundle | 12 |
| | | **total** | **77** |

## How to record a decision

Write into the `Decision` column of the register below, or in the linked
table — either is authoritative, but please use one consistently.

`Decision` must be blank or exactly one of:

```
APPROVE      the content as proposed becomes active
REVISE       approve the item with the change you write in Notes
REMOVE       the item must not exist in the product
NEEDS_SOURCE you cannot decide without a source that is not yet cited
```

Nothing in this pack is pre-filled with a human decision. Rows marked
`second review required` cannot be promoted on one signature, per the
Governance Spec's high-risk domains (medication dosing, anaesthesia,
high-risk operative safety, pharmacologic VTE prophylaxis).

## Risk classes used below

| class | meaning |
| --- | --- |
| `PATIENT_TRUTH` | decides what is true of the simulated patient |
| `HIGH` | a learner-facing dose, threshold or safety claim |
| `MODERATE` | changes learner-visible behavior but asserts no dose/threshold |
| `WORKFLOW` | hospital or jurisdictional process, not universal medicine |

---

# 1. Vitals, laboratory and disease course

Table: [`APP004_VITALS_LABS_REVIEW_TABLE.md`](APP004_VITALS_LABS_REVIEW_TABLE.md) · Matrix V01–V08, T01–T08

**Why this table matters most:** these rows decide the patient the resident
actually meets. Until they are settled, every APP-004 session runs on
unapproved patient truth and is stamped `patientTruthApproved: false`.

| Item ID | Clinical question | Current proposed content | Runtime status | Authority layer | Source | Source date | Evidence summary | Jurisdiction | Risk | Runtime effect if approved | Decision | Reviewer | 2nd review? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `APP004-LAB-01` | Is HR 72–112/min an acceptable envelope for an *ordinary stable* uncomplicated APP-004 patient, or should it be narrowed? | 72–112 /min | active, development only | patient_truth | `NEEDS_SOURCE` (union of legacy authored ranges) | — | none cited | KZ | `PATIENT_TRUTH` | The seeded generator may draw HR only inside the approved range | | | no | Matrix V01 objects that 112 is high for "ordinary stable" |
| `APP004-LAB-02` | Same question for temperature 36.7–38.5 °C | 36.7–38.5 °C | active, development only | patient_truth | `NEEDS_SOURCE` | — | none cited | KZ | `PATIENT_TRUTH` | as above | | | no | |
| `APP004-LAB-03` | Same for systolic BP 100–140 mmHg | 100–140 mmHg | active, development only | patient_truth | `NEEDS_SOURCE` | — | none cited | KZ | `PATIENT_TRUTH` | as above | | | no | No diastolic value is modelled or rendered; confirm that is acceptable |
| `APP004-LAB-04` | Same for respiratory rate 14–24/min | 14–24 /min | active, development only | patient_truth | `NEEDS_SOURCE` | — | none cited | KZ | `PATIENT_TRUTH` | as above | | | no | |
| `APP004-LAB-05` | Same for WBC 8–18 ×10⁹/L | 8–18 ×10⁹/L | active, development only | patient_truth | `NEEDS_SOURCE` | — | none cited | KZ | `PATIENT_TRUTH` | as above | | | no | |
| `APP004-LAB-06` | Same for neutrophils 65–90 % | 65–90 % | active, development only | patient_truth | `NEEDS_SOURCE` | — | none cited | KZ | `PATIENT_TRUTH` | as above | | | no | |
| `APP004-LAB-07` | Same for CRP 2–140 mg/L | 2–140 mg/L | active, development only | patient_truth | `NEEDS_SOURCE` | — | none cited | KZ | `PATIENT_TRUTH` | as above | | | no | The 2–140 span is very wide for one phenotype |
| `APP004-LAB-08` | What HR / T / RR / WBC / neutrophil / CRP ranges define the **`minimal`** inflammatory profile? | `NEEDS_CLINICAL_REVIEW` — structure authored, all six ranges null | inactive (`generation_enabled: false`) | patient_truth | — | — | — | KZ | `PATIENT_TRUTH` | Replaces the flat envelope: a patient is drawn as one coherent profile rather than six independent values | | | no | Matrix V03 asks for coherence across the row |
| `APP004-LAB-09` | Same for the **`moderate`** profile | `NEEDS_CLINICAL_REVIEW` | inactive | patient_truth | — | — | — | KZ | `PATIENT_TRUTH` | as above | | | no | Expected to be the commonest profile |
| `APP004-LAB-10` | Same for the **`marked`** profile | `NEEDS_CLINICAL_REVIEW` | inactive | patient_truth | — | — | — | KZ | `PATIENT_TRUTH` | as above | | | no | Ceiling of "still uncomplicated" |
| `APP004-LAB-11` | Roughly what share of base APP-004 patients should fall in each profile? | `NEEDS_CLINICAL_REVIEW` | inactive | patient_truth | — | — | — | KZ | `PATIENT_TRUTH` | Seeded profile selection weights | | | no | A distribution, not a claim about any one patient |
| `APP004-LAB-12` | Should symptom duration shift the profile **distribution**? | `NEEDS_CLINICAL_REVIEW` | not implemented | patient_truth | — | — | — | KZ | `PATIENT_TRUTH` | Duration biases which profile is drawn | | | no | Matrix V04 permits probability influence, forbids deterministic per-value drift (already removed) |
| `APP004-LAB-13` | Should the pain score be coupled to the inflammatory profile? | currently drawn independently, `pain_score: [4, 8]` | active, development only | patient_truth | `NEEDS_SOURCE` | — | — | KZ | `PATIENT_TRUTH` | Pain is drawn coherently with the profile | | | no | |
| `APP004-LAB-14` | Should APP-004 seed a **pain-driven component** of HR and RR? | concept only; no magnitude | not implemented | patient_truth | expert opinion | — | — | KZ | `HIGH` | Part of HR/RR becomes attributable to pain, and can fall with analgesia | | | yes | Matrix V02 = APPROVE concept / NEEDS SOURCE for calibration |
| `APP004-LAB-15` | If so, by how much may HR/RR fall after effective analgesia? | `NEEDS_CLINICAL_REVIEW` | not implemented | clinical_rule | — | — | — | KZ | `HIGH` | Analgesia changes vitals through the pain component only | | | yes | Depends on `APP004-LAB-14` and `APP004-ANLG-11` |
| `APP004-LAB-16` | Are the three urinalysis wordings acceptable as written? | normal / trace leucocytes / trace erythrocytes, each explicitly "нитриты отрицательные, бактериурии нет" | active, `pending` | patient_truth | matrix V06 | 2026-08-25 | concept approved by the matrix | KZ | `PATIENT_TRUTH` | Seeded qualitative urinalysis variant | | | no | Never presented as UTI, stone or pyelonephritis |
| `APP004-LAB-17` | How often should the urinalysis be abnormal at all in retrocecal appendicitis? | currently uniform across the three variants | active, `pending` | patient_truth | `NEEDS_CLINICAL_REVIEW` | — | — | KZ | `PATIENT_TRUTH` | Variant selection weights | | | no | |
| `APP004-LAB-18` | Are the eight biochemistry result wordings acceptable? | all "в пределах референсных значений", qualitative, no numbers | active, `pending` | patient_truth | `NEEDS_SOURCE` | — | — | KZ | `PATIENT_TRUTH` | Only analytes the learner names are reported, in this wording | | | no | No numeric value is asserted anywhere |
| `APP004-LAB-19` | Should any biochemistry analyte ever be abnormal in base APP-004? | currently never | active, `pending` | patient_truth | `NEEDS_CLINICAL_REVIEW` | — | — | KZ | `PATIENT_TRUTH` | Seeded abnormal variants become possible | | | no | |
| `APP004-LAB-20` | **Approve a bounded state-transition model for `TRJ-STABLE`.** | `natural_course_model: null` — the previous fixed per-hour drift was withdrawn and deleted | **inert; every clock advance logs a simulator limitation** | patient_truth | `NEEDS_CLINICAL_REVIEW` | — | Matrix T01/T02 rejected the old arithmetic as not guideline-derived | KZ | `PATIENT_TRUTH` | **The patient would change over time at all.** Today 8 hours of clinical time change nothing | | | yes | The single highest-value row in this pack — see §"What one approval would unlock" |
| `APP004-LAB-21` | Perforation probability as a function of duration / phenotype | `NEEDS_SOURCE` | not implemented | patient_truth | — | — | Matrix T03 forbids a deterministic threshold | KZ | `HIGH` | Delay could progress the disease probabilistically | | | yes | Depends on `APP004-LAB-20` |
| `APP004-LAB-22` | Deterioration thresholds (what counts as a deterioration worth interrupting the learner) | `NEEDS_CLINICAL_REVIEW` — nothing implemented | not implemented; **no producer exists in code** | clinical_rule | — | — | Matrix T08 deferred entirely | KZ | `HIGH` | Contract §7.4 (deterioration interrupts the current task) would become reachable, and with it §14 escalation and death as a terminal state | | | yes | Do **not** approve a threshold without a source |

### What one approval would unlock

`APP004-LAB-20` alone converts eleven `BLOCKED_BY_GOVERNANCE` rows in the
compliance map into testable behavior: disease progression, the consequence of
delay, reassessment showing change, and postoperative evolution. It is the
highest-leverage single decision in this pack.

---

# 2. Analgesia and fluids

Table: [`APP004_ANALGESIA_REVIEW_TABLE.md`](APP004_ANALGESIA_REVIEW_TABLE.md) · Matrix M01–M09, PO02, PO03
**Second review required throughout** (medication dosing is a high-risk domain).

**What was withdrawn, and must not come back:** a single
`analgesia_iv_nsaid → pain −3` applied to ketorolac and ketoprofen by any
route. It is deleted. Each `(drug, route)` pair is now its own content object
with `response_envelope: null`, and the route must match the order, so an
intramuscular order can never inherit an intravenous response.

| Item ID | Clinical question | Current proposed content | Runtime status | Authority layer | Source | Risk | Runtime effect if approved | Decision | Reviewer | 2nd review? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `APP004-ANLG-01` | Approve dose + frequency/max for **paracetamol IV**, adult, KZ Reference Hospital | `NEEDS_PHARMACY_REVIEW` | recognized, no dose approved | clinical_rule | — | `HIGH` | The dose becomes checkable; an out-of-range dose could be challenged | | | yes | Base of a multimodal regimen |
| `APP004-ANLG-02` | Same for **paracetamol oral** (postoperative) | `NEEDS_PHARMACY_REVIEW` | as above | clinical_rule | — | `HIGH` | as above | | | yes | Matrix PO02 |
| `APP004-ANLG-03` | Same for **ibuprofen oral** | `NEEDS_PHARMACY_REVIEW` | as above | clinical_rule | — | `HIGH` | as above | | | yes | |
| `APP004-ANLG-04` | Same for **ketoprofen IV** | `NEEDS_PHARMACY_REVIEW` | as above | clinical_rule | — | `HIGH` | as above | | | yes | |
| `APP004-ANLG-05` | Same for **ketoprofen IM** | `NEEDS_PHARMACY_REVIEW` | as above | clinical_rule | — | `HIGH` | as above | | | yes | The commonest order in the smoke sessions |
| `APP004-ANLG-06` | Same for **ketorolac IV** | `NEEDS_PHARMACY_REVIEW` | as above | clinical_rule | — | `HIGH` | as above | | | yes | Duration-of-therapy limits also needed |
| `APP004-ANLG-07` | Same for **ketorolac IM** | `NEEDS_PHARMACY_REVIEW` | as above | clinical_rule | — | `HIGH` | as above | | | yes | |
| `APP004-ANLG-08` | Should **tramadol** be in the reference set at all, and at what dose/route? | `NEEDS_PHARMACY_REVIEW`; proposed as rescue only | recognized, no dose | clinical_rule | — | `HIGH` | Becomes an approved rescue option | | | yes | Matrix PO03 = NEEDS SOURCE |
| `APP004-ANLG-09` | Should **metamizole** enter the reference set? | deliberately excluded; ordering it returns an honest "not supported" | `not_in_reference_set` | clinical_rule | `NEEDS_SOURCE` | `HIGH` | Would become orderable rather than refused | | | yes | Matrix M02. Reported local practice alone is not enough |
| `APP004-ANLG-10` | Should **metamizole + diphenhydramine** (KZ practice) enter the reference set? | deliberately excluded | `not_in_reference_set` | clinical_rule | `NEEDS_SOURCE` | `HIGH` | as above | | | yes | Separate KZ-practice question, per the matrix |
| `APP004-ANLG-11` | What **bounded pain reduction** should an effective NSAID produce — as a range, not a point? | `NEEDS_CLINICAL_REVIEW`; the reviewer's stated shape is "variable improvement" | `response_envelope: null` for every pair | clinical_rule | — | `HIGH` | **Analgesia would change the patient at all.** Today the drug is given, recorded, and nothing happens | | | yes | Do not restore a single universal delta |
| `APP004-ANLG-12` | Onset per drug and route | `NEEDS_PHARMACY_REVIEW` | null | clinical_rule | — | `HIGH` | Effect lands at a realistic time rather than immediately | | | yes | |
| `APP004-ANLG-13` | Duration per drug and route | `NEEDS_PHARMACY_REVIEW` | null | clinical_rule | — | `HIGH` | Effect wears off | | | yes | |
| `APP004-ANLG-14` | Repeat dosing / rescue behavior | `NEEDS_PHARMACY_REVIEW` | not modelled | clinical_rule | — | `HIGH` | Repeat doses behave differently from the first | | | yes | |
| `APP004-ANLG-15` | Should APP-004 ever generate a patient with an NSAID contraindication? | not modelled; the checks are authored and inactive | inactive | clinical_rule | matrix M03 | `MODERATE` | The suitability pathway becomes exercisable | | | yes | Matrix AB06 says yes for beta-lactam allergy; the NSAID equivalent is undecided |
| `APP004-ANLG-16` | Which contraindication, and how often? | `NEEDS_CLINICAL_REVIEW` | — | patient_truth | — | `MODERATE` | Seeded patient attribute | | | yes | Depends on `APP004-ANLG-15` |
| `APP004-ANLG-17` | What should a **volume-deficit state** consist of, and when should APP-004 generate one? | seam only (`requires_patient_state: volume_deficit`); base APP-004 never has it | inactive | patient_truth | matrix M09 | `MODERATE` | Fluids could have a conditional effect | | | no | Concept approved by the matrix; content missing |
| `APP004-ANLG-18` | Fluid response envelope, conditional on that state | `NEEDS_CLINICAL_REVIEW` | null | clinical_rule | — | `HIGH` | Fluids change haemodynamics in deficit only | | | yes | The old `500 mL → HR −6 / SBP +4` is deleted (M08) |
| `APP004-ANLG-19` | Approve the postoperative multimodal base regimen (paracetamol ± NSAID) | concept approved by the matrix; doses open | not implemented | clinical_pathway | matrix PO02 | `HIGH` | A reference postoperative regimen exists for debrief comparison | | | yes | |
| `APP004-ANLG-20` | Should the debrief ever comment on analgesia adequacy? | no rule exists | not implemented | clinical_rule | — | `MODERATE` | Debrief could name an analgesia gap | | | no | Currently the debrief makes no analgesia claim at all |

---

# 3. Antibiotic prophylaxis

Table: [`APP004_ANTIBIOTIC_PROPHYLAXIS_REVIEW_TABLE.md`](APP004_ANTIBIOTIC_PROPHYLAXIS_REVIEW_TABLE.md) · Matrix AB01–AB09
**Second review required throughout.**

**Read this first.** The previous build carried
`RULE-CEFAZOLIN-PROPHYLAXIS-DOSE` at `reviewed_internal`, signed
**Сарина Т.Т.** and **Каукенова Б.Н.** (2026-08-20), teaching cefazolin 2 g as
*the* standard prophylaxis. ASHP/SIS/SHEA/IDSA guidance (`SRC-ASHP-PROPH`)
gives appendectomy prophylaxis as **cefazolin + metronidazole**, or a single
agent with anaerobic cover such as cefoxitin/cefotetan — cefazolin alone does
not cover the anaerobes the operation exposes. The rule was therefore
**downgraded to `pending`** in the remediation pass, with the prior review
preserved as `provenance.superseded_review`. Confirming or overturning that
downgrade is `APP004-ABX-05`.

| Item ID | Clinical question | Current proposed content | Runtime status | Source | Risk | Runtime effect if approved | Decision | Reviewer | 2nd review? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `APP004-ABX-01` | Approve **R1: cefazolin + metronidazole** — exact doses and route | `NEEDS_PHARMACY_REVIEW`; IV | `pending` | SRC-ASHP-PROPH | `HIGH` | Becomes an accepted reference regimen; the learner's order can be compared to it | | | yes | |
| `APP004-ABX-02` | Approve **R2: cefoxitin** single agent — dose and route | `NEEDS_PHARMACY_REVIEW`; IV | `pending` | SRC-ASHP-PROPH | `HIGH` | as above | | | yes | KZ availability unconfirmed — see `APP004-ABX-07` |
| `APP004-ABX-03` | Approve **R3: cefotetan** single agent | `NEEDS_PHARMACY_REVIEW` | `pending`; not in the formulary | SRC-ASHP-PROPH | `HIGH` | as above | | | yes | Would also need adding to the formulary |
| `APP004-ABX-04` | Approve **R4: beta-lactam allergy alternative** — drug, dose, route | `NEEDS_PHARMACY_REVIEW` | `pending` | SRC-ASHP-PROPH | `HIGH` | Allergic patients have a correct pathway | | | yes | Prerequisite for `APP004-ABX-11` |
| `APP004-ABX-05` | Is **cefazolin monotherapy** acceptable for appendectomy in your setting? | proposed **NOT ACCEPTED** without a named local protocol | rule downgraded to `pending` | SRC-ASHP-PROPH does not support it | `HIGH` | If REMOVE: monotherapy stays unendorsed. If APPROVE: a named local protocol must be cited | | | yes | Overturns or confirms the downgrade of a rule you previously signed |
| `APP004-ABX-06` | Does the **KZ national protocol / KNF** sanction a regimen differing from ASHP? | content notes «КНФ РК приводит отличную схему (1 г, редозинг 0.5-1 г q6-8h)» | recorded as a note only | KNF RK | `HIGH` / `WORKFLOW` | Decides which is taught as *the* reference and which is a discussed local variant | | | yes | Must never become an automatic correction of the resident |
| `APP004-ABX-07` | Is **cefoxitin actually available** in the KZ setting these residents practise in? | `NEEDS_PHARMACY_REVIEW` | — | — | `WORKFLOW` | Availability gates whether R2 can be offered | | | no | Do not invent KZ availability |
| `APP004-ABX-08` | Pre-incision **timing window** per accepted agent | `NEEDS_CLINICAL_REVIEW` (WSES 2020 cited as 0–60 min) | `timingValidated: false` — the time is recorded and judged by nobody | WSES 2020 | `HIGH` | Prophylaxis timing becomes assessable; late or missing prophylaxis can be named in debrief | | | yes | Matrix AB07 |
| `APP004-ABX-09` | **Redosing** rule per agent | `NEEDS_PHARMACY_REVIEW` | not implemented | — | `HIGH` | Long operations trigger redosing | | | yes | |
| `APP004-ABX-10` | Should `antibiotic_prophylaxis` remain a **hard preoperative blocker**? | currently blocking, so the OR-door catch scene cannot occur | blocking | matrix PR07 | `MODERATE` | If non-blocking: the anaesthetist can catch the omission at the door (matrix PR07 approves the scene) | | | yes | A clinical decision about whether the operation may proceed with prophylaxis outstanding |
| `APP004-ABX-11` | Should APP-004 generate a **beta-lactam allergy** patient, and how often? | not implemented — the patient model has no allergy field | not implemented | matrix AB06 (approve, "generate rarely") | `MODERATE` | The allergy pathway becomes exercisable | | | yes | Blocked until `APP004-ABX-04` exists, else it leads nowhere |
| `APP004-ABX-12` | Sign off the teaching text for `RULE-NO-ROUTINE-POSTOP-ANTIBIOTICS-UNCOMPLICATED` | «После аппендэктомии по поводу неосложнённого аппендицита продолжение антибиотиков не рекомендовано. Какое показание к продолжению курса ты видишь у этого пациента?» | authored, `pending`, inert | matrix AB08/PO04 | `MODERATE` | The mentor would challenge a prolonged postoperative course once | | | no | Matrix decision is REMOVE routine antibiotics; the system already never gives any itself |

---

# 4. Anaesthesia, fasting and consent

Table: [`APP004_ANESTHESIA_NPO_REVIEW_TABLE.md`](APP004_ANESTHESIA_NPO_REVIEW_TABLE.md) · Matrix PR01–PR07, MR05
**`NEEDS_ANESTHESIA_REVIEW` — independent anaesthesiology reviewer required.**

**Product behavior kept separate from anaesthesia content, deliberately.** NPO
is no longer a universal emergency-surgery hard stop: the blocking `npo_status`
item is gone, `fasting_assessment` replaced it as non-blocking, and the
operation proceeds without it. What the fasting interval should *mean*
clinically is entirely below.

| Item ID | Clinical question | Current proposed content | Runtime status | Source | Risk | Runtime effect if approved | Decision | Reviewer | 2nd review? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `APP004-ANES-01` | Are the seeded fasting windows realistic — **last solid food 4–10 h**, **last clear liquid 1–4 h**? | 4–10 h / 1–4 h | active, `pending` | `NEEDS_SOURCE` | `PATIENT_TRUTH` | The generator may seed these intervals | | | no | A history fact, not a physiological claim |
| `APP004-ANES-02` | What should the anaesthesiologist **say** on discovering a short interval, in terms a resident can respond to? | `NEEDS_ANESTHESIA_REVIEW` | not implemented | — | `MODERATE` | The anaesthetist raises aspiration risk in the case | | | yes | Currently the interval is obtained and nothing consumes it |
| `APP004-ANES-03` | Should a short interval **change anything the learner can act on**? | `NEEDS_ANESTHESIA_REVIEW` | not implemented | — | `HIGH` | A management decision point appears | | | yes | |
| `APP004-ANES-04` | Should a short fasting interval ever **delay** this operation, and on what basis? | `NEEDS_ANESTHESIA_REVIEW` | not implemented | matrix PR03 forbids a fixed 2 h wait | `HIGH` | Timing of the operation could depend on fasting | | | yes | Explicitly **not** a clock rule |
| `APP004-ANES-05` | Confirm RSI / airway technique stays **out of scope** | out of scope by the task | not implemented | — | `HIGH` | — | | | yes | Confirm rather than assume |
| `APP004-ANES-06` | Confirm aspiration as a **modelled complication** stays out of scope | out of scope by the task | not implemented | — | `HIGH` | — | | | yes | |
| `APP004-ANES-07` | Is the **blocking preoperative set** correct: consent, IV access, antibiotic prophylaxis, anaesthesia review? | as listed | active | matrix PR01–PR07 | `MODERATE` / `WORKFLOW` | Decides what stops the operation starting | | | yes | See also `APP004-ABX-10` |
| `APP004-ANES-08` | Should **IV access** be blocking? | currently blocking | active | — | `MODERATE` | — | | | no | |
| `APP004-ANES-09` | Should **fasting assessment** stay non-blocking? | currently non-blocking | active | matrix PR01 | `MODERATE` | — | | | yes | This is the row that keeps NPO from becoming a universal hard stop |
| `APP004-ANES-10` | Is a single "obtain consent" action sufficient for v1, or must specific risks be named? | one `OBTAIN_CONSENT` action; no consent-form quiz | active | matrix PR04 | `MODERATE` | Consent could require naming risks | | | no | Matrix PR04 warns against quizzing every form item |
| `APP004-ANES-11` | Approve the consent classification and teaching wording | `LEVEL_2_EDUCATIONAL`, `authority_layer: clinical_workflow`; «Плановый оперативный доступ не начинают без оформленного информированного согласия…» | authored, `pending`, structurally enforced | matrix PR05 | `MODERATE` | The mentor could teach it; the structural block already exists | | | no | Downgraded from LEVEL_4 in the remediation pass — a missing consent form is not a physiologic catastrophe |

---

# 5. Discharge readiness

Table: [`APP004_DISCHARGE_REVIEW_TABLE.md`](APP004_DISCHARGE_REVIEW_TABLE.md) · Matrix PO10–PO21

**The honest statement of today's behavior:** a learner can discharge a
post-appendectomy patient as soon as the patient has left theatre and
recovery. **No clinical readiness criterion is evaluated, because none is
approved.** The mechanism to evaluate them exists and is wired; the content is
empty on purpose. The withholding is recorded on the log at the moment of
discharge. This is a **NO-GO item for the resident pilot.**

**Already explicitly removed — please confirm these stay removed:** flatus or
stool, a minimum 24-hour admission, 24 h afebrile, routine next-day CBC, and a
pain ≤ 3 numeric cutoff. The previous build's `temperatureC ≥ 38.0` blocker is
also gone; it was an unreviewed numeric threshold living in code.

| Item ID | Clinical question | Current proposed content | Runtime status | Source | Risk | Runtime effect if approved | Decision | Reviewer | 2nd review? | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `APP004-DISCH-01` | Approve **`haemodynamically_stable`** as a discharge criterion, and say what you would accept as "unstable" here | learner-facing reason «гемодинамика нестабильна»; threshold `NEEDS_CLINICAL_REVIEW` | inert; skipped and logged | matrix PO15 | `HIGH` | Discharge is refused while unstable, in the content's own words | | | yes | Express it however you would say it to a resident |
| `APP004-DISCH-02` | Approve **`pain_controlled_on_oral_regimen`** | «боль требует повторных парентеральных доз»; **no numeric cutoff** | inert | matrix PO12, PO15 | `HIGH` | Discharge is refused while pain needs repeated parenteral rescue | | | yes | Function and control, not a number (PO12 removed pain ≤ 3) |
| `APP004-DISCH-03` | Approve **`tolerating_oral_intake`** | «пациент не переносит пероральный приём» | inert | matrix PO15 | `MODERATE` | as above | | | no | |
| `APP004-DISCH-04` | Approve **`no_significant_persistent_vomiting`**, and define "significant" | «пациента продолжает рвать»; threshold `NEEDS_CLINICAL_REVIEW` | inert | matrix PO15 | `MODERATE` | as above | | | no | |
| `APP004-DISCH-05` | Approve **`mobile`** | «пациент ещё не активизирован» | inert | matrix PO15 | `MODERATE` | as above | | | no | |
| `APP004-DISCH-06` | Approve **`urinary_function_acceptable`**, and say when it is clinically relevant for this operation | «не восстановлено самостоятельное мочеиспускание»; relevance `NEEDS_CLINICAL_REVIEW` | inert | matrix PO15 | `MODERATE` | as above | | | no | May be irrelevant for most laparoscopic appendectomies |
| `APP004-DISCH-07` | Is the six-criterion functional set **complete**, or is something missing? | the six above | inert | matrix PO15 | `HIGH` | Defines the whole discharge gate | | | yes | |
| `APP004-DISCH-08` | Confirm the five removed criteria stay removed | flatus/stool · 24 h admission · 24 h afebrile · routine next-day CBC · pain ≤ 3 | removed, pinned by tests | matrix PO10–PO13, PO16 | `MODERATE` | Re-adding any would make the simulator teach a ritual | | | no | Tests fail if any returns |
| `APP004-DISCH-09` | Is **same-day / next-day** discharge acceptable for selected uncomplicated patients? | permitted; no minimum stay is enforced | active | SRC-SDD-2021, matrix PO13 | `MODERATE` | Confirms current behavior | | | no | The Reference smoke discharges at ~11.7 h |
| `APP004-DISCH-10` | Approve the **discharge bundle wording** | follow-up «Контроль у хирурга по месту жительства.» · histopathology «Результат гистологического исследования — по месту жительства.» · five return precautions | active, `reviewed_internal`, awaiting a recorded reviewer identity | matrix PO18, PO20 | `MODERATE` | System-issued at discharge; the resident is not quizzed on reciting it | | | yes | Second review on final wording per PO15 |
| `APP004-DISCH-11` | Should **suture-removal instructions** be included? | absent — they depend on closure material, which is not modelled | not implemented | matrix PO19 | `MODERATE` | Would need closure material modelled first | | | no | |
| `APP004-DISCH-12` | Should the system **warn** (not block) on a very early discharge? | no warning; PO21 says keeping a ready patient overnight is at most a resource note | not implemented | matrix PO21 | `MODERATE` | A non-blocking debrief note on very early discharge | | | no | |

---

## Summary for the reviewer

| | |
| --- | --- |
| **Decisions requiring your signature** | 77 |
| of which **second review required** | 44 |
| of which **`PATIENT_TRUTH`** (decides the patient itself) | 19 |
| **Content currently `approved_for_training`** | **0** |
| **Pilot readiness** | **NO-GO** |

### If you have limited time, answer these five first

1. `APP004-LAB-20` — a bounded course model for `TRJ-STABLE`. Without it the
   patient never changes, and eleven contract behaviors stay dark.
2. `APP004-ANLG-11` — a bounded pain-reduction range for an effective NSAID.
   Without it no treatment does anything.
3. `APP004-ABX-05` — confirm or overturn the withdrawal of cefazolin
   monotherapy. Your name is on the superseded rule.
4. `APP004-DISCH-01`/`02` — the two discharge criteria that would stop an
   unready patient going home. Today nothing does.
5. `APP004-LAB-08`–`11` — the inflammatory profiles that decide which patient
   the resident actually meets.

### What this pack deliberately does not ask you

It does not ask you to approve anything the software should decide, and it
does not contain a single number generated from model memory. Where a value
was needed and no source existed, the cell says `NEEDS_SOURCE` or
`NEEDS_CLINICAL_REVIEW` rather than a plausible figure. Six numeric rules that
previously existed without a source were **deleted** rather than left for you
to rubber-stamp: the per-hour disease drift, the post-source-control recovery
curve, the universal NSAID pain delta, the fixed crystalloid vital-sign
response, the monitoring-to-SSI-incidence multiplier, and the 38.0 °C
discharge fever blocker.
