# APP-004 Clinical Activation — Completion Report

**Date:** 2026-08-31
**Task:** `CLAUDE_CODE_TASK_ONQOL_APP004_CLINICAL_ACTIVATION_v1.0_2026-08-31`
**Repository baseline:** `feat/onqol-vnext-clean-core` @ `755cbf4`
**Compiled content version:** `20b1c6fc188564c9`
**Clinical authority set:** `APP004_CLINICAL_ACTIVATION_DECISIONS_v1.1_2026-08-31`, `APP-004 — Second Clinical Review` (Sarina T.T., General Surgery / Surgical Oncology, NROC, 2026-08-31), current product contracts under `docs/contracts/`.

---

## 1. Executive status

### `NO_GO_FOR_RESIDENT_PILOT`

The clinical review closed the qualitative APP-004 backlog: reviewed rules, medication
identity/dose/route/safety, perioperative workflow, Reference/KZ separation, VTE logic and
functional discharge criteria are now versioned runtime authority with named reviewers and
dates. **The pilot gate still fails on one class of blocker: numeric patient-truth
calibration that no supplied signed review contains.** Six patient-generation objects that
APP-004 actively depends on remain `pending`, so `patientTruthApproved` is `false` and the
strict session-purpose gate refuses a `learner_pilot` session.

This is the outcome the task anticipated (§4, §26, §32): "This task may close many clinical
blockers and still return `NO_GO_FOR_RESIDENT_PILOT` if this numeric patient-truth blocker
remains." No unsourced range was promoted to obtain a `GO`.

---

## 2. Approved objects

**45 content objects** carry `review_status: approved_for_training` with real reviewer
identity, review date and source IDs. Full table with source IDs, scope, runtime effect and
covering tests: [`docs/review/APP004_CLINICAL_APPROVAL_MANIFEST_2026-08-31.md`](review/APP004_CLINICAL_APPROVAL_MANIFEST_2026-08-31.md)
and its machine-readable companion `APP004_CLINICAL_APPROVAL_MANIFEST_2026-08-31.json`.

| Group | IDs |
| --- | --- |
| Patient truth (qualitative) | `DEMOGRAPHICS-APP-BASE-ADULT`, `SYMPTOM-NAUSEA-VOMITING-COHERENCE`, `PHENOTYPE-RETROCECAL-APP004-QUALITATIVE`, `FINDINGS-HISTORY-BUNDLE`, `FINDINGS-UNIVERSAL-NORMAL-LAYER`, `TRJ-STABLE` |
| Perioperative rules | `RULE-CONSENT-BEFORE-PROCEDURE`, `RULE-DELAY-BEYOND-24H-UNCOMPLICATED`, `RULE-CEFAZOLIN-PROPHYLAXIS-DOSE`, `RULE-CEFAZOLIN-REQUIRES-ANAEROBIC-COVERAGE`, `RULE-ROUTINE-DRAIN-UNCOMPLICATED`, `RULE-NO-ROUTINE-POSTOP-ANTIBIOTICS-UNCOMPLICATED`, `RULE-LAPAROSCOPIC-PREFERRED-WHEN-AVAILABLE` |
| Preop workflow items | `PREOP-CONSENT-APP004`, `PREOP-IV-ACCESS-APP004`, `PREOP-ANTIBIOTIC-PROPHYLAXIS-APP004`, `PREOP-ANESTHESIA-REVIEW-APP004`, `PREOP-FASTING-ASSESSMENT-APP004` |
| KZ jurisdictional workflow | `PREOP-KZ-ABO-RH-APP004`, `PREOP-KZ-CBC-APP004`, `PREOP-KZ-COAGULATION-APP004` |
| Antibiotic prophylaxis policy | `ABX-PROPHYLAXIS-APP004-PILOT` |
| VTE | `PREOP-VTE-ASSESSMENT` |
| Discharge | `DISCHARGE-CRITERIA-APP004`, `DISCHARGE-BUNDLE-APP004`, `DISCHARGE-CRITERION-HAEMODYNAMIC-STABILITY-APP004`, `DISCHARGE-CRITERION-PAIN-CONTROLLED-ORAL-APP004`, `DISCHARGE-CRITERION-TOLERATING-ORAL-INTAKE-APP004`, `DISCHARGE-CRITERION-NO-PERSISTENT-VOMITING-APP004`, `DISCHARGE-CRITERION-MOBILE-APP004`, `DISCHARGE-CRITERION-URINARY-FUNCTION-APP004` |
| Shared medication identity / dose / route / safety | `MED-CEFAZOLIN-PILOT`, `MED-METRONIDAZOLE-PILOT`, `MED-CEFOXITIN-PILOT`, `MED-CEFOTETAN-PILOT`, `MED-CLINDAMYCIN-PILOT`, `MED-AZTREONAM-PILOT`, `MED-GENTAMICIN-PILOT`, `MED-PARACETAMOL-PILOT`, `MED-IBUPROFEN-PILOT`, `MED-TRAMADOL-PILOT`, `MED-METAMIZOLE-KZ-PILOT`, `MED-KETOPROFEN-KZ-PILOT`, `MED-ENOXAPARIN-VTE-PILOT`, `MED-NSAID-SUITABILITY-CHECKS` |

Second review by Sarina T.T. is recorded on the objects that require it (consent/procedure
rule, antibiotic prophylaxis policy and preop item, discharge criteria, delay rule).

---

## 3. Remaining pending objects

APP-004 pilot generation actively depends on these **6** unreviewed objects. Each is a
numeric calibration absent from the supplied signed review; none was promoted (§4, §25, §32).

| ID | File | What it calibrates | Why still blocked |
| --- | --- | --- | --- |
| `ENV-UNCOMPLICATED-INFLAMMATION` | `src/content/diseases/appendicitis/disease.yaml` | baseline HR/T/RR/WBC/neutrophils/CRP ranges | development-only, unsourced; named in task §4 as not-to-promote |
| `PHENOTYPE-RETROCECAL-APP004` | `src/content/diseases/appendicitis/phenotypes.yaml` | symptom-duration, pain-score, US/CT numeric truth of the raw phenotype | qualitative split (`…-QUALITATIVE`) is approved; the mixed object still holds unreviewed numbers |
| `CAL-NAUSEA-VOMITING-SELECTION-APP004` | `src/content/diseases/appendicitis/phenotypes.yaml` | relative frequency of nausea/vomiting variants | invented frequency, not in signed review (§4) |
| `FINDINGS-FASTING-HISTORY` | `src/content/diseases/appendicitis/findings.yaml` | seeded last-solid / last-liquid interval values | numeric intervals not in signed review |
| `TRJ-POSTOP-RECOVERY` (`post_source_control_course`) | `src/content/diseases/appendicitis/trajectories.yaml` | postoperative recovery milestone timing / vitals | no reviewed recovery calibration (§17) |
| `LAB-CHEMISTRY-ANALYTES-APP004` | `src/content/diseases/appendicitis/trajectories.yaml` | biochemistry result values | numeric lab truth not in signed review |

A further 25 objects are `pending` or `development_only` but are **out of APP-004 v1 scope**
(other phenotypes, complicated/septic trajectories, analgesic response envelopes, ketorolac,
V35 legacy demographics/envelopes). They are inert for the APP-004 preset and listed in the
manifest so no reader can mistake them for approved.

---

## 4. Patient-truth gate result

`inventoryPatientTruth({ bundle, casePresetId: "APP-004" })` → `approved: false`.

- 6 blocked entries, each emitted as `SIMULATOR_LIMITATION_NOTED { kind: "patient_truth" }`
  from minute zero of every session.
- `createSession` stamps `state.session.patientTruthApproved = false`; the debrief repeats
  `contentGovernance.pilotReady = false` with the RU note "не предназначен для пилота".
- `evaluateSessionAudience({ sessionPurpose: "learner_pilot", … })` →
  `rejection("patient_truth_not_approved")`.
- The gate was not weakened and no object was whitelisted (§26).

---

## 5. Anesthesia note

- The anesthesia / NPO / aspiration workflow rules **are used in this APP-004 resident
  pilot** under the explicit Clinical-Lead authorization dated 2026-08-31 (§2.2, §13).
- **Independent anesthesiology specialty review remains pending.** No object records an
  anesthesiologist as `second_reviewed_by`.
- `PREOP-ANESTHESIA-REVIEW-APP004` and `PREOP-FASTING-ASSESSMENT-APP004` carry an
  `approval_note` stating resident-pilot authorization and that no anesthesia drug or
  airway-parameter teaching is authorized by the exception.
- No induction drug, RSI medication, airway parameter or fasting-countdown deadlock was
  added. `fasting_assessment.blocking = false`. Anesthesia review is a route/readiness
  requirement: with no review recorded, the operative transition returns
  `PREOP_NOT_READY` (missing `anesthesia_review`) — not patient deterioration, not L4.
- No global governance bypass was created.

---

## 6. Reference vs KZ behavior after the fix

- `REFERENCE_HOSPITAL_PROFILE.jurisdiction` is now `null` (was `"KZ"`). Reference Hospital
  is contemporary evidence-based care under adequate resources and does **not** run the KZ
  ABO/Rh, CBC or coagulation items as operative prerequisites.
- `KZ-R1-DISTRICT`, `KZ-R2-URBAN`, `KZ-R3-TERTIARY` keep `jurisdiction: "KZ"`; the three KZ
  preop items (`jurisdiction: "KZ"`, `blocking: false`) apply there and are caught up by
  staff if omitted, with the omission recorded as `jurisdictional_workflow_omission`.
- A new session-level `jurisdictionContext` ("KZ") is a **teaching overlay**, not a third
  hospital mode. In Reference Hospital with `jurisdictionContext = "KZ"`, the debrief emits
  a `jurisdiction_workflow_note` for an omitted KZ item, explicitly worded as a KZ
  workflow/regulatory requirement and "не универсальное требование evidence-based маршрута",
  without blocking the route.
- Covered by `app004Remediation.test.js` tests 29–30 and the reference/KZ separation cases
  in `coreRuntimeContract.test.js`.

---

## 7. Antibiotic regimens actually active

Policy object `ABX-PROPHYLAXIS-APP004-PILOT`; window = begin within **60 min before
incision**; completion derived only from a validated complete regimen inside that window.

| Regimen | Components | Redose |
| --- | --- | --- |
| Preferred | cefazolin 2 g IV (3 g if modeled weight ≥ 120 kg) + metronidazole 500 mg IV | cefazolin q4h; metronidazole none for ordinary duration |
| Alternative | cefoxitin 2 g IV | q2h |
| Alternative | cefotetan 2 g IV | q6h |
| Severe β-lactam allergy | clindamycin 900 mg IV + aztreonam 2 g IV | q6h / q4h |
| Severe β-lactam allergy | metronidazole 500 mg IV + gentamicin 5 mg/kg IV | single dose |

- **Cefazolin alone is not accepted** as complete appendectomy prophylaxis
  (`RULE-CEFAZOLIN-REQUIRES-ANAEROBIC-COVERAGE`); the learner is asked for anaerobic
  cover and can correct without patient deterioration.
- Cefoxitin / cefotetan availability in Real KZ hospitals comes from the formulary/resource
  profile, not the guideline.
- `RULE-NO-ROUTINE-POSTOP-ANTIBIOTICS-UNCOMPLICATED` active; the system administers no
  postoperative antibiotic (`app004Remediation.test.js` test 24).

---

## 8. Analgesic formulary actually active

Identity, dose, route and safety gates are approved (`MED-*-PILOT`); **numeric response
envelopes are not** (see §11 of the task and pending list).

| Drug | Approved order shape | Key gates |
| --- | --- | --- |
| Paracetamol | 1 g PO preferred / IV if no oral route, q6h, max 4 g/24 h | hepatic disease, heavy alcohol, low weight/malnutrition |
| Ibuprofen | 400 mg PO q6–8h, max 2.4 g/day | AKI/advanced renal, active PUD/GI bleed, NSAID hypersensitivity/AERD, major bleeding risk, decompensated HF, pregnancy (scoped, outside APP-004 v1) |
| Tramadol | rescue only, 50 mg then 50–100 mg PO/slow IV q6h PRN, pilot max 400 mg/24 h | sedation/resp depression, uncontrolled epilepsy, MAOI ≤ 14 d, serotonergic interaction, CNS-depressant intoxication, renal/hepatic adjustment |
| Metamizole | KZ/formulary-aware alternative, 500–1000 mg PO/IV q6–8h, max 4 g/day | pyrazolone allergy, prior agranulocytosis/marrow suppression |
| Ketoprofen | KZ alternative, 100 mg IM q12h, max 200 mg/day | generic `100 mg IV bolus` **not** accepted — IV only with a specifically reviewed IV formulation in the active formulary |

- No automatic diphenhydramine bundling with metamizole or any analgesic.
- Ketorolac remains **pending** (`MED-KETOROLAC-PENDING`) — not approved in the supplied
  human review.
- No fixed `pain -3` delta anywhere (`app004Remediation.test.js` test 19).

---

## 9. VTE rules actually active

`PREOP-VTE-ASSESSMENT`, method **Caprini**, `accepts_any_appropriate_plan: true`.

| Caprini | Accepted |
| --- | --- |
| 0 | early ambulation |
| 1–2 | IPC preferred |
| 3–4 | IPC **or** LMWH **or** low-dose UFH (if bleeding risk not high) |
| ≥ 5 | pharmacologic prophylaxis expected unless contraindicated; add mechanical where appropriate |

- Pilot LMWH option: enoxaparin 40 mg SC once daily, first dose after adequate hemostasis
  for this short laparoscopic case; only when renal function is compatible and bleeding
  risk permits. No renal-adjustment dose invented.
- No universal `RULE-LMWH-REQUIRED`.
- Live mentor correction for: therapeutic-dose anticoagulation by mistake; pharmacologic
  VTE prophylaxis during active major bleeding; no strategy at all at Caprini ≥ 5 without
  rationale. IPC-vs-LMWH at 3–4 is a debrief note, not a hard failure.

---

## 10. Discharge criteria actually active

`DISCHARGE-CRITERIA-APP004` — functional criteria, no arbitrary threshold:

- operation/source control complete; recovered from anesthesia; hemodynamic + respiratory
  status stable; no active deterioration; pain manageable on an oral plan; nausea/vomiting
  controlled enough for oral intake; adequate oral intake for the individual; safe
  mobilization; no ongoing need for repeated IV rescue or another inpatient indication;
  discharge instructions, return precautions and follow-up provided.
- Explicitly **not** required: 24 h admission, next-day CBC, stool/flatus, pain ≤ 3,
  universal spontaneous urination (checked only on modeled retention risk).
- Same-day / next-day discharge is reachable; the system emits the reviewed discharge
  bundle (follow-up + return precautions) after a valid decision.
- The 5 clinical readiness criteria are approved rules whose satisfying **patient fact**
  depends on the unbuilt recovery calibration; at discharge they surface as
  `SIMULATOR_LIMITATION_NOTED { kind: "discharge_runtime_fact",
  reviewStatus: "approved_rule_unmeasured_patient_fact" }` rather than an invented cutoff
  (`app004Remediation.test.js` "approved discharge criteria stay unavailable…").

---

## 11. Safety-gate classification

Route/readiness, medication-order validation and Level-4 are kept strictly apart (§19).

**Route / readiness blockers** (route/preop state machine, not L4):
`no consent`, `no functioning IV before general anesthesia`, `no anesthesia review`,
`no antibiotic prophylaxis at attempted incision`, clinically significant instability
requiring reassessment before induction. Behavior: `PREOP_NOT_READY` → learner corrects →
route resumes. No artificial patient collapse.

**Medication-order validation gates** (reject/clarify an order; not a catastrophic event):
known severe drug allergy, dose outside the approved pilot regimen, NSAID in a reviewed
major contraindication, pharmacologic VTE prophylaxis during active major bleeding.
Classification uses `reviewed_safe` / `reviewed_questionable` / `reviewed_unsafe`
(`src/core/rules/medicationOrderValidation.js`). One milligram past a pilot maximum is an
order-validation boundary, not an instantaneous toxicity threshold.

**True Level-4:**

```
No new APP-004 Level-4 rule added in this activation.
```

After separating route/readiness and order validation, none of the reviewed APP-004 actions
meets the existing catastrophic-action threshold. This is acceptable per §19.3.

---

## 12. Verification results

All commands run from a clean working tree on `20b1c6fc188564c9`.

| Command | Result |
| --- | --- |
| `npm run content:check` | **OK** — appendicitis + shared/{actions,examinations,interaction,investigations,medications,perioperative,resources} |
| `npm test` | **292 / 292 pass**, 0 fail, 0 skipped |
| `npm run wave2:corpus` | **OK** — 52 semantic fixtures → `docs/evidence/WAVE2_SHADOW_CORPUS_METRICS_2026-08-28.json` |
| `npm run lint` | **clean** (0 problems) |
| `npm run build` | **OK** — content bundle + `vite build` (74 modules, dist written) |
| `npm run wave23:freeze:check` | **OK** — `docs/evidence/WAVE23_FREEZE_MANIFEST_2026-08-29.json`, no contract file changed |
| `npm run test:e2e` | **4 / 4 passed** (Playwright) |
| `npm run pack:safe` | **OK** — `dist-pack/onqol-vnext-source.zip`, 277 entries, 2.59 MB, 0 forbidden paths |

`npm run wave23:bakeoff` was **not** run (provider budget not restored, per §28).

### Freeze note

The pre-existing working tree had extended two Wave 2.3-frozen contract files
(`src/ai/interpreter/deterministicParameterBinder.js`,
`src/ai/interpreter/modelConceptValidation.js`) to add `doseMgPerKg` and an `sc` route.
Those files feed only `runSplitSemanticShadow`, which has **no runtime or clinical
authority** ("Shadow output has no authority … never awaited by the clinical path"). They
were reverted to their frozen state to restore `wave23:freeze:check`. The equivalent
deterministic runtime support for `п/к`/`sc` and `мг/кг`/`doseMgPerKg` already exists in the
authoritative `src/ai/interpreter/deterministicInterpreter.js`, so the enoxaparin-SC and
gentamicin-per-kg regimens remain expressible on the real path.

### Change made in this session

- `src/content/diseases/appendicitis/operative.yaml` — removed redundant bare
  `review_status` / `second_review_required` keys from the 8 `preop_requirements` items;
  `provenance` (with full reviewer metadata) is the single source of truth, matching every
  other content object.
- `src/content/diseases/appendicitis/complications.yaml` — the 6 clinical
  `discharge_criteria` items now carry an anchored `provenance` block with reviewer
  identity/date instead of a bare `review_status`.
- `src/core/rules/medicationOrderValidation.js` — dropped an unused `state` parameter
  (lint).
- `scripts/smokeApp004.mjs` — corrected resident reassessment phrasing so timed
  reassessment turns bind a target and the scripted Journey A reaches discharge.
- Wave 2.3 frozen-file revert described above.

---

## 13. Manual journey results

Deterministic scripted run via `node scripts/smokeApp004.mjs`
(seed `app004-post-review-smoke`, Reference Hospital), replay at
[`docs/evidence/APP004_POST_REVIEW_SMOKE_REPLAY.json`](evidence/APP004_POST_REVIEW_SMOKE_REPLAY.json).

| Journey | Coverage | Result |
| --- | --- | --- |
| **A — competent Reference path** | assess → history/exam → CT without prior US → working diagnosis → analgesia → laparoscopy → cefazolin + metronidazole → consent → anesthesia review → appendectomy → uncomplicated recovery → oral intake → discharge | **PASS** — `PATIENT_DISCHARGED` at 700 min, 28 turns; no false KZ prerequisite block, no invented complication, no unnecessary mentor interrogation; postop pain surfaced as a simulator limitation; discharge issued the reviewed return-precautions bundle |
| **B — KZ teaching difference** | Reference + `jurisdictionContext = "KZ"`, ABO/Rh or coagulation omitted | **PASS** — `app004Remediation.test.js` tests 29–30: route not blocked; debrief emits `jurisdiction_workflow_note` worded as a KZ requirement, explicitly not universal EBM |
| **C — recent meal** | last-solid 10 h / last-liquid 2 h seeded and obtainable | **PASS** — fasting history recognized (`test 28`), `fasting_assessment.blocking = false`, no 6/8 h countdown, surgery proceeds |
| **D — incomplete prophylaxis** | cefazolin alone | **PASS** — `RULE-CEFAZOLIN-REQUIRES-ANAEROBIC-COVERAGE`: not counted complete, focused clarification, correctable by adding anaerobic cover; no patient deterioration |
| **E — suboptimal but defensible** | open approach where laparoscopy available; IPC instead of LMWH at Caprini 3–4 | **PASS** — `app004Remediation.test.js` tests 34, 36: rationale requested, no catastrophic block; drain "не ставлю" not recorded as drain placement (`test 35`) |

The smoke replay also exercises a nondiagnostic ultrasound (not rendered as a negative
study) and staff catch-up of the omitted KZ ABO/Rh + coagulation items.

---

## 14. Wave 2.3 status

Unchanged and still blocked / shadow-only:

```
Action: REJECT
Reasoning: REJECT
Contextual Mentor Answer: SHADOW_ONLY
```

`wave23:freeze:check` passes. No model interpretation was promoted to clinical or runtime
authority in this task. No holdout or safety gold labels were exposed.

---

## 15. Clean archive

- Path: `dist-pack/onqol-vnext-source.zip`
- Size: 2.59 MB
- Entries: 277, forbidden paths: 0
- Produced by `npm run pack:safe` on content version `20b1c6fc188564c9`.

Not committed, pushed, deployed or published.

---

## 16. Remaining pilot blockers (exact)

`patientTruthApproved = false` until every object below reaches
`approved_for_training` with a real numeric-calibration review. None can be closed from the
supplied signed review or approved content.

| # | Content / rule ID | File |
| --- | --- | --- |
| 1 | `ENV-UNCOMPLICATED-INFLAMMATION` | `src/content/diseases/appendicitis/disease.yaml` |
| 2 | `PHENOTYPE-RETROCECAL-APP004` (numeric remainder of the mixed object) | `src/content/diseases/appendicitis/phenotypes.yaml` |
| 3 | `CAL-NAUSEA-VOMITING-SELECTION-APP004` | `src/content/diseases/appendicitis/phenotypes.yaml` |
| 4 | `FINDINGS-FASTING-HISTORY` | `src/content/diseases/appendicitis/findings.yaml` |
| 5 | `TRJ-POSTOP-RECOVERY` (`post_source_control_course`) | `src/content/diseases/appendicitis/trajectories.yaml` |
| 6 | `LAB-CHEMISTRY-ANALYTES-APP004` | `src/content/diseases/appendicitis/trajectories.yaml` |

APP-004 is **not** clinically complete: active patient truth remains unreviewed.

---

## 17. UPDATE — 2026-09-01: blocker count 6 → 2

`LAB-CHEMISTRY-ANALYTES-APP004` (#6) was already promoted later on 2026-08-31 (see
`docs/review/APP004_CLINICAL_APPROVAL_MANIFEST_2026-08-31.md`). On 2026-09-01 the outstanding
independent second review arrived (`Second Clinical Reviewer Decision.md`, Sarina T.T.) and
APPROVED blockers #1, #2, #3, #4 above, now `approved_for_training` with recorded
`second_reviewed_by`/`second_reviewed_at: "2026-09-01"`. Blocker #5 (`TRJ-POSTOP-RECOVERY`) was
REVISED — its recovery-clock anchor (`SOURCE_CONTROL_COMPLETED`) was fixed in code to
`PROCEDURE_COMPLETED`, but the object stays `pending` awaiting a focused re-review of that fix
alone.

**Remaining pilot blockers, 2026-09-01 (2):**

| # | Content / rule ID | File | Status |
| --- | --- | --- | --- |
| 1 | `ENV-UNCOMPLICATED-INFLAMMATION` (legacy union envelope) | `disease.yaml` | `pending` — never itself Clinical-Lead first-reviewed; superseded by the now-approved linked profiles; retained for internal development / replay / audit only |
| 2 | `TRJ-POSTOP-RECOVERY` (`post_source_control_course`) | `trajectories.yaml` | `pending` — awaiting focused clock-anchor re-review |

`patientTruthApproved` stays `false`. `case_presets[APP-004].runtime_status` stays
`development_only` (not promoted). Pilot gate stays `NO_GO_FOR_RESIDENT_PILOT`. Full detail:
`docs/review/APP004_FINAL_SECOND_REVIEW_PACKET_2026-09-01.md`,
`docs/review/APP004_POSTOP_CLOCK_ANCHOR_REREVIEW_2026-09-01.md`.

## 18. UPDATE — 2026-09-01: governance correction, blocker #1 does not apply to the learner_pilot route

`inventoryPatientTruth` (`src/core/patient/patientTruthGovernance.js`) counted blocker #1 above
(the legacy union envelope) as required patient-truth approval for every session purpose,
including `learner_pilot` / `production` — but `patientGenerator.js` never reaches that envelope
on those routes once the linked profiles are active; it fails closed instead of falling back
(§17). That double-counted a real blocker. The inventory now takes an optional `sessionPurpose`
and, for `learner_pilot` / `production` only, inventories the active linked-profile mechanism in
its place. `internal_development` / `faculty_preview` are unaffected — blocker #1 still applies
there, since the envelope's fallback path remains reachable for those purposes. See
`docs/review/APP004_CLINICAL_APPROVAL_MANIFEST_2026-08-31.md` §G for the full detail and
per-route verification.

**Remaining pilot blockers by route, 2026-09-01:**

| Route | Blockers |
| --- | --- |
| `internal_development` / `faculty_preview` | `ENV-UNCOMPLICATED-INFLAMMATION`, `TRJ-POSTOP-RECOVERY` (2) |
| `learner_pilot` / `production` | `TRJ-POSTOP-RECOVERY` only (1) |

The envelope's clinical values and `review_status` (`pending`) are unchanged — this is a
governance/inventory-routing correction, not a promotion. `patientTruthApproved` for the actual
build that runs today (`internal_development`) stays `false`. `runtime_status` stays
`development_only`; the pilot gate stays `NO_GO_FOR_RESIDENT_PILOT`. 310/310 tests, 4/4
Playwright, clean lint.
