# APP-004 Clinical Approval Manifest

> **UPDATE — 2026-09-01:** the independent second review referenced as "outstanding" throughout
> this document arrived (`Second Clinical Reviewer Decision.md`, Sarina T.T., 2026-09-01) and
> APPROVED four of the five §C pending objects (`ENV-UNCOMPLICATED-INFLAMMATION` + linked
> profiles, `PHENOTYPE-RETROCECAL-APP004`, `CAL-NAUSEA-VOMITING-SELECTION-APP004`,
> `FINDINGS-FASTING-HISTORY`), now `approved_for_training`, and REVISED the fifth
> (`TRJ-POSTOP-RECOVERY`, recovery-clock anchor only — fixed in code, object stays `pending`
> awaiting a focused re-review). This §-A–E body is the **2026-08-31 historical snapshot and is
> left unedited** per audit-history policy; the current state is recorded in the new §F below and
> in `docs/review/APP004_FINAL_SECOND_REVIEW_PACKET_2026-09-01.md`. `patient_truth_approved`
> stays `false` and the pilot gate stays `NO_GO_FOR_RESIDENT_PILOT` (`TRJ-POSTOP-RECOVERY` and the
> legacy union envelope are still pending).

**Date:** 2026-08-31
**Compiled content version:** `20b1c6fc188564c9`
**Machine-readable companion:** `APP004_CLINICAL_APPROVAL_MANIFEST_2026-08-31.json` (full provenance fields per object)

**Clinical authority**

- `APP004_CLINICAL_ACTIVATION_DECISIONS_v1.1_2026-08-31` — Clinical Lead (Botagoz Kaukenova)
- `APP-004 — Second Clinical Review` — Sarina T.T., General Surgery / Surgical Oncology, NROC, 2026-08-31, decision *APPROVE FOR PILOT AFTER LISTED EDITS*
- `APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25`

**Pilot gate:** `NO_GO_FOR_RESIDENT_PILOT` — `patientTruthApproved = false`.
This manifest makes it impossible to state "APP-004 is clinically approved": **five** active
patient-truth objects (§C) are still `pending`.

**Numeric calibration remediation — 2026-08-31.** The Clinical Lead's targeted remediation
of the six numeric/calibration blockers (`docs/review/APP004_NUMERIC_CALIBRATION_REVIEW_2026-08-31.md`,
"Decisions applied") is in the repository: `LAB-CHEMISTRY-ANALYTES-APP004` is **promoted**;
`PHENOTYPE-RETROCECAL-APP004` (revised values + variant weights), `CAL-NAUSEA-VOMITING-SELECTION-APP004`
(uniform accepted as simulation sampling) and `FINDINGS-FASTING-HISTORY` (ranges accepted +
liquid ≤ solid invariant) carry recorded Clinical Lead decisions but are **held `pending`**
pending the outstanding independent second review; `ENV-UNCOMPLICATED-INFLAMMATION` is **REVISE** — the Clinical Lead's verbatim
`minimal`/`moderate`/`marked_but_stable` calibration ranges and selection weights
(0.30/0.50/0.20, simulation diversity, not prevalence) are entered; the selection mechanism
ships dormant (`generation_enabled: false`) with a guardrail that forbids any union-envelope
fallback for a `learner_pilot` once it is enabled. `TRJ-POSTOP-RECOVERY` is **REVISE**
(model authored, ships dormant). Both stay `pending`. `case_presets[APP-004].runtime_status`
is **not** promoted.

**Reviewer shorthand**

- **CL** = `Botagoz Kaukenova — Clinical Lead`, reviewed_at `2026-08-31`
- **2R** = `Sarina T.T. — General Surgery / Surgical Oncology, NROC`, second_reviewed_at `2026-08-31`
- Every object below has `reviewed_by = [CL]` and `reviewed_at = 2026-08-31`. The
  **2R** column shows whether an independent second review was required and recorded.

---

## A. Approved for training — 46 objects

### A.1 Patient truth (qualitative only)

| ID | Layer | Source IDs | 2R | Scope | Runtime effect | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `DEMOGRAPHICS-APP-BASE-ADULT` | patient_truth | matrix P01/P02; CL decision | n/r | adult 18–58, pregnancy & major comorbidity excluded | bounds the generated patient's age/sex | `app004Remediation.test.js` t4, t8, t9; `patientGenerator.test.js` |
| `SYMPTOM-NAUSEA-VOMITING-COHERENCE` | patient_truth | matrix P06; CL decision | n/r | nausea/vomiting joint coherence (no vomiting without nausea) | gates vomiting generation on nausea | `app004Remediation.test.js` t7 |
| `PHENOTYPE-RETROCECAL-APP004-QUALITATIVE` | patient_truth | 2nd Clinical Review 2026-08-31; Activation Decisions v1.1 | **yes** | qualitative retrocecal history / exam / imaging / operative truth — **no numbers** | supplies narrative phenotype truth; numeric siblings stay in the pending raw phenotype | `app004Remediation.test.js` t6, t21, t25; smoke replay |
| `FINDINGS-HISTORY-BUNDLE` | patient_truth | matrix P03/P06/P07 | n/r | one-shot history narrative | rendered for a general history request | `coreRuntimeContract.test.js` PBC-5 |
| `FINDINGS-UNIVERSAL-NORMAL-LAYER` | patient_truth | matrix P10 | n/r | unrelated normal examination answers for the stable base patient | answers off-target exams without overwriting the abdomen | `coreRuntimeContract.test.js` PBC-5 |
| `TRJ-STABLE` | patient_truth | Activation Decisions v1.1; 2nd Clinical Review | **yes** | approved qualitative no-transition course | keeps the untreated patient "stable symptomatic → persistent uncomplicated" with no numeric drift | `app004Remediation.test.js` t20; `coreRuntimeContract.test.js` PBC-GOV |

### A.2 Perioperative clinical rules

| ID | Layer | Source IDs | 2R | Scope | Runtime effect | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `RULE-CONSENT-BEFORE-PROCEDURE` | clinical_workflow | matrix PR04/PR05 | **yes** | informed consent before an elective operative approach | structural preop-readiness gate; route/readiness only, no L4 | `app004Remediation.test.js` t32; `pilotRouteIntegrity.test.js` |
| `RULE-DELAY-BEYOND-24H-UNCOMPLICATED` | clinical_rule | `SRC-WSES-2025`; matrix T04 | **yes** | permission to schedule appendectomy within an in-hospital window up to 24 h | mentor may challenge only delay beyond the reviewed window; non-immediate surgery not penalised | `ruleEngine.test.js`; `app004Remediation.test.js` |
| `RULE-CEFAZOLIN-PROPHYLAXIS-DOSE` | clinical_rule | `SRC-ASHP-PROPH`; matrix AB04 | **yes** | cefazolin 2 g IV (3 g ≥ 120 kg) | validates prophylaxis dose | `pilotRouteIntegrity.test.js`; smoke replay |
| `RULE-CEFAZOLIN-REQUIRES-ANAEROBIC-COVERAGE` | clinical_rule | ASHP/SIS/SHEA/IDSA; 2nd Clinical Review | **yes** | cefazolin alone ≠ complete appendectomy prophylaxis | mentor asks for anaerobic cover; order not counted complete; no deterioration | `app004Remediation.test.js` (Journey D) |
| `RULE-ROUTINE-DRAIN-UNCOMPLICATED` | clinical_rule | `SRC-WSES-2020`, `SRC-WSES-2025`; matrix O10/MR03 | n/r | no routine drain for uncomplicated appendectomy | drain allowed & challenged, never catastrophically blocked; "не ставлю" ≠ placement | `app004Remediation.test.js` t35, t36 |
| `RULE-NO-ROUTINE-POSTOP-ANTIBIOTICS-UNCOMPLICATED` | clinical_rule | `SRC-WSES-2025` | **yes** | no routine postoperative antibiotics after uncomplicated appendectomy with source control | system administers none; mentor challenges the indication | `app004Remediation.test.js` t24 |
| `RULE-LAPAROSCOPIC-PREFERRED-WHEN-AVAILABLE` | clinical_rule | WSES 2020 1A; WSES 2025; matrix O01/O02/MR04 | n/r | laparoscopy preferred where capability exists; open remains valid | mentor asks rationale for open when laparoscopy available; not "wrong" | `app004Remediation.test.js` t34 |

### A.3 Preoperative workflow items (`operative.preop_requirements`)

| ID | Layer | Source IDs | 2R | Blocking | Runtime effect | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| `PREOP-CONSENT-APP004` | clinical_workflow | 2nd Clinical Review PREOP-02/03 | **yes** | yes | route/readiness; `PREOP_NOT_READY` if missing | `app004Remediation.test.js` t32 |
| `PREOP-IV-ACCESS-APP004` | clinical_workflow | 2nd Clinical Review PREOP-01 | n/r | yes | one functioning peripheral IV sufficient for base case | `pilotRouteIntegrity.test.js` |
| `PREOP-ANTIBIOTIC-PROPHYLAXIS-APP004` | clinical_rule | 2nd Clinical Review ABX-01–08; `SRC-ASHP-PROPH` | **yes** | yes | completed only by a validated complete regimen ≤ 60 min pre-incision | `pilotRouteIntegrity.test.js`; smoke replay |
| `PREOP-ANESTHESIA-REVIEW-APP004` | hospital_workflow | Activation Decisions v1.1 F6 | n/r (CL pilot authorization) | yes | induction/operative transition cannot execute without it; not deterioration, not L4 | `app004Remediation.test.js` t27; smoke replay |
| `PREOP-FASTING-ASSESSMENT-APP004` | clinical_workflow | Activation Decisions v1.1 F6; `SRC-ASA-FASTING-2023` | n/r (CL pilot authorization) | **no** | assessment recorded; never a 6/8 h countdown deadlock; staff catch-up if omitted | `app004Remediation.test.js` t27, t28; `coreRuntimeContract.test.js` §5.2 |

Anesthesia-related items carry `approval_note`: *resident-pilot use authorized by Clinical
Lead 2026-08-31; independent anesthesiology specialty review pending; no anesthesia
drug/airway-parameter teaching authorized*.

### A.4 Kazakhstan jurisdictional workflow (`jurisdiction: "KZ"`, non-blocking)

| ID | Layer | Source IDs | Runtime effect | Tests |
| --- | --- | --- | --- | --- |
| `PREOP-KZ-ABO-RH-APP004` | hospital_rule | `SRC-KZ-ANESTH-2023`, `SRC-KZ-BLOOD-2020` | applies only where hospital `jurisdiction = "KZ"`; omission → `jurisdictional_workflow_omission`; staff catch-up; never universal EBM | `app004Remediation.test.js` t29 |
| `PREOP-KZ-CBC-APP004` | hospital_rule | `SRC-KZ-ANESTH-2023` | same | `app004Remediation.test.js` t29/t30 |
| `PREOP-KZ-COAGULATION-APP004` | hospital_rule | `SRC-KZ-ANESTH-2023` | same; Reference + `jurisdictionContext="KZ"` → debrief teaching note only, route not blocked | `app004Remediation.test.js` t30 |

### A.5 Antibiotic prophylaxis policy & shared antibiotics

| ID | Layer | Source IDs | 2R | Runtime effect |
| --- | --- | --- | --- | --- |
| `ABX-PROPHYLAXIS-APP004-PILOT` | clinical_rule | 2nd Clinical Review AB-01–08; `SRC-ASHP-PROPH`, `SRC-WSES-2025` | **yes** | accepted-regimen table + 60-min window + drug-specific redose intervals |
| `MED-CEFAZOLIN-PILOT` / `MED-METRONIDAZOLE-PILOT` | clinical_rule | 2nd Clinical Review AB-04; `SRC-ASHP-PROPH` | **yes** | drug identity, dose, route, redose, allergy semantics |
| `MED-CEFOXITIN-PILOT` / `MED-CEFOTETAN-PILOT` | clinical_rule | 2nd Clinical Review AB-04 | **yes** | alternative single-agent regimens (KZ availability from formulary/resource, not guideline) |
| `MED-CLINDAMYCIN-PILOT` / `MED-AZTREONAM-PILOT` / `MED-GENTAMICIN-PILOT` | clinical_rule | 2nd Clinical Review AB-04 | **yes** | severe β-lactam allergy regimens; gentamicin 5 mg/kg dosing-weight, single dose |

### A.6 Shared analgesia formulary (identity / dose / route / safety only)

| ID | Layer | Source IDs | 2R | Runtime effect |
| --- | --- | --- | --- | --- |
| `MED-PARACETAMOL-PILOT` | clinical_rule | 2nd Clinical Review PAIN-02; pilot formulary | **yes** | 1 g PO/IV q6h, max 4 g/24 h; hepatic / alcohol / low-weight gates |
| `MED-IBUPROFEN-PILOT` | clinical_rule | 2nd Clinical Review PAIN-02; PROSPECT | **yes** | 400 mg PO q6–8h, max 2.4 g/day; AKI/PUD/hypersensitivity/bleeding/HF/pregnancy gates |
| `MED-TRAMADOL-PILOT` | clinical_rule | 2nd Clinical Review PAIN-02 | **yes** | rescue only; 50 → 50–100 mg q6h PRN; pilot max 400 mg/24 h (order-validation boundary, not toxicity threshold) |
| `MED-METAMIZOLE-KZ-PILOT` | clinical_rule (KZ) | 2nd Clinical Review Specific answer 2; KZ formulary | **yes** | KZ/formulary-aware alternative; 500–1000 mg PO/IV q6–8h, max 4 g/day; pyrazolone allergy / agranulocytosis gates |
| `MED-KETOPROFEN-KZ-PILOT` | clinical_rule (KZ) | 2nd Clinical Review Specific answer 1; KZ formulary | **yes** | 100 mg IM q12h, max 200 mg/day; generic `100 mg IV bolus` rejected |
| `MED-NSAID-SUITABILITY-CHECKS` | clinical_rule | 2nd Clinical Review PAIN-02; PROSPECT | **yes** | shared NSAID contraindication checks |

`diphenhydramine` is **not** bundled with any analgesic. `ketorolac` is **pending**
(`MED-KETOROLAC-PENDING`), not approved in the supplied review.

### A.7 VTE & enoxaparin

| ID | Layer | Source IDs | 2R | Runtime effect |
| --- | --- | --- | --- | --- |
| `PREOP-VTE-ASSESSMENT` | clinical_rule | `SRC-SAGES-VTE`; matrix PR13/PR14 | **yes** | Caprini strata; `accepts_any_appropriate_plan`; no universal LMWH |
| `MED-ENOXAPARIN-VTE-PILOT` | clinical_rule | 2nd Clinical Review VTE section | **yes** | 40 mg SC once daily, first dose after adequate hemostasis; only if renal function compatible & bleeding risk permits; no renal-adjustment dose invented |

### A.8 Discharge

| ID | Layer | Source IDs | 2R | Runtime effect |
| --- | --- | --- | --- | --- |
| `DISCHARGE-CRITERIA-APP004` | clinical_rule | matrix PO12–PO16/PO21; `SRC-SDD-2021`, `SRC-WSES-2020` | **yes** | functional discharge criteria; no 24 h stay / next-day CBC / stool / flatus / pain ≤ 3 / universal urination |
| `DISCHARGE-BUNDLE-APP004` | clinical_workflow (KZ wording) | matrix PO18/PO20 | n/r | system-issued follow-up + return precautions after a valid discharge |
| `DISCHARGE-CRITERION-HAEMODYNAMIC-STABILITY-APP004` | clinical_rule | matrix PO12–PO16 | **yes** | approved rule; satisfying patient fact depends on unbuilt recovery calibration → surfaced as `discharge_runtime_fact` limitation |
| `DISCHARGE-CRITERION-PAIN-CONTROLLED-ORAL-APP004` | clinical_rule | matrix PO12 | **yes** | same |
| `DISCHARGE-CRITERION-TOLERATING-ORAL-INTAKE-APP004` | clinical_rule | matrix PO14 | **yes** | same |
| `DISCHARGE-CRITERION-NO-PERSISTENT-VOMITING-APP004` | clinical_rule | matrix PO14 | **yes** | same |
| `DISCHARGE-CRITERION-MOBILE-APP004` | clinical_rule | matrix PO15 | **yes** | same |
| `DISCHARGE-CRITERION-URINARY-FUNCTION-APP004` | clinical_rule | matrix PO16 | **yes** | conditional only; evaluated on modeled retention risk, never a universal gate |

Covering test for A.8 runtime behavior: `app004Remediation.test.js` t39, t40,
"approved discharge criteria stay unavailable when recovery facts are not calibrated";
`coreRuntimeContract.test.js` PBC-19, PBC-24.

---

## B. Anesthesia specialty-review status

`PREOP-ANESTHESIA-REVIEW-APP004` and `PREOP-FASTING-ASSESSMENT-APP004` are
`approved_for_training` under the **Clinical-Lead resident-pilot authorization dated
2026-08-31**, not an anesthesiology specialty sign-off. No object lists an anesthesiologist
in `second_reviewed_by`. Provenance records the evidence sources (`SRC-ASA-FASTING-2023`,
Activation Decisions v1.1 F6), the human surgical review by 2R where applicable, and the
`approval_note`. Governance test
`app004Remediation.test.js` — "anesthesia content does not falsely claim anesthesiologist
review" — guards this.

---

## C. Pending — active APP-004 pilot dependencies (5)

These keep `patientTruthApproved = false`. Each carries a **recorded Clinical Lead decision** from the 2026-08-31 numeric calibration remediation; what remains before promotion is stated in the last column.

| ID | File | 2026-08-31 decision | Remaining before promotion |
| --- | --- | --- | --- |
| `ENV-UNCOMPLICATED-INFLAMMATION` (+ `PROFILE-INFLAMMATORY-MINIMAL`/`-MODERATE`/`-MARKED`) | `disease.yaml` `inflammatory_profiles` | **REVISE** → linked `minimal`/`moderate`/`marked_but_stable` profiles; Clinical Lead verbatim ranges + weights `0.30/0.50/0.20` entered; selection mechanism dormant (`generation_enabled: false`); union envelope is the interim dev-only fallback; guardrail blocks union fallback for `learner_pilot`/`production` once enabled | independent second clinical review; then promote all four + flip `generation_enabled` |
| `PHENOTYPE-RETROCECAL-APP004` | `phenotypes.yaml` `phenotypes.retrocecal` | **APPROVE** 6–24 h + pain 4–8; **REMOVE** extended-window / uncommon-pain-site / partial-US branches; **REVISE** urinalysis 60/20/20, CT free-fluid 70/15/15, psoas 25/75; self-treatment uniform | independent second review of the numeric decisions |
| `CAL-NAUSEA-VOMITING-SELECTION-APP004` | `phenotypes.yaml` `nausea_vomiting_selection_calibration` | **APPROVE** uniform draw as non-epidemiological simulation sampling (`is_epidemiological_estimate: false`) | independent second review |
| `FINDINGS-FASTING-HISTORY` | `findings.yaml` `fasting_history` | **APPROVE** 4–10 h / 1–4 h; **REVISE** add invariant clear-liquid ≤ solid-food; no anaesthesia threshold / delay | independent second (anaesthesia) review |
| `TRJ-POSTOP-RECOVERY` (`post_source_control_course`) | `trajectories.yaml` | **REVISE** → bounded criteria-based model authored (2 windows 6–12 / 12–24 h @ 50/50, qualitative pain states, no per-hour arithmetic, no auto-discharge); **ships dormant** | clinical re-review of the authored model |

`LAB-CHEMISTRY-ANALYTES-APP004` was the sixth blocker and is now in §A (promoted 2026-08-31).

Runtime treatment: each emits `SIMULATOR_LIMITATION_NOTED { kind: "patient_truth" }` from
minute zero; the debrief reports them as *simulator limitation / pilot blocker*
(`app004Remediation.test.js` — "every patient-generation content object is inventoried and
reported as non-approved", "the debrief says plainly that this build is not pilot-ready").

---

## D. Pending — outside APP-004 v1 scope (25, inert for the APP-004 preset)

Listed so no reader mistakes them for approved. Not on the APP-004 generation path.

`analgesia_paracetamol_oral/iv`, `analgesia_ketoprofen_im/iv`, `analgesia_ketorolac_im/iv`,
`fluid_crystalloid` (`EFFECT-*`) — numeric response/effect envelopes, deliberately
unreviewed (§11); `MED-KETOROLAC-PENDING`; `PROFILE-INFLAMMATORY-MINIMAL/MODERATE/MARKED`;
`PHENOTYPE-CLASSIC`, `PHENOTYPE-EARLY-SUBTLE-V35`, `PHENOTYPE-PELVIC-V35`,
`PHENOTYPE-LATE-COMPLICATED-V35`; `ENV-DIFFUSE-PERITONITIS-V35`;
`TRJ-SERIAL-EVOLUTION`, `TRJ-SEPTIC-SHOCK`; `HISTORY-REPRODUCTIVE-AGE-FEMALE`
(APP-004 excludes pregnancy); `DEMOGRAPHICS-APP002-V35`; the six `CONTENT-*-APPENDICITIS`
file-level rollup provenances (bundle-file headers, not runtime objects).

Complication branches — spontaneous perforation, abscess, phlegmon, diffuse peritonitis,
sepsis, SSI, death — are **not present as active transitions** for APP-004 v1 and no hourly
perforation probability exists (§5).

---

## E. Governance test coverage

- exact allow-list of `approved_for_training` APP-004 IDs — `app004Remediation.test.js`
- exact list of remaining pending active/development objects — same
- every approved object has reviewer / date / source metadata —
  `app004Remediation.test.js` "every promoted content object carries real review
  provenance"; `buildContentIndex.mjs` `validateProvenance`
- anesthesia content does not falsely claim anesthesiologist review — `app004Remediation.test.js`
- Reference Hospital no longer runs KZ preop requirements as operative prerequisites; KZ
  Real Hospital still does; Reference + `jurisdictionContext=KZ` produces a teaching note
  without blocking — `app004Remediation.test.js` t29/t30

---

## F. 2026-09-01 update — independent second review applied

Full detail: `docs/review/APP004_FINAL_SECOND_REVIEW_PACKET_2026-09-01.md` §6–§10;
`docs/review/APP004_POSTOP_CLOCK_ANCHOR_REREVIEW_2026-09-01.md`.

**Moved from §C (pending) to §A (approved_for_training), with `second_reviewed_by:
["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]`, `second_reviewed_at:
"2026-09-01"`:**

| ID | File |
| --- | --- |
| `PROFILE-INFLAMMATORY-MINIMAL` | `disease.yaml` |
| `PROFILE-INFLAMMATORY-MODERATE` | `disease.yaml` |
| `PROFILE-INFLAMMATORY-MARKED` | `disease.yaml` |
| `PHENOTYPE-RETROCECAL-APP004` | `phenotypes.yaml` |
| `CAL-NAUSEA-VOMITING-SELECTION-APP004` | `phenotypes.yaml` |
| `FINDINGS-FASTING-HISTORY` | `findings.yaml` |

`inflammatory_profiles.selection.generation_enabled` is now `true` — the active APP-004
generation path; the guardrail (`evaluateInflammatoryCalibrationForPilot` /
`selectInflammatoryProfile`) fails closed rather than falling back to the union envelope.

**Still `pending` (§C), unchanged status:**

| ID | Why |
| --- | --- |
| `ENV-UNCOMPLICATED-INFLAMMATION` (legacy union envelope) | Never itself given a Clinical Lead first review (`reviewed_by: null`); the second reviewer's comment addressed the profile ranges, not this object. Retained only for internal development / replay compatibility / audit history — no longer read for `learner_pilot` / `production` generation. |
| `TRJ-POSTOP-RECOVERY` | REVISE — recovery-clock anchor (`SOURCE_CONTROL_COMPLETED`) fixed in code to `PROCEDURE_COMPLETED`; awaiting the focused re-review of that fix alone. No other part of the authored model changed. |

**Runtime consequence, verified 2026-09-01:** `inventoryPatientTruth` blocks exactly 2 objects
(`uncomplicated_inflammation`, `post_source_control_course`); `patientTruthApproved` stays
`false`; `case_presets[APP-004].runtime_status` stays `development_only`; a `learner_pilot`
session for APP-004 is still rejected (`preset_not_learner_enabled`). Pilot gate stays
`NO_GO_FOR_RESIDENT_PILOT`. 307/307 tests, 4/4 Playwright, clean lint.

---

## G. 2026-09-01 governance correction — inventory made purpose/route aware

`inventoryPatientTruth` (`src/core/patient/patientTruthGovernance.js`) previously counted the
legacy union envelope (`ENV-UNCOMPLICATED-INFLAMMATION`) as required patient-truth approval for
**every** session purpose, including `learner_pilot` / `production` — even though
`patientGenerator.js` never reaches that envelope on those routes once the linked profiles are
active (§F): it fails closed instead of falling back. That double-counted a real blocker.

`inventoryPatientTruth` now takes an optional `sessionPurpose` and, for `learner_pilot` /
`production` only, inventories the **active linked-profile mechanism**
(`evaluateInflammatoryCalibrationForPilot`) in place of the envelope. `internal_development` /
`faculty_preview` (and any call that omits `sessionPurpose`, for backward compatibility) are
unaffected — the envelope stays inventoried there, since its fallback path remains reachable for
those purposes.

**Blocker count by route, verified 2026-09-01:**

| `sessionPurpose` | Blocked | Note |
| --- | --- | --- |
| `internal_development` (or omitted) | `uncomplicated_inflammation`, `post_source_control_course` | unchanged from §F |
| `faculty_preview` | `uncomplicated_inflammation`, `post_source_control_course` | unchanged from §F |
| `learner_pilot` | `post_source_control_course` **only** | envelope no longer counted |
| `production` | `post_source_control_course` **only** | envelope no longer counted |

The legacy envelope's clinical values and `review_status` (`pending`) are **unchanged** — this is
a governance/inventory-routing fix, not a promotion. It is not, and must not be, promoted to
`approved_for_training`; it stays retained for internal-development / replay / audit compatibility
only. `patientTruthApproved` still evaluates `internal_development` behavior for the actual current
build (the session that runs today), so it is still `false`; `runtime_status` stays
`development_only`; the pilot gate stays `NO_GO_FOR_RESIDENT_PILOT`. **The only patient-truth
object that would block a hypothetical `learner_pilot` APP-004 session today is
`TRJ-POSTOP-RECOVERY`.** 310/310 tests, 4/4 Playwright, clean lint.
