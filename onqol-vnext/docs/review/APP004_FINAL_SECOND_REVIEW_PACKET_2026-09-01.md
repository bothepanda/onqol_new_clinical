# APP-004 Final Second-Review Packet

**Date prepared:** 2026-09-01
**Prepared by:** Claude Code, at the request of Botagoz Kaukenova — Clinical Lead
**Nature of this document:** originally prepared as REVIEW PREPARATION ONLY (read-only extraction, no changes). It was **updated on 2026-09-01, same day**, to record the actual independent second-review decisions received (`Second Clinical Reviewer Decision.md`) and the remediation applied as a direct consequence: four objects promoted to `approved_for_training` with recorded second-review provenance; the postoperative recovery model's clock-anchor bug fixed in code and left `pending` awaiting a focused re-review. §§2–9 below are the original preparation; §6, §7, §8, §9 and §10 record what the second reviewer actually decided and what was done about it. `runtime_status` and `patientTruthApproved` remain unchanged (`development_only` / `false`).

---

## 1. Purpose

- Engineering remediation of the six APP-004 numeric/calibration blockers is **complete**. The revised or newly authored content is in the repository, covered by regression tests, and the compiled content bundle matches it.
- **At preparation time, all five objects in this packet were `review_status: pending`.** (A sixth blocker, `LAB-CHEMISTRY-ANALYTES-APP004`, was already promoted to `approved_for_training` on 2026-08-31 and is not part of this review.) **After the second review recorded 2026-09-01, four of the five are now `approved_for_training`; the fifth (postoperative recovery model) stays `pending` — see §6–§10.**
- **This review is required before any of these five pending objects can be promoted to `approved_for_training`.** Nothing here is promoted by being listed.
- **This is a review of the FINAL post-remediation content** — the specific values, weights, removed branches and authored model described below — **not** a re-run of the earlier `docs/review/APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25` qualitative review or the `docs/review/APP004_NUMERIC_CALIBRATION_REVIEW_2026-08-31.md` preparation document. Those approved the *concepts and qualitative wording*; this packet asks the second reviewer to approve (or revise/reject) the *specific numbers, weights, and the authored postoperative model* that now implement those concepts.
- The reviewer must record an explicit **APPROVE / REVISE / REJECT** for each of the five objects below. **No approval is implied by an object's inclusion in this packet, by its prior Clinical Lead sign-off, or by its passing regression tests.**

**Second reviewer:** Sarina T.T.
**Specialty:** General Surgery / Surgical Oncology, NROC
**Review date:** 2026-09-01
**Decision artifact:** `Second Clinical Reviewer Decision.md` (supplied by Botagoz Kaukenova — Clinical Lead, 2026-09-01)
**Overall decision recorded:** APPROVE WITH LISTED REVISION — four objects APPROVE, one (postoperative recovery model) REVISE on the recovery-clock anchor only. Remediation of the REVISE item is recorded in §6 and in `docs/review/APP004_POSTOP_CLOCK_ANCHOR_REREVIEW_2026-09-01.md`.

---

## 2. ENV + inflammatory profiles

**Source:** `src/content/diseases/appendicitis/disease.yaml`, block `inflammatory_profiles`, lines **208–296** (three profiles + `selection`); the legacy union envelope this replaces is `physiology_envelopes.uncomplicated_inflammation`, lines **116–144** (unchanged, still `pending`, still the active development fallback).
**Current `review_status` of all four objects (ENV + 3 profiles):** `pending`. `reviewed_by: ["Botagoz Kaukenova — Clinical Lead"]` is recorded on each; `second_reviewed_by: null` on each.

| Profile | HR (/min) | Temp (°C) | Systolic BP (mmHg) | RR (/min) | WBC (×10⁹/L) | Neutrophils (%) | CRP (mg/L) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `minimal` | 72–90 | 36.6–37.5 | 105–140 | 14–18 | 8.0–11.5 | 65–78 | 2–25 |
| `moderate` | 80–98 | 37.0–38.0 | 105–140 | 14–20 | 10.5–14.5 | 72–85 | 10–60 |
| `marked_but_stable` | 90–104 | 37.5–38.2 | 100–135 | 16–21 | 13.0–16.5 | 80–90 | 40–100 |

**Selection weights:** minimal 30 % · moderate 50 % · marked_but_stable 20 %.

**How this works, in plain terms:**
- Exactly **one profile is selected per patient**; all seven physiology/laboratory fields for that patient are then drawn from that **same** profile. Profiles are **never mixed** within one patient.
- Sampling inside each range is **centred** (biased toward the middle; the extremes are possible but uncommon), the same method used elsewhere in APP-004 physiology generation.
- **Profile membership is hidden generation truth** — it is never disclosed to the learner, directly or indirectly.
- Profile membership **does not determine** diagnosis, disease severity classification, management plan, operative indication, or any safety-authority state. It only supplies the numeric physiology/lab values.
- The 30/50/20 selection weights are **simulation-diversity configuration only** — they are explicitly not presented anywhere as an epidemiological prevalence estimate of how often real uncomplicated appendicitis patients present at each inflammatory intensity.
- **The old union envelope cannot be used for learner-pilot patient generation once the profile path is activated.** A `learner_pilot` / `production` session now runs a dedicated check (`evaluateInflammatoryCalibrationForPilot`, `src/core/patient/patientTruthGovernance.js`) before generating a patient, and the generator itself (`selectInflammatoryProfile`, `src/core/patient/patientGenerator.js`) throws rather than silently falling back to the union envelope if any profile in the selection order is missing, incomplete, or not `approved_for_training`. Today this mechanism is switched off (`selection.generation_enabled: false`), so generation still uses the union envelope for internal development/faculty preview only.

**Reviewer decision:**
- [x] APPROVE
- [ ] REVISE: _______________________________
- [ ] REJECT

**Reviewer comment:** "Numeric ranges are clinically plausible for stable uncomplicated appendicitis. The upper `marked_but_stable` ranges appropriately overlap with values that may increase suspicion for complicated disease but do not independently establish complicated appendicitis. Selection weights are approved as simulation/curriculum calibration only, not epidemiological prevalence."

**Post-approval remediation (2026-09-01):** the three `PROFILE-INFLAMMATORY-*` objects (`disease.yaml`) are now `review_status: approved_for_training` with `second_reviewed_by: ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]`, `second_reviewed_at: "2026-09-01"`. `inflammatory_profiles.selection.generation_enabled` is now `true` — this is the active APP-004 generation path; `evaluateInflammatoryCalibrationForPilot` / `selectInflammatoryProfile` fail closed (throw) if any profile in the selection order is missing, incomplete, or not approved, rather than falling back to the union envelope. The legacy union envelope (`ENV-UNCOMPLICATED-INFLAMMATION`) keeps `review_status: pending` — the second reviewer's comment addressed the profile ranges specifically, and this object was never itself given a Clinical Lead first review (`reviewed_by` stays `null`); it is retained only for internal development, replay compatibility and audit history, and is no longer read for learner_pilot / production generation.

---

## 3. Retrocecal numeric / sampling remainder

**Source:** `src/content/diseases/appendicitis/phenotypes.yaml`, phenotype `retrocecal`, lines **278–469**. The previously approved **qualitative** wording (`PHENOTYPE-RETROCECAL-APP004-QUALITATIVE`, lines 412–431 within this block) is **not** reopened by this review — it is `approved_for_training` already, with second review recorded (Sarina T.T., 2026-08-31). This section covers only the numeric remainder, still `review_status: pending`.

**Final state after remediation:**
- `hours_from_onset`: **6–24 h, uniform**
- `pain_score`: **4–8 / 10, uniform**
- Urinalysis mix: no significant abnormality **60 %** · few leukocytes **20 %** · few erythrocytes **20 %**
- CT free fluid mix: none **70 %** · small local/RLQ **15 %** · small pelvic **15 %**
- Psoas sign: positive **25 %** · negative **75 %**
- Self-treatment variants: **uniform** simulation sampling (unchanged)

**Three branches removed for the first pilot** (deleted from content and from the generator, not merely disabled):
1. the extended 30–36 h onset window and its share;
2. the uncommon RUQ / right-flank pain-site branch and its share;
3. the partial ultrasound-visualization variant and its share.

**Explicit statement:** all of the percentages above are simulation calibration for generation diversity. They are **not** presented as, and must not be read as, epidemiological prevalence, diagnostic sensitivity, or diagnostic specificity.

The previously approved qualitative retrocecal history, examination, imaging and operative wording is unaffected and is not part of this review.

**Reviewer decision:**
- [x] APPROVE
- [ ] REVISE: _______________________________
- [ ] REJECT

**Reviewer comment:** "The 6–24 h history window, pain range, low-frequency positive psoas sign, minor urinalysis abnormalities and limited free-fluid variants are clinically plausible for a narrow resident pilot. Exact percentages are simulation calibration and must not be represented as prevalence, sensitivity or specificity."

**Post-approval remediation (2026-09-01):** `PHENOTYPE-RETROCECAL-APP004` (`phenotypes.yaml`) is now `review_status: approved_for_training`, `second_reviewed_by: ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]`, `second_reviewed_at: "2026-09-01"`.

---

## 4. Nausea / vomiting selection

**Source:** `src/content/diseases/appendicitis/phenotypes.yaml`, block `nausea_vomiting_selection_calibration`, lines **78–112**. `review_status: pending`; `reviewed_by: ["Botagoz Kaukenova — Clinical Lead"]`; `second_reviewed_by: null`. (The four underlying coherent states themselves are approved separately as `SYMPTOM-NAUSEA-VOMITING-COHERENCE`, lines 45–76, and are not reopened here.)

| State | Selection weight |
| --- | --- |
| None | 25 % |
| Nausea only | 25 % |
| Nausea + one vomiting episode | 25 % |
| Nausea + two vomiting episodes | 25 % |

**Explicit statement:**
- Vomiting without nausea is not generated — this is a structural guarantee of the state list, not a probability.
- The four categories themselves were already qualitatively reviewed and approved (`SYMPTOM-NAUSEA-VOMITING-COHERENCE`).
- The 25/25/25/25 split is **simulation-diversity sampling only**.
- It is **not** claimed to reflect real-world epidemiological prevalence of these presentations.

**Reviewer decision:**
- [x] APPROVE
- [ ] REVISE: _______________________________
- [ ] REJECT

**Reviewer comment:** "The generated symptom mix is clinically plausible for acute appendicitis and acceptable for simulation diversity. Exclusion of vomiting-without-nausea should remain understood as a scenario-scope restriction rather than a universal clinical rule."

**Post-approval remediation (2026-09-01):** `CAL-NAUSEA-VOMITING-SELECTION-APP004` (`phenotypes.yaml`) is now `review_status: approved_for_training`, `second_reviewed_by: ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]`, `second_reviewed_at: "2026-09-01"`.

---

## 5. Fasting history

**Source:** `src/content/diseases/appendicitis/findings.yaml`, block `fasting_history`, lines **172–207**. `review_status: pending`; `reviewed_by: ["Botagoz Kaukenova — Clinical Lead"]`; `second_reviewed_by: null`.

- Last solid food: **4–10 hours ago**, uniform
- Last clear liquids: **1–4 hours ago**, uniform
- Invariant (enforced in the generator, `enforce_clear_liquid_not_after_solid_food: true`): **clear-liquid-hours-ago ≤ solid-food-hours-ago** — a generated patient can never report the clear-liquid interval as *longer ago* than the solid-food interval.

**Clinical boundary — stated explicitly:** these values represent generated patient **HISTORY ONLY**. They:
- are **not** elective-fasting guideline thresholds;
- do **not** determine an aspiration-risk classification;
- do **not** automatically delay surgery;
- do **not** cancel surgery;
- do **not** trigger a 6-hour or 8-hour countdown of any kind;
- are **not** used as a learner penalty.

Confirmed by code inspection (`src/core/state/worldState.js`, `src/ai/renderer/renderEvent.js`): the values are stored and rendered as text only; no code path reads them for a threshold, gate, or delay. `fasting_assessment.blocking = false`. Any future clinical consequence would require a **separate**, independently approved anaesthesia/perioperative rule — none exists today.

**Reviewer decision:**
- [x] APPROVE
- [ ] REVISE: _______________________________
- [ ] REJECT

**Reviewer comment:** "The generated values are acceptable as history variables. They must remain non-blocking and must not be interpreted as elective fasting thresholds or automatic delay/cancellation criteria for urgent appendectomy."

**Post-approval remediation (2026-09-01):** `FINDINGS-FASTING-HISTORY` (`findings.yaml`) is now `review_status: approved_for_training`, `second_reviewed_by: ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]`, `second_reviewed_at: "2026-09-01"`. No consumer reads these values for a gate, threshold or delay (unchanged, confirmed again by code inspection during this remediation).

---

## 6. Postoperative recovery model

**Source:** `src/content/diseases/appendicitis/trajectories.yaml`, block `post_source_control_course`, lines **138–270**. `review_status: pending`; `reviewed_by: ["Botagoz Kaukenova — Clinical Lead"]`; `second_reviewed_by: null`; `model_status: authored_awaiting_clinical_re_review`. This is **new patient-trajectory content** (the previous state was `model: null`, nothing authored), so it is reviewed in more detail below.

### Variants and weights
| Variant | Recovery window | Weight |
| --- | --- | --- |
| `early_recovery` | 6–12 h | 50 % |
| `overnight_recovery` | 12–24 h | 50 % |

The weights are **simulation-diversity configuration**, not length-of-stay epidemiology.

### Clock start
Per the current implementation (`src/core/state/worldState.js`, event `SOURCE_CONTROL_COMPLETED`; `src/core/time/advanceTime.js`, `buildPostoperativeRecoveryEvents`): the recovery clock begins at the `SOURCE_CONTROL_COMPLETED` event — i.e. the moment the operative source-control step is recorded — and the patient's `postop.recovery` state enters at that same instant.

### Recovery domains authored (verbatim from content, `recovery_domains`)
1. `anaesthesia_emergence` — consciousness / recovery from anaesthesia
2. `haemodynamic_respiratory_stability`
3. `postoperative_pain`
4. `nausea_vomiting`
5. `oral_intake_tolerance`
6. `mobilisation`
7. `bleeding_or_wound_concern`
8. `ready_for_discharge_assessment`

### Pain — qualitative state progression (verbatim, `postop_pain_states`)
`significant` → `improving` → `controlled_on_oral_analgesia`

**Confirmed:**
- **No** numeric hourly pain-decay function exists anywhere in this model.
- **No** HR / temperature / CRP per-hour arithmetic exists anywhere in this model (or elsewhere in APP-004 natural-course content — the 2026-08-25 remediation deleted the previous fixed per-hour drift and it was not reintroduced).
- **No** automatic discharge is scheduled at 6, 12, or 24 h — the model contains no discharge-triggering effect at all; it only sets internal recovery-phase and pain-stage flags.

### Critical review question
> Does the current model correctly treat 6–12 h and 12–24 h as **bounded uncomplicated recovery variants** rather than mandatory discharge times?

The authored `discharge_readiness_contract` (same block, lines 165–175) states explicitly:
- `window_end_effect: expectation_only_never_override` — window end means only that an uncomplicated patient would normally be expected to have reached the relevant recovery phase; it is **not** a discharge timer.
- Discharge readiness is `evaluated_from: current_patient_state_per_criterion` — **each** discharge criterion is evaluated individually from current patient state, never in bulk from elapsed time.
- `blocks_if_any_true` lists six conditions (pain not controlled on oral analgesia; clinically significant persistent nausea/vomiting; oral intake not tolerated; mobilisation unsafe; vital signs unstable; active bleeding/wound concern) — **any one of these being true keeps discharge blocked regardless of how much recovery-window time has elapsed.**

The reviewer is asked to confirm this design actually achieves the stated intent (i.e., that the model as authored cannot be read or extended to auto-satisfy a criterion merely because a window elapsed).

### Discharge criteria this model is built to serve (shown, not altered)
Source: `src/content/diseases/appendicitis/complications.yaml`, `discharge_criteria`, lines 111–216. These are **already** `approved_for_training` (Clinical Lead + Sarina T.T., 2026-08-31) and are **not** changed by this packet or by the authored recovery model:

| Criterion ID | Current `runtime_evaluation` |
| --- | --- |
| `operation_completed` | (structural, always evaluable) |
| `no_active_unresolved_complication` | (structural, always evaluable) |
| `left_theatre_and_recovery` | (structural, always evaluable) |
| `haemodynamically_stable` | `unavailable_without_recovery_calibration` |
| `pain_controlled_on_oral_regimen` | `unavailable_without_recovery_calibration` |
| `tolerating_oral_intake` | `unavailable_without_recovery_calibration` |
| `no_significant_persistent_vomiting` | `unavailable_without_recovery_calibration` |
| `mobile` | `unavailable_without_recovery_calibration` |
| `urinary_function_acceptable` | `conditional_only` |

Note for the reviewer: because `TRJ-POSTOP-RECOVERY` remains `pending` today, these five `unavailable_without_recovery_calibration` criteria are currently **withheld** at runtime (reported as a simulator limitation, never silently marked "met"). Approving the recovery model does not itself change `runtime_evaluation` on these criteria — that would be a separate, later wiring step after approval (see §8).

**Reviewer decision:**
- [ ] APPROVE trajectory shape for APP-004 resident pilot
- [x] REVISE: the recovery-clock anchor only
- [ ] REJECT

**Reviewer comment:** "`SOURCE_CONTROL_COMPLETED` is not an appropriate start point for postoperative recovery. Source control may be completed before the operation, anaesthetic maintenance and surgical closure are finished. Start the postoperative recovery trajectory at `SURGERY_COMPLETED` / commencement of anaesthetic emergence, or `PACU_ADMISSION` if this is the authoritative available event. The 6–12 h and 12–24 h variants may remain as expectation windows only; elapsed time must neither automatically satisfy discharge criteria nor impose a minimum length of stay."

**Post-approval remediation (2026-09-01):** neither `SURGERY_COMPLETED` nor `PACU_ADMISSION` exists as a runtime event in this codebase. `PROCEDURE_COMPLETED` is the authoritative existing event that unambiguously represents completion of the operation (it carries the closure statement, sets `operative.completed`, and is immediately followed by the move to recovery) and was chosen as the anchor per the reviewer's decision order. The recovery clock (`postop.recovery.enteredAtMinutes`) now starts at `PROCEDURE_COMPLETED`, not `SOURCE_CONTROL_COMPLETED` (`src/core/state/worldState.js`, `src/core/time/advanceTime.js`). No other part of the model changed — the two windows, weights, qualitative pain states and discharge-readiness contract are exactly as authored. `TRJ-POSTOP-RECOVERY` **stays `review_status: pending`** pending the focused re-review of this fix alone: see `docs/review/APP004_POSTOP_CLOCK_ANCHOR_REREVIEW_2026-09-01.md`.

---

## 7. One-page review summary

| Object | Second reviewer decision | Comment |
| --- | --- | --- |
| ENV + inflammatory profiles | ☑ APPROVE ☐ REVISE ☐ REJECT | Numeric ranges clinically plausible; weights are simulation calibration only. |
| Retrocecal numeric/sampling | ☑ APPROVE ☐ REVISE ☐ REJECT | Clinically plausible for a narrow resident pilot. |
| Nausea/vomiting sampling | ☑ APPROVE ☐ REVISE ☐ REJECT | Clinically plausible; exclusion is scenario-scope, not a universal rule. |
| Fasting-history calibration | ☑ APPROVE ☐ REVISE ☐ REJECT | Acceptable as history variables; must stay non-blocking. |
| Postoperative recovery trajectory | ☐ APPROVE ☑ REVISE ☐ REJECT | Recovery-clock anchor (`SOURCE_CONTROL_COMPLETED`) is clinically incorrect; fixed to `PROCEDURE_COMPLETED`, awaiting focused re-review. |

**Second reviewer name:** Sarina T.T.
**Specialty:** General Surgery / Surgical Oncology, NROC
**Date:** 2026-09-01

**Overall decision:**
- [ ] APPROVE ALL FIVE FOR APP-004 TRAINING USE
- [x] APPROVE WITH LISTED REVISIONS
- [ ] NOT APPROVED

---

## 8. Implementation consequence (executed 2026-09-01 for the four APPROVE objects; NOT executed for the REVISE object)

1. Recorded real second-review provenance (`second_reviewed_by: ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]`, `second_reviewed_at: "2026-09-01"`) on the four approved objects: the three individual `PROFILE-INFLAMMATORY-*` objects (§2), `PHENOTYPE-RETROCECAL-APP004` (§3), `CAL-NAUSEA-VOMITING-SELECTION-APP004` (§4), `FINDINGS-FASTING-HISTORY` (§5). The legacy union envelope `ENV-UNCOMPLICATED-INFLAMMATION` (§2) was **not** given `second_reviewed_by` — it was never itself given a Clinical Lead first review (`reviewed_by` stays `null`), so it does not meet "both required reviews" and its `review_status` was left unpromoted.
2. Promoted exactly those four reviewed objects' `review_status` to `approved_for_training`. Nowhere else.
3. Enabled inflammatory profile generation (`inflammatory_profiles.selection.generation_enabled: true`).
4. **Did not** activate the postoperative trajectory — `TRJ-POSTOP-RECOVERY` stays `review_status: pending` per the REVISE decision (§6). Its clock-anchor bug was fixed in code regardless (source control is not a valid anchor for anything downstream), but the model itself stays dormant (`advanceTime.js` still gates on `isRuntimeAuthoritative(reviewStatusOf(course))`, which is `false`).
5. Confirmed no development-only union-envelope fallback remains reachable for a `learner_pilot` session: `evaluateInflammatoryCalibrationForPilot` now returns `{ ready: true, code: "inflammatory_calibration_ready" }` on the live bundle, and `selectInflammatoryProfile` draws from the approved profiles rather than the envelope (verified: every generated patient's physiology now falls inside exactly one selected profile).
6. Rebuilt content (`npm run content:build`) — OK.
7. Ran the full test suite (`npm test`) — 307/307 passing (one pre-existing test, `PBC-GOV the learner is not flooded with governance messages at case start`, was updated to reflect that session start now withholds only the two still-`pending` objects instead of the prior, larger count).
8. Ran lint (`npm run lint`) — clean.
9. Ran Playwright (`npx playwright test`) — 4/4 passing.
10. Regenerated the smoke replay (`node scripts/smokeApp004.mjs`) — runs end to end; simulator limitations list shows exactly the two still-pending objects (`uncomplicated_inflammation`, `post_source_control_course`/`TRJ-POSTOP-RECOVERY`) plus the five governed discharge criteria still withheld as `discharge_runtime_fact`.
11. Re-ran the patient-truth inventory (`inventoryPatientTruth`) for the actual `internal_development` build that runs today: `patientTruthApproved` stays **`false`** (blocked: `uncomplicated_inflammation`, `post_source_control_course`) — expected, since `TRJ-POSTOP-RECOVERY` is still pending. **2026-09-01 governance correction:** the inventory is now purpose/route aware (see manifest §G) — for a `learner_pilot` / `production` route, `patientGenerator.js` never reaches the union envelope once the profiles are active, so it is no longer counted there; the only blocker on that hypothetical route is `TRJ-POSTOP-RECOVERY`.
12. Did **not** promote `case_presets[APP-004].runtime_status` from `development_only`. A `learner_pilot` session for APP-004 is confirmed still rejected (`preset_not_learner_enabled`).

**This packet does not, and this task did not, make `runtime_status` learner-enabled, and `patientTruthApproved` stays `false`.**

---

## 9. Verification

**Method:** every value quoted in §2–§6 above was read directly from the current repository files listed (not from any prior review document) on 2026-09-01, together with the corresponding `provenance.review_status` / `reviewed_by` / `second_reviewed_by` fields, immediately before this packet was written. The compiled bundle (`src/content/generated/appendicitis.json`) and the currently passing test/lint/build/smoke run (307/307 unit+script tests, 4/4 Playwright, clean lint) reflect this same content, after the §8 remediation.

| Object | Source path | Line range |
| --- | --- | --- |
| ENV union envelope (interim fallback) | `src/content/diseases/appendicitis/disease.yaml` | 116–144 |
| ENV inflammatory profiles + selection | `src/content/diseases/appendicitis/disease.yaml` | 208–296 |
| Retrocecal phenotype (numeric remainder) | `src/content/diseases/appendicitis/phenotypes.yaml` | 278–469 |
| Nausea/vomiting selection calibration | `src/content/diseases/appendicitis/phenotypes.yaml` | 78–112 |
| Fasting history | `src/content/diseases/appendicitis/findings.yaml` | 172–207 |
| Postoperative recovery model | `src/content/diseases/appendicitis/trajectories.yaml` | 138–270 |
| Discharge criteria (shown, not altered) | `src/content/diseases/appendicitis/complications.yaml` | 111–216 |

**Does the packet exactly match current implementation?** Yes. Every numeric range, weight, removed-branch claim, model field name, and provenance status quoted above was cross-checked against the live YAML on 2026-09-01 and matches exactly (including the psoas 25/75 orientation, the urinalysis and CT free-fluid splits, the fasting invariant flag name, and the postoperative model's variant IDs, domain list, and pain-stage sequence).

**Discrepancy between current code/content and the Clinical Lead's decisions:** none found.

---

## 10. Remediation record (2026-09-01, applying the Second Clinical Reviewer Decision above)

Four objects were promoted to `approved_for_training` with real second-review provenance (§8). The fifth, `TRJ-POSTOP-RECOVERY`, was **not** promoted — its `SOURCE_CONTROL_COMPLETED` clock anchor was fixed in code (now `PROCEDURE_COMPLETED`), but the object stays `review_status: pending` pending a focused re-review of that fix alone. See `docs/review/APP004_POSTOP_CLOCK_ANCHOR_REREVIEW_2026-09-01.md`.

No clinical value, weight, range, qualitative wording, or discharge criterion approved by either reviewer was changed. `runtime_status` was not promoted. `patientTruthApproved` stays `false`. The resident pilot stays NO-GO.

## Final status

**READY_FOR_POSTOP_CLOCK_ANCHOR_REREVIEW**
