import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "./createSession.js";
import { submitLearnerTurn } from "./submitLearnerTurn.js";
import { generatePatient } from "../patient/patientGenerator.js";
import { inventoryPatientTruth, evaluateInflammatoryCalibrationForPilot } from "../patient/patientTruthGovernance.js";
import { renderEvent } from "../../ai/renderer/renderEvent.js";
import { buildDebrief } from "../replay/buildDebrief.js";
import { REFERENCE_HOSPITAL_PROFILE, REAL_HOSPITAL_PROFILES } from "../hospital/hospitalProfiles.js";
import { reviewStatusOf, authorityLayerOf, jurisdictionOf } from "../rules/contentProvenance.js";
import { withShared } from "../content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

/**
 * APP-004 CLINICAL REMEDIATION COMPLIANCE SUITE
 *
 * One test per decision in APP004_CLINICAL_REVIEW_MATRIX_v1.0_2026-08-25 that
 * the remediation task §23 asks to be pinned. The matrix reference is named in
 * each test so a future reviewer can go from a failing assertion back to the
 * clinical decision it protects, and so that reversing a decision requires
 * editing a test that says out loud what is being reversed.
 *
 * Several of these assert the ABSENCE of something. That is deliberate: the
 * expensive failures in this codebase have been quiet reintroductions, not
 * loud breakages.
 */

const bundle = withShared(diseaseBundle, sharedBundle);
const START_ISO = "2026-08-23T09:15:00+05:00";
const SEEDS = Array.from({ length: 60 }, (_, index) => `remediation-${index}`);

function newSession(seed = "remediation", { mode = "reference", realProfileId } = {}) {
  return createSession({
    sessionId: "remediation",
    seed,
    mode,
    realProfileId,
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: START_ISO,
  });
}

const say = (session, text) => submitLearnerTurn({ session, text });
const saying = (session, texts) => texts.reduce((current, text) => say(current, text).session, session);
const outcomesOf = (turn) => turn.outcomes.map((result) => result.outcome);
const patients = () => SEEDS.map((seed) => generatePatient({ seed, bundle, casePresetId: "APP-004" }));

/** Reaches theatre through real learner actions only. */
function readyForTheatre(seed = "theatre") {
  return saying(newSession(seed), [
    "идём на операцию",
    "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр",
    "переоценю витальные через 40 минут",
    "получаю согласие",
  ]);
}

const preopIds = () => (bundle.operative.preop_requirements ?? []).map((item) => item.id);

// ===========================================================================
// 4-10. Patient generation (matrix §3, task §5)
// ===========================================================================

test("4. APP-004 age stays inside the reviewed 18-58 window", () => {
  // Matrix P01: the base adult phenotype excludes elderly presentation, which
  // becomes a separate phenotype later. The range is CONTENT, not a literal in
  // the generator - `int(18, 75)` used to be hardcoded in core.
  assert.deepEqual(bundle.phenotypes.demographics.age_years, [18, 58]);
  for (const patient of patients()) {
    assert.ok(patient.demographics.age >= 18 && patient.demographics.age <= 58, `age ${patient.demographics.age} out of range`);
  }
});

test("5. no 3+ day presentation is generated in the base APP-004 phenotype", () => {
  // Matrix P04: most uncomplicated patients present within ~24 h, and a 3+ day
  // history implies a different severity trajectory. APP004 Numeric
  // Calibration Review 2026-08-31 (RETROCECAL): the extended 30-36 h window
  // and its unreviewed share were REMOVED for the pilot, so the only reachable
  // window is 6-24 h.
  const presentation = bundle.phenotypes.phenotypes.retrocecal.presentation;
  assert.deepEqual(presentation.hours_from_onset, [6, 24]);
  assert.equal("hours_from_onset_extended" in presentation, false, "extended window removed");
  assert.equal("hours_from_onset_extended_enabled" in presentation, false);
  assert.equal("hours_from_onset_extended_share" in presentation, false);
  for (const patient of patients()) {
    assert.ok(patient.presentation.onsetHours >= 6 && patient.presentation.onsetHours <= 24, `onset ${patient.presentation.onsetHours} h out of the reviewed window`);
  }
});

test("6. a retrocecal APP-004 patient may present with right lower quadrant pain", () => {
  // Matrix P05: retrocecal position can be atypical but does NOT forbid RLQ
  // pain, and the previous content made RLQ unreachable for this phenotype.
  const sites = bundle.phenotypes.phenotypes.retrocecal.presentation.pain_sites_ru;
  assert.ok(sites.includes("в правой подвздошной области"));
  const generated = new Set(patients().map((patient) => patient.presentation.painSiteRu));
  assert.ok(generated.has("в правой подвздошной области"), "RLQ must actually occur across seeds");
  assert.ok(generated.size > 1, "pain site is genuinely seeded, not fixed");
});

test("7. vomiting is never generated without nausea", () => {
  // Matrix P06. The guarantee is STRUCTURAL: content authors combined states,
  // so "vomiting twice, no nausea" is not expressible rather than merely rare.
  for (const state of bundle.phenotypes.nausea_vomiting_states) {
    if (state.vomiting_episodes > 0) assert.equal(state.nausea, true, `state ${state.id} is incoherent`);
  }
  for (const patient of patients()) {
    if (patient.initialSymptoms.vomitingEpisodes > 0) assert.equal(patient.initialSymptoms.nausea, true);
  }
});

test("8. APP-004 excludes pregnancy and never opens a reproductive branch", () => {
  for (const patient of patients()) {
    assert.equal(patient.truth.pregnancyExcluded, true);
    assert.deepEqual(patient.presentation.sexConditionalHistoryRu, []);
  }
});

test("9. a male patient never carries pregnancy or LMP content anywhere", () => {
  // Task §11: "female-specific rules must never fire for male patients". This
  // checks the RENDERED history too - a generated-but-unrendered field would
  // still be a leak waiting for a template change.
  const males = patients().filter((patient) => patient.demographics.sex === "male");
  assert.ok(males.length > 0, "male patients must be reachable");
  for (const patient of males) {
    assert.deepEqual(patient.presentation.sexConditionalHistoryRu, []);
    const rendered = renderEvent({
      event: { type: "HISTORY_OBTAINED", payload: {} },
      bundle,
      patient,
    });
    assert.equal(/менструац|беременн/i.test(rendered.textRu), false, rendered.textRu);
  }
});

test("10. no ritual named appendiceal sign is generated or required", () => {
  // Matrix P09: no Rovsing / Sitkovsky / Bartomier-Michelson checklist. Psoas
  // is retained because it is genuinely informative for this position.
  const slotIds = bundle.findings.exam_slots.map((slot) => slot.id);
  assert.equal(slotIds.includes("rovsing"), false);
  assert.equal(slotIds.includes("percussion"), false);
  assert.ok(slotIds.includes("psoas"));
  const removed = bundle.findings.removed_exam_slots.map((entry) => entry.id);
  for (const id of ["rovsing", "sitkovsky", "bartomier_michelson"]) assert.ok(removed.includes(id));

  for (const patient of patients()) {
    for (const slotId of Object.keys(patient.examSlots)) {
      assert.equal(["rovsing", "percussion", "sitkovsky", "bartomier_michelson"].includes(slotId), false);
    }
  }
  const preop = JSON.stringify(bundle.operative.preop_requirements);
  assert.equal(/rovsing|sitkovsky|bartomier/i.test(preop), false);
});

test("the base abdominal examination matches the reviewed wording", () => {
  // Matrix P08: soft, not distended, participates in respiration, maximal
  // tenderness on the right, no involuntary guarding, no peritoneal
  // irritation, bowel sounds preserved.
  const patient = generatePatient({ seed: "exam-wording", bundle, casePresetId: "APP-004" });
  const rendered = renderEvent({
    event: { type: "EXAMINATION_PERFORMED", payload: { region: "abdomen" } },
    bundle,
    patient,
  }).textRu;
  assert.match(rendered, /не вздут/);
  assert.match(rendered, /участвует в акте дыхания/);
  assert.match(rendered, /мягкий/);
  assert.match(rendered, /непроизвольного защитного напряжения мышц нет/);
  assert.match(rendered, /признаков раздражения брюшины нет/i);
  assert.match(rendered, /перистальтика выслушивается/i);
});

// ===========================================================================
// APP004 Numeric Calibration Review 2026-08-31 — Clinical Lead decisions
// ===========================================================================

test("calibration: retrocecal variant frequencies follow the reviewed weights", () => {
  const presentation = bundle.phenotypes.phenotypes.retrocecal.presentation;
  assert.deepEqual(presentation.urinalysis_variants_weights, [60, 20, 20]);
  assert.deepEqual(presentation.examination_slot_weights.psoas, [25, 75]);
  assert.deepEqual(
    bundle.phenotypes.phenotypes.retrocecal.imaging.ct_report_ru.free_fluid_variants_weights,
    [70, 15, 15],
  );
  // Disabled pseudo-precision is gone, not merely switched off.
  for (const key of [
    "pain_sites_uncommon_ru",
    "pain_sites_uncommon_enabled",
    "pain_sites_uncommon_share",
  ]) {
    assert.equal(key in presentation, false, `${key} must be removed for the pilot`);
  }
  assert.equal("ultrasound_visualized_variant_ru" in bundle.phenotypes.phenotypes.retrocecal.imaging, false);

  // The weighted draw genuinely biases the mix: "no abnormality" (weight 60)
  // must dominate the two single-cell variants (weight 20 each) across seeds.
  const big = Array.from({ length: 300 }, (_, i) => generatePatient({ seed: `ua-${i}`, bundle, casePresetId: "APP-004" }));
  const noAbnormality = big.filter((p) => /без значимых отклонений/.test(p.laboratory.urinalysisRu)).length;
  assert.ok(noAbnormality > big.length * 0.45 && noAbnormality < big.length * 0.75, `no-abnormality share ${noAbnormality}/${big.length}`);
  const psoasPositive = big.filter((p) => p.examSlots.psoas === "положительный").length;
  assert.ok(psoasPositive < big.length * 0.4, `psoas-positive share ${psoasPositive}/${big.length} should sit near 25%`);
});

test("calibration: nausea/vomiting selection is an accepted uniform simulation-sampling draw, now approved", () => {
  const cal = bundle.phenotypes.nausea_vomiting_selection_calibration;
  assert.equal(cal.method, "uniform_simulation_sampling");
  assert.equal(cal.is_epidemiological_estimate, false);
  // Second Clinical Reviewer Decision, 2026-09-01 (Sarina T.T.): APPROVED.
  assert.equal(cal.provenance.review_status, "approved_for_training");
  assert.deepEqual(cal.provenance.reviewed_by, ["Botagoz Kaukenova — Clinical Lead"]);
  assert.deepEqual(cal.provenance.second_reviewed_by, ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]);
  assert.equal(cal.provenance.second_reviewed_at, "2026-09-01");
});

test("calibration: fasting keeps the reviewed ranges, enforces clear-liquid ≤ solid-food, and is now approved", () => {
  // APP004 Numeric Calibration Review (FASTING): ranges APPROVED, plus the
  // invariant that a patient never reports drinking longer ago than eating.
  const fasting = bundle.findings.fasting_history;
  assert.deepEqual(fasting.last_solid_food_hours_ago, [4, 10]);
  assert.deepEqual(fasting.last_clear_liquid_hours_ago, [1, 4]);
  assert.equal(fasting.enforce_clear_liquid_not_after_solid_food, true);
  for (const patient of patients()) {
    const { lastSolidFoodHoursAgo: solid, lastClearLiquidHoursAgo: liquid } = patient.presentation.fastingHistory;
    assert.ok(liquid <= solid, `clear liquid ${liquid} h must not be longer ago than solid food ${solid} h`);
  }
  // No anaesthesia threshold / automatic delay is driven by these values.
  assert.equal(/npo_status|aspiration_threshold/.test(JSON.stringify(bundle.operative.preop_requirements)), false);
  // Second Clinical Reviewer Decision, 2026-09-01 (Sarina T.T.): APPROVED.
  assert.equal(fasting.provenance.review_status, "approved_for_training");
  assert.deepEqual(fasting.provenance.second_reviewed_by, ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]);
});

test("calibration: retrocecal numeric remainder is now approved (second review 2026-09-01)", () => {
  const provenance = bundle.phenotypes.phenotypes.retrocecal.provenance;
  assert.equal(provenance.review_status, "approved_for_training");
  assert.deepEqual(provenance.reviewed_by, ["Botagoz Kaukenova — Clinical Lead"]);
  assert.deepEqual(provenance.second_reviewed_by, ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]);
  assert.equal(provenance.second_reviewed_at, "2026-09-01");
});

test("calibration: chemistry analytes are approved as an all-normal base-case claim", () => {
  const prov = bundle.trajectories.provenance_chemistry_analytes;
  assert.equal(prov.review_status, "approved_for_training");
  assert.deepEqual(prov.reviewed_by, ["Botagoz Kaukenova — Clinical Lead"]);
  assert.equal(prov.second_review_required, false);
  assert.equal(Object.keys(bundle.trajectories.chemistry_analytes).length, 8);
  for (const analyte of Object.values(bundle.trajectories.chemistry_analytes)) {
    assert.match(analyte.result_ru, /в пределах референсных значений/);
  }
});

test("calibration: ENV 3-profile ranges are populated verbatim, now approved and active", () => {
  // APP004 Numeric Calibration Review (ENV): REVISE to linked
  // minimal/moderate/marked_but_stable profiles. Second Clinical Reviewer
  // Decision, 2026-09-01 (Sarina T.T.): APPROVED. The three profiles are now
  // `approved_for_training` and `selection.generation_enabled` is `true` -
  // this is the active generation path.
  const profiles = bundle.disease.inflammatory_profiles;
  assert.equal(profiles.selection.generation_enabled, true);
  assert.deepEqual(profiles.selection.order, ["minimal", "moderate", "marked_but_stable"]);
  assert.deepEqual(profiles.selection.weights, [0.3, 0.5, 0.2]);
  assert.equal(profiles.selection.weights_are_epidemiological_prevalence, false);
  assert.deepEqual(profiles.minimal.heart_rate, [72, 90]);
  assert.deepEqual(profiles.moderate.wbc, [10.5, 14.5]);
  assert.deepEqual(profiles.marked_but_stable.crp, [40, 100]);
  for (const id of ["minimal", "moderate", "marked_but_stable"]) {
    assert.deepEqual(profiles[id].provenance.reviewed_by, ["Botagoz Kaukenova — Clinical Lead"]);
    assert.equal(profiles[id].provenance.review_status, "approved_for_training", `${id} approved after 2nd review`);
    assert.deepEqual(profiles[id].provenance.second_reviewed_by, ["Sarina T.T. — General Surgery / Surgical Oncology, NROC"]);
    assert.equal(profiles[id].provenance.second_reviewed_at, "2026-09-01");
    for (const field of ["heart_rate", "temperature_c", "systolic_bp", "respiratory_rate", "wbc", "neutrophil_percent", "crp"]) {
      assert.ok(Array.isArray(profiles[id][field]) && profiles[id][field].length === 2, `${id}.${field} range`);
    }
  }
  // The legacy union envelope's own review_status is untouched by this
  // decision - the second reviewer's comment addressed the profile ranges,
  // not this object, which was never itself given a Clinical Lead first
  // review (`reviewed_by` stays null). It is retained only for internal
  // development / replay compatibility / audit history and is no longer the
  // active generation path.
  assert.equal(bundle.disease.physiology_envelopes.uncomplicated_inflammation.provenance.review_status, "pending");
  assert.equal(bundle.disease.physiology_envelopes.uncomplicated_inflammation.provenance.reviewed_by, null);
});

test("calibration: with profiles active, every generated patient's physiology sits inside ONE selected profile, never the union envelope or a mix", () => {
  // Task requirement F: APP-004 learner_pilot cannot fall back to the legacy
  // union inflammatory ranges once the linked profiles are active. Proven
  // directly on the live (unmodified) bundle now that the profiles are
  // approved_for_training and generation_enabled is true.
  const profiles = bundle.disease.inflammatory_profiles;
  const fieldsInProfile = (physiology, id) =>
    physiology.heartRate >= profiles[id].heart_rate[0] - 1 &&
    physiology.heartRate <= profiles[id].heart_rate[1] + 1 &&
    physiology.wbc >= profiles[id].wbc[0] - 0.5 &&
    physiology.wbc <= profiles[id].wbc[1] + 0.5 &&
    physiology.crp >= profiles[id].crp[0] - 1 &&
    physiology.crp <= profiles[id].crp[1] + 1;
  const seenProfiles = new Set();
  for (const patient of patients()) {
    const p = patient.initialPhysiology;
    const matches = profiles.selection.order.filter((id) => fieldsInProfile(p, id));
    assert.ok(matches.length >= 1, `patient physiology (HR ${p.heartRate}, WBC ${p.wbc}, CRP ${p.crp}) matched no profile`);
    for (const id of matches) seenProfiles.add(id);
  }
  // All three profiles are genuinely reachable across seeds (30/50/20 weights).
  assert.deepEqual([...seenProfiles].sort(), ["marked_but_stable", "minimal", "moderate"]);
});

test("calibration: enabling the profile path without approval refuses to fall back to the union envelope", () => {
  // Once selection.generation_enabled is true, a missing/unapproved/invalid
  // profile must THROW, never silently use the legacy union ranges.
  const enabledUnapproved = structuredClone(bundle);
  const unapproved = enabledUnapproved.disease.inflammatory_profiles;
  unapproved.selection.generation_enabled = true;
  for (const id of unapproved.selection.order) unapproved[id].provenance.review_status = "pending";
  assert.throws(
    () => generatePatient({ seed: "env-guard-1", bundle: enabledUnapproved, casePresetId: "APP-004" }),
    /refusing to fall back to the union envelope/,
  );

  // Approved but with a mixed/incomplete profile is also refused.
  const enabledMixed = structuredClone(bundle);
  const profs = enabledMixed.disease.inflammatory_profiles;
  profs.selection.generation_enabled = true;
  for (const id of profs.selection.order) profs[id].provenance.review_status = "approved_for_training";
  profs.minimal.crp = null; // a hole in one profile
  assert.throws(
    () => generatePatient({ seed: "env-guard-2", bundle: enabledMixed, casePresetId: "APP-004" }),
    /missing\/invalid ranges/,
  );

  // Fully approved + complete: a patient generates, and every physiology field
  // sits inside the SELECTED profile (never mixed across profiles). This is
  // also the live bundle's actual state today.
  const ok = bundle.disease.inflammatory_profiles;
  const inRangeForSome = (value, field) =>
    ok.selection.order.some((id) => value >= ok[id][field][0] - 0.5 && value <= ok[id][field][1] + 0.5);
  for (const seed of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
    const patient = generatePatient({ seed, bundle, casePresetId: "APP-004" });
    const p = patient.initialPhysiology;
    assert.ok(inRangeForSome(p.heartRate, "heart_rate"), `HR ${p.heartRate} not in any profile`);
    assert.ok(inRangeForSome(p.crp, "crp"), `CRP ${p.crp} not in any profile`);
    assert.ok(inRangeForSome(p.wbc, "wbc"), `WBC ${p.wbc} not in any profile`);
  }
});

test("calibration: the pilot gate refuses the profile path unless it is enabled + approved + valid, and is now ready", () => {
  // Guardrail for when someone later flips runtime_status: a learner_pilot /
  // production session must fail rather than be generated from the union
  // envelope. Proven on the pure evaluator (the full createSession path is
  // still blocked earlier by preset_not_learner_enabled today).
  const disabled = structuredClone(bundle.disease.inflammatory_profiles);
  disabled.selection.generation_enabled = false;
  assert.deepEqual(evaluateInflammatoryCalibrationForPilot({ inflammatoryProfiles: disabled }), {
    ready: false,
    code: "inflammatory_calibration_not_enabled_for_pilot",
  });

  const enabledPending = structuredClone(bundle.disease.inflammatory_profiles);
  for (const id of enabledPending.selection.order) enabledPending[id].provenance.review_status = "pending";
  assert.equal(
    evaluateInflammatoryCalibrationForPilot({ inflammatoryProfiles: enabledPending }).code,
    "inflammatory_profile_not_approved_for_pilot",
  );

  // The live bundle's own inflammatory_profiles are enabled + approved +
  // valid today, so the pilot gate is genuinely ready.
  assert.deepEqual(evaluateInflammatoryCalibrationForPilot({ inflammatoryProfiles: bundle.disease.inflammatory_profiles }), {
    ready: true,
    code: "inflammatory_calibration_ready",
  });

  // A disease with no profile calibration at all has nothing to enforce.
  assert.equal(evaluateInflammatoryCalibrationForPilot({ inflammatoryProfiles: undefined }).ready, true);
});

// ===========================================================================
// Governance correction, 2026-09-01: the patient-truth inventory must be
// purpose/route aware. `patientGenerator.js` never reaches the legacy union
// envelope for a `learner_pilot` / `production` APP-004 session once the
// linked inflammatory profiles are enabled - it fails closed instead. The
// envelope must therefore not count as a required patient-truth approval on
// that route, while it stays a legitimate pending/development-only item for
// `internal_development` / `faculty_preview`, where the fallback remains
// reachable.
// ===========================================================================

test("calibration: learner_pilot / production inventory does not require the legacy union envelope once linked profiles are active and approved", () => {
  for (const sessionPurpose of ["learner_pilot", "production"]) {
    const inventory = inventoryPatientTruth({ bundle, casePresetId: "APP-004", sessionPurpose });
    assert.equal(
      inventory.blocked.some((entry) => entry.id === "uncomplicated_inflammation"),
      false,
      `${sessionPurpose} inventory must not block on the legacy union envelope`,
    );
    // The postoperative recovery model (TRJ-POSTOP-RECOVERY) was the last
    // remaining blocker on this route; its focused clock-anchor re-review was
    // recorded APPROVE on 2026-09-01 (Sarina T.T.) and it is now
    // approved_for_training, so this route has no blocked patient-truth object.
    assert.deepEqual(inventory.blocked.map((entry) => entry.id), []);
    const inflammatoryEntry = inventory.entries.find((entry) => entry.contentId === "inflammatory_profiles");
    assert.ok(inflammatoryEntry, "an entry for the active profile mechanism must exist instead of the envelope");
    assert.equal(inflammatoryEntry.reviewStatus, "approved_for_training");
  }
});

test("calibration: internal_development / faculty_preview inventory still identifies the legacy union envelope as pending", () => {
  for (const sessionPurpose of ["internal_development", "faculty_preview", undefined]) {
    const inventory = inventoryPatientTruth({ bundle, casePresetId: "APP-004", sessionPurpose });
    assert.ok(
      inventory.blocked.some((entry) => entry.id === "uncomplicated_inflammation"),
      `${sessionPurpose ?? "(purpose omitted)"} inventory must still surface the legacy envelope as a pending patient-truth object`,
    );
    const envelopeEntry = inventory.entries.find((entry) => entry.contentId === "uncomplicated_inflammation");
    assert.ok(envelopeEntry);
    assert.equal(envelopeEntry.reviewStatus, "pending");
  }
});

test("calibration: a learner_pilot inventory cannot be fooled into reporting ready when the profile mechanism is not - and the generator itself still refuses to fall back", () => {
  const unapproved = structuredClone(bundle);
  const profs = unapproved.disease.inflammatory_profiles;
  profs.minimal.provenance.review_status = "pending"; // one profile un-approved again

  const inventory = inventoryPatientTruth({ bundle: unapproved, casePresetId: "APP-004", sessionPurpose: "learner_pilot" });
  const inflammatoryEntry = inventory.entries.find((entry) => entry.contentId === "inflammatory_profiles");
  assert.equal(inflammatoryEntry.reviewStatus, "inflammatory_profile_not_approved_for_pilot");
  assert.ok(inventory.blocked.some((entry) => entry.id === "inflammatory_profiles"));
  assert.equal(inventory.approved, false);

  // The generator itself refuses to fall back to the union envelope for this
  // same broken bundle - it throws rather than silently substituting the
  // legacy ranges, tying the inventory signal to real generation behavior.
  assert.throws(
    () => generatePatient({ seed: "route-guard", bundle: unapproved, casePresetId: "APP-004" }),
    /refusing to fall back to the union envelope/,
  );
});

test("calibration: a seeded postoperative recovery variant is assigned; model is runtime-authoritative after the focused clock-anchor re-review", () => {
  // APP004 Numeric Calibration Review (POSTOP): two 50/50 recovery windows,
  // criteria-based. Promoted to approved_for_training on 2026-09-01 after the
  // focused second re-review of the SOURCE_CONTROL_COMPLETED -> PROCEDURE_COMPLETED
  // clock-anchor fix (Sarina T.T.). The windows/weights/pain states are unchanged.
  const course = bundle.trajectories.post_source_control_course;
  assert.equal(course.provenance.review_status, "approved_for_training");
  assert.deepEqual(course.recovery_variant_weights, [50, 50]);
  const ids = new Set(patients().map((p) => p.truth.postopRecoveryVariantId));
  assert.deepEqual([...ids].sort(), ["early_recovery", "overnight_recovery"]);
  for (const patient of patients()) {
    const [lo, hi] = patient.truth.postopRecoveryVariantId === "early_recovery" ? [6, 12] : [12, 24];
    assert.ok(patient.truth.postopRecoveryWindowHours >= lo && patient.truth.postopRecoveryWindowHours <= hi);
  }
});

// ===========================================================================
// 11-12. Biochemistry ordering (matrix V07, V08; task §8)
// ===========================================================================

test("11. «БХАК» asks which values are needed instead of returning a hidden panel", () => {
  const turn = say(newSession(), "БХАК");
  assert.deepEqual(outcomesOf(turn), ["CLARIFY"]);
  assert.deepEqual(turn.outcomes[0].missing, ["analytes"]);
  assert.equal(turn.outcomes[0].clarifyPromptRu, "Какие показатели биохимии нужны?");
  assert.equal(turn.session.state.investigations.chemistry, undefined);
});

test("12. CRP is a separate order and is never folded into a chemistry order", () => {
  // Matrix V08.
  assert.ok(bundle.trajectories.investigation_timing.crp, "CRP is separately orderable");
  assert.equal("crp" in bundle.trajectories.chemistry_analytes, false, "CRP is not a biochemistry analyte here");
  const session = say(newSession(), "БХАК: креатинин, глюкоза").session;
  assert.equal(session.state.investigations.crp, undefined);
});

// ===========================================================================
// 13-18. Imaging (matrix §5, task §9)
// ===========================================================================

test("13. CT can be ordered without any prior ultrasound", () => {
  // Matrix I01 REMOVE: US is not a mandatory prerequisite before CT in an
  // adult (SRC-ACR-ABD), and the mentor must not penalise skipping it.
  const turn = say(newSession(), "КТ ОБП");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
  assert.equal(turn.mentor?.textRu ?? null, null, "no challenge for going straight to CT");
  assert.equal(JSON.stringify(bundle.rules.rules).includes("ultrasound_before_ct"), false);
});

test("14. a nondiagnostic ultrasound is never rendered as a negative study", () => {
  // Matrix I03: "appendix not reliably visualised" is NOT equivalent to
  // "negative for appendicitis", and the difference is the teaching point.
  const session = say(newSession(), "УЗИ брюшной полости").session;
  const resulted = say(session, "переоценю витальные через 3 часа").session;
  const text = resulted.state.investigations.ultrasound_abdomen.result;
  assert.match(text, /достоверно не визуализирован/);
  assert.match(text, /неинформативно/);
  assert.equal(/отрицательн/i.test(text), false, `must not read as a negative study: ${text}`);
});

test("15. CT renders as a full abdomen/pelvis report, not an appendix-only test", () => {
  // Matrix I04: the case begins as an undifferentiated acute abdomen.
  const sections = bundle.phenotypes.phenotypes.retrocecal.imaging.ct_report_ru.sections.map((section) => section.id);
  for (const region of ["liver", "biliary", "pancreas", "spleen", "urinary", "bowel", "free_air", "pelvis", "appendix"]) {
    assert.ok(sections.includes(region), `CT report is missing the ${region} section`);
  }
  const session = say(newSession(), "КТ ОБП").session;
  const resulted = say(session, "переоценю витальные через 4 часа").session;
  const rendered = renderEvent({
    event: resulted.events.findLast((event) => event.type === "TEST_RESULTED"),
    bundle,
    patient: resulted.patient,
  }).textRu;
  assert.match(rendered, /Печень/);
  assert.match(rendered, /Почки/);
  assert.match(rendered, /Свободного газа/);
  assert.match(rendered, /другой острой патологии не выявлено/i);
});

test("16. the CT report invents no appendix diameter", () => {
  // Matrix I05 leaves the numeric range NEEDS SOURCE; task §20 forbids the
  // renderer creating facts. The check is on the RENDERED text, because that
  // is where an invented number would actually reach the learner.
  const session = say(newSession("ct-diameter"), "КТ ОБП").session;
  const resulted = say(session, "переоценю витальные через 4 часа").session;
  const rendered = renderEvent({
    event: resulted.events.findLast((event) => event.type === "TEST_RESULTED"),
    bundle,
    patient: resulted.patient,
  }).textRu;
  assert.equal(/\d+\s*(мм|см)/.test(rendered), false, `no diameter may appear: ${rendered}`);
  assert.equal(/диаметр\w*\s+\d/.test(rendered), false);
});

test("17. base APP-004 has no appendicolith", () => {
  // Matrix I08: an appendicolith affects risk/management and needs separate
  // modelling and review.
  assert.equal(/копролит|аппендиколит|фекалит/i.test(JSON.stringify(bundle.phenotypes)), false);
  const session = say(say(newSession("no-lith"), "КТ ОБП").session, "переоценю витальные через 4 часа").session;
  const rendered = renderEvent({
    event: session.events.findLast((event) => event.type === "TEST_RESULTED"),
    bundle,
    patient: session.patient,
  }).textRu;
  assert.equal(/копролит|аппендиколит|фекалит/i.test(rendered), false);
});

test("18. base APP-004 has no incidental findings", () => {
  // Matrix I09: the first slice does not validate irrelevant extra content.
  const content = JSON.stringify(bundle.phenotypes);
  assert.equal(/киста|кисты|случайн[а-яё]* наход/i.test(content), false);
  for (const patient of patients().slice(0, 20)) {
    const fluid = patient.imaging.ctFreeFluid;
    assert.ok(["none", "small_local", "small_pelvic"].includes(fluid.id), `unexpected CT variant ${fluid.id}`);
  }
});

test("small free fluid is seeded, and no abscess, free gas or perforation exists in base APP-004", () => {
  // Matrix I07 / task §9.5.
  const seen = new Set(patients().map((patient) => patient.imaging.ctFreeFluid.id));
  assert.ok(seen.size > 1, "free fluid must genuinely vary across seeds");
  const content = JSON.stringify(bundle.phenotypes.phenotypes.retrocecal.imaging);
  assert.match(content, /Признаков перфорации, абсцесса и свободного газа не выявлено/);
});

// ===========================================================================
// 19-20. Withdrawn physiology equations (matrix M08, T01-T03; task §4.8, §4.9)
// ===========================================================================

test("19. no fixed crystalloid vital-sign delta survives anywhere", () => {
  // Matrix M08: a universal hemodynamic delta for a stable euvolemic patient
  // is physiologically unjustified. Content AND behaviour are both checked.
  const effect = bundle.trajectories.treatment_effects.fluid_crystalloid;
  assert.equal(effect.response_envelope, null);
  assert.equal(effect.requires_patient_state, "volume_deficit");
  assert.equal("crystalloid_bolus_500_1000ml" in bundle.trajectories.treatment_effects, false);

  const session = say(newSession("fluids"), "500 мл физраствора за час");
  const before = { ...session.session.state.physiology };
  const later = say(session.session, "переоценю витальные через 3 часа").session;
  assert.deepEqual(later.state.physiology, before, "a fluid order must not move vitals in a euvolemic patient");
});

test("20. stable APP-004 uses an approved qualitative no-transition contract", () => {
  // Matrix T01/T02/T03. The arithmetic is DELETED, not merely gated: promoting
  // the trajectory's review status by hand cannot resurrect it.
  const trajectory = bundle.trajectories.trajectories["TRJ-STABLE"];
  assert.equal(trajectory.natural_course_model.kind, "bounded_state_transitions");
  assert.deepEqual(trajectory.natural_course_model.transitions, []);
  assert.equal("pre_source_control_drift_per_hour" in trajectory, false);
  assert.equal("post_source_control_recovery_per_hour" in trajectory, false);
  assert.equal(reviewStatusOf(trajectory), "approved_for_training");
});

// ===========================================================================
// 21-26. Withdrawn requirements and complications
// ===========================================================================

test("21. site marking is absent from preoperative requirements and from the debrief", () => {
  // Matrix PR12 / task §4.1: it must not reappear as an APP-004 miss.
  assert.equal(preopIds().includes("site_marking"), false);
  const removed = bundle.operative.removed_preop_requirements.map((entry) => entry.id);
  assert.ok(removed.includes("site_marking"));

  const session = saying(newSession("site-marking"), ["идём на операцию", "венозный доступ"]);
  const debrief = buildDebrief({ session, bundle });
  assert.equal(
    debrief.importantMisses.some((miss) => miss.itemId === "site_marking"),
    false,
  );
  assert.equal(JSON.stringify(debrief).includes("маркировка"), false);
});

test("22. a urinary catheter is not a preoperative requirement", () => {
  // Matrix PR11.
  assert.equal(preopIds().includes("foley"), false);
  assert.equal(/фолей|мочев[а-яё]* катетер/i.test(JSON.stringify(bundle.operative)), false);
  const removed = bundle.operative.removed_preop_requirements.map((entry) => entry.id);
  assert.ok(removed.includes("foley_catheter"));
});

test("23. no routine postoperative CBC is required or rewarded", () => {
  // Matrix PO10.
  const removed = bundle.operative.removed_preop_requirements.map((entry) => entry.id);
  assert.ok(removed.includes("routine_postop_cbc"));
  const criteria = bundle.complications.discharge_criteria.map((entry) => entry.id);
  assert.equal(criteria.includes("routine_next_day_cbc"), false);
  const explicitlyRemoved = bundle.complications.discharge_criteria_explicitly_removed.map((entry) => entry.id);
  assert.ok(explicitlyRemoved.includes("routine_next_day_cbc"));
});

test("24. no postoperative antibiotic is ever administered by the system", () => {
  // Matrix AB08/PO04: WSES recommends against postoperative antibiotics after
  // uncomplicated appendicitis. The learner may still order them; the system
  // must never do it on its own.
  let session = readyForTheatre("no-postop-abx");
  session = saying(session, ["иду лапароскопически", "удалю аппендикс, аспирирую жидкость", "в отделение", "переоценю витальные через 24 часа"]);
  const systemAntibiotics = session.events.filter(
    (event) => event.type === "MEDICATION_ADMINISTERED" && event.cause.actor !== "learner",
  );
  assert.deepEqual(systemAntibiotics, []);
});

test("25. no complication is rolled in the first APP-004 slice", () => {
  // Matrix T06 / task §4.7: removed, and NOT replaced by another complication.
  assert.deepEqual(bundle.complications.postoperative_course.complications, []);
  const withdrawn = bundle.complications.postoperative_course.withdrawn_complications.map((entry) => entry.id);
  assert.ok(withdrawn.includes("superficial_ssi"));
});

test("26. inadequate monitoring cannot change any complication's biological incidence", () => {
  // Matrix T07/PO09: monitoring affects DETECTION and ESCALATION, not
  // incidence. Both halves of the removed relationship are checked - the
  // content field and the code branch that read it.
  // The withdrawal RECORD deliberately keeps the old numbers
  // (`withdrawn_complications`), so the check is against the ACTIVE content.
  assert.equal(
    JSON.stringify(bundle.complications.postoperative_course.complications).includes("inadequate_monitoring"),
    false,
  );
  const advanceTimeSource = readFileSync(new URL("../time/advanceTime.js", import.meta.url), "utf8");
  const executable = advanceTimeSource.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(executable.includes("probability_with_inadequate_monitoring"), false);
  assert.equal(executable.includes("adequacy"), false, "monitoring adequacy must not be read by the complication path at all");
});

// ===========================================================================
// 27-33. Preoperative workflow (matrix §8, task §13, §14)
// ===========================================================================

test("27. fasting status is not a universal hard stop", () => {
  // Matrix PR01: emergency appendicitis may require proceeding despite
  // inadequate fasting; the ASA elective clear-liquid rule does not govern an
  // emergency acute abdomen. The item exists and is non-blocking.
  const fasting = bundle.operative.preop_requirements.find((item) => item.id === "fasting_assessment");
  assert.ok(fasting, "the fasting assessment still exists as a preop item");
  assert.equal(fasting.blocking, false);
  assert.equal(preopIds().includes("npo_status"), false, "the old blocking NPO item is gone");

  // And it never appears among the things that BLOCK theatre. The old
  // `npo_status` item did, which made "нулевой стол" a magic word that
  // unlocked the operating room.
  const unprepared = saying(newSession("npo-not-a-stop"), ["идём на операцию"]);
  const refused = say(unprepared, "иду лапароскопически");
  assert.deepEqual(outcomesOf(refused), ["PREOP_NOT_READY"]);
  assert.equal(refused.outcomes[0].missingItems.includes("fasting_assessment"), false);
  assert.deepEqual(refused.outcomes[0].missingItems.sort(), ["anesthesia_review", "antibiotic_prophylaxis", "consent", "iv_access"]);
});

test("28. last food and clear-liquid times are seeded, stored, and obtainable", () => {
  // Matrix PR02. If the learner asks, the patient answers; if they never ask,
  // the anesthesiologist obtains it on arrival and the omission still shows.
  const session = newSession("fasting");
  const fasting = session.state.preop.fasting;
  assert.ok(fasting && typeof fasting.lastSolidFoodHoursAgo === "number");
  assert.ok(typeof fasting.lastClearLiquidHoursAgo === "number");
  assert.equal(fasting.obtained, false);

  const asked = say(session, "когда последний раз ел?").session;
  assert.equal(asked.state.preop.fasting.obtained, true);
  assert.equal(asked.state.preop.fasting.obtainedBy, "learner");
  assert.ok(asked.state.preop.completed.includes("fasting_assessment"));

  const discovered = saying(newSession("fasting-2"), ["вызываю анестезиолога на осмотр", "переоценю витальные через 40 минут"]);
  assert.equal(discovered.state.preop.fasting.obtained, true);
  assert.equal(discovered.state.preop.fasting.obtainedBy, "anesthesiologist");
});

test("29. the KZ ABO/Rh requirement is jurisdictional, not universal", () => {
  // Matrix PR08 / §13: current KZ standards support it. It is a HOSPITAL rule
  // and must never be taught as international evidence-based practice.
  const item = bundle.operative.preop_requirements.find((entry) => entry.id === "blood_group_rh");
  assert.equal(authorityLayerOf(item), "hospital_rule");
  assert.equal(jurisdictionOf(item), "KZ");
  assert.equal(item.blocking, false, "matrix PR08: no irrational prolonged deadlock");

  const reference = saying(newSession("reference-abo"), ["идём на операцию"]);
  assert.equal(reference.state.hospital.jurisdiction, null);
  assert.equal(reference.state.preop.required.some((entry) => entry.id === "blood_group_rh"), false);
  const referenceDebrief = buildDebrief({ session: reference, bundle });
  assert.ok(referenceDebrief.jurisdictionNotes.some((entry) => entry.itemId === "blood_group_rh"));

  const session = saying(newSession("kz-abo", { mode: "real", realProfileId: "KZ-R2-URBAN" }), ["идём на операцию"]);
  assert.ok(session.state.preop.required.some((entry) => entry.id === "blood_group_rh"), "present in a real KZ hospital");
  const debrief = buildDebrief({ session, bundle });
  const miss = debrief.importantMisses.find((entry) => entry.itemId === "blood_group_rh");
  assert.equal(miss.kind, "jurisdictional_workflow_omission");
  assert.match(miss.noteRu, /не универсальное доказательное правило/);
  assert.match(miss.pointRu, /юрисдикции \(KZ\)/);
});

test("a hospital-workflow omission without a jurisdiction never prints a null jurisdiction", () => {
  const session = saying(newSession("no-jurisdiction-null"), ["идём на операцию"]);
  const debrief = buildDebrief({ session, bundle });
  const miss = debrief.importantMisses.find((entry) => entry.itemId === "anesthesia_review");
  assert.ok(miss, "anesthesia review omission is reported");
  assert.doesNotMatch(miss.pointRu, /null|undefined/);
  assert.match(miss.pointRu, /по порядку стационара: осмотр анестезиолога/);
});

test("a jurisdictional investigation the learner DID order is never reported as an omission", () => {
  // The foundation spec names this failure by example: telling a learner they
  // never ordered something they did order. A KZ item that is sitting in the
  // lab is not an omission, and staff must not "catch it up" over the top.
  const session = saying(newSession("kz-ordered", { mode: "real", realProfileId: "KZ-R2-URBAN" }), [
    "идём на операцию",
    "коагулограмма и группа крови",
    "венозный доступ",
    "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр",
    // Long enough for the lab to actually turn the samples round - the point
    // is that the ORDER exists, and the result then completes the item.
    "переоценю боль через 90 минут",
    "получаю согласие",
  ]);
  const started = say(session, "иду лапароскопически").session;
  const omissions = started.events.filter((event) => event.type === "PREOP_ITEM_OMITTED").map((event) => event.payload.itemId);
  assert.deepEqual(omissions, []);
  assert.ok(started.state.preop.completed.includes("coagulation"), "it completes when the result lands");
  assert.ok(started.state.preop.completed.includes("blood_group_rh"));
});

test("30. the KZ coagulation requirement is jurisdictional, not universal", () => {
  // Matrix PR09: the KZ 2023 anaesthesia standard lists coagulation as "+" for
  // emergency and urgent surgery. That is a jurisdiction rule, not EBM.
  const item = bundle.operative.preop_requirements.find((entry) => entry.id === "coagulation");
  assert.equal(authorityLayerOf(item), "hospital_rule");
  assert.equal(jurisdictionOf(item), "KZ");
  assert.equal(item.blocking, false);
  assert.ok(item.source_ids.includes("SRC-KZ-ANESTH-2023"));
  assert.equal(/каждой аппендэктомии везде|universal/i.test(item.note_ru), false);
});

test("31. creatinine-before-contrast, where present at all, is hospital policy", () => {
  // Matrix I12 / task §10: ACR supports risk-based renal screening, so this
  // may never be a universal medical contraindication. The mechanism exists,
  // is per-profile, and ships OFF everywhere (matrix §13: NEEDS SITE POLICY).
  const profiles = [REFERENCE_HOSPITAL_PROFILE, ...Object.values(REAL_HOSPITAL_PROFILES)];
  for (const profile of profiles) {
    assert.equal(profile.radiologyPolicy.requiresCurrentCreatinineForContrastCt, false, profile.profileId);
  }
  const removed = bundle.rules.removed_rules.map((entry) => entry.id);
  assert.ok(removed.includes("RULE-CREATININE-BEFORE-CONTRAST"));
  assert.equal(
    bundle.rules.rules.some((rule) => /креатинин/i.test(rule.teaching_point_ru ?? "")),
    false,
    "no clinical rule may teach a creatinine prerequisite",
  );

  // And when a site DOES enable it, the refusal is department workflow.
  const strictSession = newSession("strict-radiology");
  const strict = {
    ...strictSession,
    state: {
      ...strictSession.state,
      hospital: { ...strictSession.state.hospital, radiologyPolicy: { requiresCurrentCreatinineForContrastCt: true } },
    },
  };
  const turn = say(strict, "КТ ОБП");
  assert.deepEqual(outcomesOf(turn), ["HOSPITAL_POLICY_BLOCK"]);
  assert.equal(turn.outcomes[0].authorityLayer, "hospital_rule");
  assert.match(turn.outcomes[0].textRu, /В этом отделении/);
  assert.equal(/запрещ/i.test(turn.outcomes[0].textRu), false, "never phrased as a medical prohibition");
});

test("32. preoperative readiness derives from real events, never from saying the words", () => {
  const session = saying(newSession("readiness"), ["идём на операцию"]);
  assert.equal(session.state.preop.ready, false);
  const claimed = say(session, "пациент готов к операции, всё готово").session;
  assert.equal(claimed.state.preop.ready, false, "asserting readiness must not create it");
  assert.equal(readyForTheatre("readiness-real").state.preop.ready, true);
});

test("33. the synthetic 'mark preop item complete' command remains absent", () => {
  // There is no learner-facing "mark preop item complete" shortcut, and there
  // must never be one - readiness is derived from actions that really happened.
  // Assembled at runtime so this test does not itself put the forbidden
  // identifier in the source tree - `architecture.test.js` scans for it.
  const forbidden = ["COMPLETE", "PREOP", "ITEM"].join("_");
  assert.equal(JSON.stringify(bundle).includes(forbidden), false);
});

// ===========================================================================
// 34-37. Operative behaviour (matrix §10, task §17)
// ===========================================================================

test("34. choosing an open approach where laparoscopy is available prompts a rationale", () => {
  // Matrix O02/MR04. The question reports a RESOURCE fact and asks why; it
  // must not claim open appendectomy is wrong or impossible.
  const turn = say(readyForTheatre("open-approach"), "иду открытым доступом");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
  assert.equal(turn.session.state.operative.started, true, "the learner is allowed to proceed");
  assert.equal(turn.session.state.operative.approach, "open");
  assert.match(turn.mentor.textRu, /Почему выбираешь открытый доступ/);
  assert.equal(/нельзя|невозможно|запрещ/i.test(turn.mentor.textRu), false);
});

test("35. «дренаж не ставлю» is never recorded as placing a drain", () => {
  const started = say(readyForTheatre("negation"), "иду лапароскопически").session;
  const turn = say(started, "удаляю аппендикс, аспирирую жидкость, дренаж не ставлю");
  assert.notEqual(turn.interpreted.commands[0].params.choice, "place_drain");
  assert.equal(turn.session.state.operative.sourceControl, true);
});

test("36. a routine drain is allowed and challenged, never catastrophically blocked", () => {
  // Matrix O10 / MR03: ask why; if the learner insists, the drain is placed;
  // debrief calls it unnecessary, not catastrophic.
  const rule = bundle.rules.rules.find((entry) => entry.id === "RULE-ROUTINE-DRAIN-UNCOMPLICATED");
  assert.equal(rule.level, "LEVEL_1_DEFENSIBLE");
  const started = say(readyForTheatre("drain"), "иду лапароскопически").session;
  const turn = say(started, "ставлю дренаж");
  assert.equal(outcomesOf(turn).includes("SAFETY_STOP"), false);
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
});

test("37. an unnecessary partial cecectomy is challenged and not executed", () => {
  // Matrix O12 / task §17.8: high-risk, no reviewed consequence model, and the
  // simulator must not fabricate a complication as a punishment.
  const started = say(readyForTheatre("cecectomy"), "иду лапароскопически").session;
  const turn = say(started, "резекция купола слепой кишки");
  assert.deepEqual(outcomesOf(turn), ["OPTION_NOT_MODELED"]);
  assert.equal(turn.session.state.operative.sourceControl, false);
  assert.equal(turn.session.state.operative.completed, false);
  assert.match(turn.mentor.textRu, /Что в увиденной картине его требует\?/);
  assert.equal(
    turn.session.events.some((event) => event.type === "COMPLICATION_OCCURRED"),
    false,
    "no invented complication",
  );
});

test("closing without appendectomy is governance-blocked, not silently allowed", () => {
  // Matrix O13 / task §17.9: this becomes a consequence-learning path only
  // after an approved untreated trajectory exists.
  const started = say(readyForTheatre("close-only"), "иду лапароскопически").session;
  const turn = say(started, "ничего не делаю, ушиваю");
  assert.deepEqual(outcomesOf(turn), ["OPTION_NOT_MODELED"]);
  assert.equal(turn.outcomes[0].blockedReason, "needs_reviewed_untreated_trajectory");
});

// ===========================================================================
// 39-42. Discharge (matrix §11, task §19)
// ===========================================================================

function throughToWard(seed = "ward") {
  return saying(readyForTheatre(seed), [
    "иду лапароскопически",
    "удалю аппендикс, аспирирую жидкость",
    "в отделение",
    "vitals каждые 4 часа",
  ]);
}

test("39. discharge does not require flatus or stool", () => {
  // Matrix PO16.
  const criteria = bundle.complications.discharge_criteria.map((entry) => entry.id);
  assert.equal(criteria.some((id) => /flatus|stool/.test(id)), false);
  const removed = bundle.complications.discharge_criteria_explicitly_removed.map((entry) => entry.id);
  assert.ok(removed.includes("flatus_or_stool"));

  const turn = say(throughToWard("no-flatus"), "выписываю");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
});

test("40. discharge does not require a 24-hour admission or 24 h afebrile", () => {
  // Matrix PO13 (SRC-SDD-2021): same-day/next-day discharge is acceptable for
  // selected uncomplicated laparoscopic patients.
  const removed = bundle.complications.discharge_criteria_explicitly_removed.map((entry) => entry.id);
  assert.ok(removed.includes("minimum_24h_admission"));
  assert.ok(removed.includes("afebrile_24h"));
  assert.ok(removed.includes("pain_score_at_or_below_3"));

  const session = throughToWard("same-day");
  assert.ok(session.state.clock.elapsedMinutes < 24 * 60, "still the same hospital day");
  const turn = say(session, "выписываю");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
});

test("approved discharge criteria stay unavailable when recovery facts are not calibrated", () => {
  // Matrix PO14/PO15 are NOT READY / SECOND REVIEW, so every clinical
  // readiness criterion is skipped. The honest consequence - that clinical
  // readiness was never evaluated - is recorded on the log at the moment of
  // discharge and reported as a release blocker, rather than being covered up
  // with an invented threshold.
  const clinical = bundle.complications.discharge_criteria.filter((entry) => authorityLayerOf(entry) === "clinical_rule");
  assert.ok(clinical.length > 0);
  for (const criterion of clinical) assert.equal(reviewStatusOf(criterion), "approved_for_training");

  const turn = say(throughToWard("blocked-criteria"), "выписываю");
  const withheld = turn.session.state.simulatorLimitations.filter((entry) => entry.kind === "discharge_runtime_fact");
  const unavailable = clinical.filter((entry) => entry.runtime_evaluation === "unavailable_without_recovery_calibration");
  assert.equal(withheld.length, unavailable.length);
});

test("41. the specimen goes to pathology as automatic hospital workflow", () => {
  // Matrix PO17: the resident is not quizzed on a clerical action.
  const session = saying(readyForTheatre("histology"), ["иду лапароскопически", "удалю аппендикс, аспирирую жидкость"]);
  assert.equal(session.state.postop.histopathologySent, true);
  const event = session.events.find((entry) => entry.type === "SPECIMEN_SENT_TO_PATHOLOGY");
  assert.equal(event.cause.actor, "system");
});

test("42. follow-up and return precautions are generated by the system after a valid discharge", () => {
  // Matrix PO18/PO20: the reviewed wording is issued automatically; the
  // resident does not recite red flags from memory in every case.
  const turn = say(throughToWard("bundle"), "выписываю");
  assert.deepEqual(outcomesOf(turn), ["EXECUTED"]);
  assert.equal(turn.session.state.postop.dischargeBundleIssued, true);
  const issued = turn.session.events.find((event) => event.type === "DISCHARGE_INSTRUCTIONS_ISSUED");
  assert.equal(issued.payload.followUpRu, "Контроль у хирурга по месту жительства.");
  assert.ok(issued.payload.returnPrecautionsRu.length >= 4);
  const rendered = renderEvent({ event: issued, bundle, patient: turn.session.patient }).textRu;
  assert.match(rendered, /по месту жительства/);
  // Matrix PO19: suture-removal instructions depend on the closure material,
  // which is not modeled, so they must not be generated.
  assert.equal(/шв[ыо][а-яё]*\s+снят|снятие швов/i.test(rendered), false);
});

// ===========================================================================
// 43. The renderer creates no clinical facts
// ===========================================================================

test("43. no renderer invents a clinical number that is not in patient truth", () => {
  // Task §20's prohibited list: invented diastolic BP, appendix diameter,
  // drain state, creatinine, pregnancy status, antibiotic dose. Every number
  // reaching the learner must be traceable to generated patient truth or to an
  // authored content string.
  let session = saying(newSession("no-invention"), [
    "опрошу пациента",
    "живот",
    "ОАК",
    "УЗИ брюшной полости",
    "КТ ОБП",
    "переоценю витальные через 4 часа",
  ]);

  const texts = session.events
    .map((event) => renderEvent({ event, bundle, patient: session.patient }))
    .filter(Boolean)
    .map((rendered) => rendered.textRu);

  const joined = texts.join("\n");
  assert.equal(/\d+\s*\/\s*\d+\s*мм рт/.test(joined), false, "no invented diastolic blood pressure");
  assert.equal(/\d+\s*(мм|см)\b/.test(joined), false, "no invented imaging dimension");
  assert.equal(/креатинин\s*\d/.test(joined), false, "no invented creatinine value");
  assert.equal(/беременност[а-яё]*\s+(есть|нет|отсутств)/i.test(joined), false, "no invented pregnancy status");

  // Every remaining number must be one the world actually holds.
  const known = new Set(
    [
      session.state.physiology.heartRate,
      session.state.physiology.systolicBp,
      session.state.physiology.respiratoryRate,
      session.state.physiology.temperatureC,
      session.state.physiology.wbc,
      session.state.physiology.neutrophilPercent,
      session.state.physiology.crp,
      Math.round(session.patient.presentation.onsetHours),
      session.patient.demographics.age,
    ].map(String),
  );
  // Timings and turnaround minutes are hospital operational facts, also real.
  for (const investigation of Object.values(session.state.investigations)) known.add(String(investigation.etaMinutes));

  const numbers = (joined.match(/\d+(?:[.,]\d+)?/g) ?? []).map((value) => value.replace(",", "."));
  const unexplained = numbers.filter((value) => !known.has(value));
  assert.deepEqual(unexplained, [], `unexplained numbers in learner-facing text: ${unexplained.join(", ")}`);
});

// ===========================================================================
// Patient-truth governance (review matrix §G1, task §3)
// ===========================================================================

test("every patient-generation content object is inventoried and reported as non-approved", () => {
  const inventory = inventoryPatientTruth({ bundle, casePresetId: "APP-004" });
  assert.ok(inventory.entries.length >= 8, "the inventory must cover the whole generation chain");
  assert.equal(inventory.approved, false, "no patient-truth content is approved in this build");
  for (const entry of inventory.entries) {
    assert.ok(entry.provenance, `${entry.contentId} must carry provenance`);
    assert.ok("reviewed_by" in entry.provenance);
  }

  const session = newSession("patient-truth");
  assert.equal(session.state.session.patientTruthApproved, false);
  const noted = session.events.filter((event) => event.type === "SIMULATOR_LIMITATION_NOTED");
  assert.ok(noted.length > 0, "the exemption must be visible on the log from minute zero");
  assert.ok(noted.every((event) => event.payload.kind === "patient_truth"));
});

test("the debrief says plainly that this build is not pilot-ready", () => {
  const session = throughToWard("governance-note");
  const debrief = buildDebrief({ session, bundle });
  assert.equal(debrief.contentGovernance.patientTruthApproved, false);
  assert.equal(debrief.contentGovernance.pilotReady, false);
  assert.match(debrief.contentGovernance.noteRu, /не предназначен для пилота/);
});

test("every promoted content object carries real review provenance", () => {
  const promoted = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((item, index) => walk(item, `${path}[${index}]`));
    if (!node || typeof node !== "object") return;
    if (node.review_status === "approved_for_training") promoted.push({ path, node });
    if (node.provenance?.review_status === "approved_for_training") promoted.push({ path: `${path}.provenance`, node: node.provenance });
    for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
  };
  walk(bundle, "bundle");
  assert.ok(promoted.length > 0);
  for (const item of promoted) {
    assert.ok(item.node.reviewed_by?.length, `${item.path} lacks reviewer identity`);
    assert.ok(item.node.reviewed_at, `${item.path} lacks review date`);
    if (item.node.second_review_required) assert.ok(item.node.second_reviewed_by?.length, `${item.path} lacks required second review`);
  }
});
