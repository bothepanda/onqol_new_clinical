import test from "node:test";
import assert from "node:assert/strict";
import { createV3Case } from "../v3/caseFactory.js";
import {
  REQUIRED_COUNTS,
  V35_CONTENT_VERSION,
  v35Manifest,
  v35Readiness,
  validateV35Manifest,
} from "../v35/manifest.js";
import {
  CASE_PRESETS,
  PHENOTYPES,
  PHENOTYPE_IDS,
  POPULATION_BLOOD,
  V35_MODIFIERS,
  learnerSelectablePresets,
  presetsById,
  resolvePreset,
} from "../v35/phenotypes.js";
import { ALTERNATIVE_DISEASES, alternativesFor, facultyPreview } from "../v35/alternatives.js";
import { PATH_STATES, STABLE_PATH } from "../v35/pathStates.js";
import { ACTION_CONTRACTS } from "../v35/actionContracts.js";
import {
  INSTABILITY_RULES,
  LOAD_COMPOSITION,
  coherenceViolations,
  generatePatient,
  MORPHOLOGY_PROFILES,
  latentClinicalState,
} from "../v35/patientGenerator.js";
import { SCORING_CONTRACT, WHO_CHECKPOINTS, scorableByDomain } from "../v35/scoringContract.js";
import { selectV35Case, selectionEvent } from "../v35/sessionSelector.js";
import { localeReadiness } from "../v35/locale.js";

const v3Case = createV3Case();

// --- completeness (addendum 14) -------------------------------------------

test("the manifest carries 5 phenotypes, 5 presets, 8 alternatives, 16 states, 32 contracts", () => {
  assert.equal(PHENOTYPE_IDS.length, REQUIRED_COUNTS.phenotypes);
  assert.equal(CASE_PRESETS.length, REQUIRED_COUNTS.case_presets);
  assert.equal(ALTERNATIVE_DISEASES.length, REQUIRED_COUNTS.alternative_diseases);
  assert.equal(PATH_STATES.length, REQUIRED_COUNTS.path_states);
  assert.equal(ACTION_CONTRACTS.length, REQUIRED_COUNTS.action_contracts);
});

test("the manifest validates against the real case, with every reference resolving", () => {
  const result = validateV35Manifest(v3Case);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("every transition and stable-path step resolves", () => {
  const stateIds = new Set(PATH_STATES.map((state) => state.state_id));
  for (const state of PATH_STATES) {
    for (const target of state.allowed_transitions) {
      assert.ok(stateIds.has(target), `${state.state_id} -> ${target}`);
    }
  }
  assert.equal(STABLE_PATH.at(-1), "complete");
  assert.ok(STABLE_PATH.includes("discharge"));
});

// --- layers are separate (owner correction 1) -----------------------------

test("a preset is a composition of layers, not a phenotype", () => {
  // APP-002 was "классический аппендицит у женщины репродуктивного возраста":
  // a phenotype and a modifier welded together. Unwelded.
  const preset = presetsById.get("APP-002");
  assert.equal(preset.case_preset_id, "APP-002");
  assert.equal(preset.phenotype_id, "classic");
  assert.deepEqual(preset.population_modifier_ids, ["MOD-PREGNANCY-POSSIBLE"]);
  assert.equal(preset.morphology, "uncomplicated_inflammation");
  assert.equal(preset.trajectory_id, "TRJ-STABLE");
  assert.ok(preset.resource_profile_id);

  // The phenotype itself knows nothing about reproductive age.
  assert.equal(JSON.stringify(PHENOTYPES.classic).includes("репродуктив"), false);
});

test("every preset resolves to declared layers", () => {
  for (const preset of CASE_PRESETS) {
    const resolved = resolvePreset(preset.case_preset_id);
    assert.equal(resolved.phenotype.phenotype_id, preset.phenotype_id);
    assert.equal(resolved.modifiers.length, preset.population_modifier_ids.length);
  }
});

// --- alternatives are disease stubs, not "mimic entities" (correction 2) ---

test("no entry is typed as a mimic; the mimic is the relationship", () => {
  for (const entry of ALTERNATIVE_DISEASES) {
    assert.equal(entry.entity_type, undefined, `${entry.alternative_id} must not carry an entity type`);
    assert.ok(entry.disease_card_id.startsWith("DIS-"));
    assert.ok(entry.presentation_relationships.length > 0);
  }

  // All eight hang off RLQ pain as alternatives.
  assert.equal(alternativesFor("PRES-RLQ-PAIN").length, 8);
});

test("the same disease card is an alternative here and the hidden truth elsewhere", () => {
  // Master plan 2: this is the reason "mimic" cannot be a type.
  const ulcer = ALTERNATIVE_DISEASES.find((entry) => entry.alternative_id === "ALT-PERF-ULCER-001");
  assert.equal(ulcer.disease_card_id, "DIS-PERFORATED-PUD");
  const roles = Object.fromEntries(
    ulcer.presentation_relationships.map((link) => [link.presentation_id, link.relationship])
  );
  assert.equal(roles["PRES-RLQ-PAIN"], "may_mimic");
  assert.equal(roles["PRES-EPIGASTRIC-PAIN"], "principal_hidden_truth");

  const ectopic = ALTERNATIVE_DISEASES.find((entry) => entry.alternative_id === "ALT-ECTOPIC-001");
  const ectopicRoles = Object.fromEntries(
    ectopic.presentation_relationships.map((link) => [link.presentation_id, link.relationship])
  );
  assert.equal(ectopicRoles["PRES-PELVIC-PAIN"], "principal_hidden_truth");
});

test("alternatives stay inactive and admit what they are missing", () => {
  for (const entry of ALTERNATIVE_DISEASES) {
    assert.equal(entry.runtime_status, "disease_stub_inactive");
    assert.equal(entry.eligible_for_scoring, false);
    assert.ok(entry.missing_for_authoring.includes("deterministic_findings"));
    assert.match(facultyPreview(entry).inactivity_reason_ru, /\S/);
  }
});

// --- A1/A5 selection -------------------------------------------------------

test("the learner randomizer selects only the four active presets", () => {
  const selectable = learnerSelectablePresets().map((preset) => preset.case_preset_id);
  assert.deepEqual(selectable, ["APP-001", "APP-002", "APP-003", "APP-004"]);

  for (let index = 0; index < 200; index += 1) {
    const { preset } = selectV35Case({ seed: `learner-${index}` });
    assert.ok(selectable.includes(preset.case_preset_id));
    assert.notEqual(preset.case_preset_id, "APP-005");
  }
});

test("APP-005 is unreachable from learner mode and reachable by faculty", () => {
  assert.throws(
    () => selectV35Case({ seed: "s", requestedPresetId: "APP-005", mode: "learner" }),
    /faculty_preview/
  );
  const { preset } = selectV35Case({ seed: "s", requestedPresetId: "APP-005", mode: "faculty" });
  assert.equal(preset.case_preset_id, "APP-005");
});

test("the same effective seed reproduces the same case", () => {
  const first = selectV35Case({ seed: "repro-1" });
  const second = selectV35Case({ seed: "repro-1" });
  assert.deepEqual(second.patient, first.patient);
  assert.equal(second.selection.effective_seed, first.selection.effective_seed);

  // And replaying the effective seed against its preset reproduces the patient
  // even when repeat avoidance moved the selection.
  const replay = generatePatient(first.preset.case_preset_id, first.selection.effective_seed);
  assert.deepEqual(replay, first.patient);
});

test("immediate repeat avoidance works and records why the seed changed", () => {
  const first = selectV35Case({ seed: "avoid-1" });
  const second = selectV35Case({ seed: "avoid-1", previousPresetId: first.preset.case_preset_id });

  assert.notEqual(second.preset.case_preset_id, first.preset.case_preset_id);
  assert.equal(second.selection.requested_seed, "avoid-1");
  assert.notEqual(second.selection.effective_seed, "avoid-1");
  assert.ok(second.selection.attempts.some((attempt) => attempt.rejected_because === "immediate_repeat"));

  // The event log carries both seeds and no free text.
  const event = selectionEvent(second.selection);
  assert.equal(event.requested_seed, "avoid-1");
  assert.equal(event.effective_seed, second.selection.effective_seed);
  assert.ok(event.selection_attempts.length > 0);
});

test("the generator itself is pure: it never sees the previous case", () => {
  // Repeat avoidance lives in the selector. If it leaked into the generator,
  // "same seed, same case" would stop being true.
  const a = generatePatient("APP-002", "purity");
  const b = generatePatient("APP-002", "purity");
  assert.deepEqual(a, b);
});

// --- A2 coherent cluster (owner correction 4) ------------------------------

test("morphology is categorical truth, not a point on a severity line", () => {
  // Surgeon's correction: an abscess is not 62% of the way to a peritonitis.
  assert.equal(LOAD_COMPOSITION.morphology_distribution, undefined, "scalar centres are gone");
  assert.equal(LOAD_COMPOSITION.morphology, undefined);

  // Each morphology names a profile whose latents are separate variables.
  for (const id of ["uncomplicated_inflammation", "abscess", "perforation", "diffuse_peritonitis"]) {
    const profile = MORPHOLOGY_PROFILES[id];
    assert.equal(profile.morphology, id, "the category is carried, not converted to a number");
    assert.ok(profile.inflammatory_burden);
    assert.ok(profile.organ_dysfunction);
  }

  // A contained abscess carries a high inflammatory burden and NO organ
  // dysfunction - which a single severity scalar cannot express.
  assert.equal(MORPHOLOGY_PROFILES.abscess.organ_dysfunction.possible, false);
  assert.ok(
    MORPHOLOGY_PROFILES.abscess.inflammatory_burden.centre >
      MORPHOLOGY_PROFILES.uncomplicated_inflammation.inflammatory_burden.centre
  );
  assert.equal(MORPHOLOGY_PROFILES.diffuse_peritonitis.organ_dysfunction.possible, true);
});

test("the latent state keeps burden, organ dysfunction and trajectory apart", () => {
  const draw = () => 0.5;
  const latent = latentClinicalState({
    morphology: "uncomplicated_inflammation",
    hoursFromOnset: 13,
    trajectoryId: "TRJ-STABLE",
    draw,
  });
  assert.equal(latent.morphology, "uncomplicated_inflammation");
  assert.equal(latent.organ_dysfunction, 0, "uncomplicated inflammation has none");
  assert.equal(latent.hours_from_onset, 13);
  assert.ok(latent.inflammatory_burden > 0 && latent.inflammatory_burden < 1);

  // Time is absolute: later means a higher burden, whatever the phenotype.
  const later = latentClinicalState({
    morphology: "uncomplicated_inflammation",
    hoursFromOnset: 30,
    trajectoryId: "TRJ-STABLE",
    draw,
  });
  assert.ok(later.inflammatory_burden > latent.inflammatory_burden);
});

test("a raised shock index is a mismatch signal, not a definition of shock", () => {
  // Koch et al. 2019. Hard instability is a pressure failure and only that.
  assert.equal(INSTABILITY_RULES.hard.shock_index_at_or_above, undefined);
  assert.equal(INSTABILITY_RULES.hard.systolic_below, 90);
  assert.equal(INSTABILITY_RULES.hard.mean_arterial_pressure_below, 65);
  assert.equal(INSTABILITY_RULES.physiologic_mismatch.shock_index_at_or_above, 1.0);
});

test("the burden distribution puts p5-p95 in the central band of the envelope", () => {
  const burdens = [];
  let seed = 1;
  const draw = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let index = 0; index < 20000; index += 1) {
    burdens.push(
      latentClinicalState({
        morphology: "uncomplicated_inflammation",
        hoursFromOnset: draw() * 24,
        trajectoryId: "TRJ-STABLE",
        draw,
      }).inflammatory_burden
    );
  }
  burdens.sort((a, b) => a - b);
  const p5 = burdens[Math.floor(burdens.length * 0.05)];
  const p95 = burdens[Math.floor(burdens.length * 0.95)];
  assert.ok(p5 > 0.05 && p5 < 0.25, `p5 was ${p5.toFixed(3)}`);
  assert.ok(p95 > 0.72 && p95 < 0.95, `p95 was ${p95.toFixed(3)}`);
});

test("the phenotype never changes physiology at matched inputs", () => {
  // The matched counterfactual the surgeon asked for: same morphology, same
  // absolute hours, same trajectory, same draw. Only the phenotype differs.
  const inputs = (draw) => ({
    morphology: "uncomplicated_inflammation",
    hoursFromOnset: 13,
    trajectoryId: "TRJ-STABLE",
    draw,
  });
  const fixed = () => 0.5;
  const reference = latentClinicalState(inputs(fixed));

  // The latent state is phenotype-free by construction: `latentClinicalState`
  // has no phenotype parameter at all. That is the guarantee, and it is
  // structural rather than measured.
  assert.equal(Object.keys(reference).includes("phenotype_id"), false);
  for (const phenotypeId of ["classic", "pelvic", "retrocecal"]) {
    assert.ok(PHENOTYPES[phenotypeId], phenotypeId);
    const again = latentClinicalState(inputs(fixed));
    assert.deepEqual(again, reference, `${phenotypeId} must not alter the latent state`);
  }
});

test("no learner-facing preset ever ships hard instability", () => {
  // Surgeon's requirement: APP-001..004 are stable or in pain, never shocked.
  // The authored envelopes for pelvic and retrocecal do permit a shock index at
  // or above 1 at the extreme, so the guarantee is enforced by rejection: the
  // selector reseeds rather than shipping such a patient.
  for (const preset of learnerSelectablePresets()) {
    for (let index = 0; index < 300; index += 1) {
      const { patient } = selectV35Case({ seed: `stable-${preset.case_preset_id}-${index}`, requestedPresetId: preset.case_preset_id });
      const shockIndex = patient.vitals.heart_rate / patient.vitals.systolic_bp;
      assert.ok(patient.vitals.systolic_bp >= 90, `САД ${patient.vitals.systolic_bp}`);
      assert.ok(shockIndex < 1, `шоковый индекс ${shockIndex.toFixed(2)}`);
      assert.ok(patient.vitals.mean_arterial_pressure >= 65, `MAP ${patient.vitals.mean_arterial_pressure}`);
      assert.deepEqual(coherenceViolations(patient), []);
    }
  }
});

test("blood pressure is derived from a haemodynamic state, not from a fixed ratio", () => {
  for (const preset of learnerSelectablePresets()) {
    for (let index = 0; index < 100; index += 1) {
      const { patient } = selectV35Case({ seed: `bp-${index}`, requestedPresetId: preset.case_preset_id });
      const { systolic_bp: sbp, diastolic_bp: dbp, mean_arterial_pressure: map, pulse_pressure: pp } = patient.vitals;

      assert.ok(dbp < sbp, `ДАД ${dbp} не ниже САД ${sbp}`);
      assert.ok(map > dbp && map < sbp, `MAP ${map} вне ДАД-САД`);
      // The identities hold, within rounding.
      assert.ok(Math.abs(sbp - dbp - pp) <= 1, `пульсовое ${pp} не равно САД-ДАД`);
      assert.ok(Math.abs(map - (dbp + pp / 3)) <= 1.5, `MAP не равен ДАД + ПД/3`);
      // And the ratio is not a constant.
      assert.ok(["stable", "pain_sympathetic"].includes(patient.vitals.haemodynamic_state));
    }
  }

  // Across many patients the diastolic/systolic ratio must actually vary.
  const ratios = new Set();
  for (let index = 0; index < 200; index += 1) {
    const patient = generatePatient("APP-002", `ratio-${index}`);
    ratios.add((patient.vitals.diastolic_bp / patient.vitals.systolic_bp).toFixed(2));
  }
  assert.ok(ratios.size > 8, `expected a spread of ratios, got ${ratios.size}`);
});

test("neutrophils are generated with the white count, and ANC is derived", () => {
  for (let index = 0; index < 200; index += 1) {
    const patient = generatePatient("APP-002", `anc-${index}`);
    const expected = Math.round(patient.labs.wbc * (patient.labs.neutrophil_percent / 100) * 10) / 10;
    assert.equal(patient.labs.absolute_neutrophil_count, expected);
    // High white count and low neutrophil fraction in the same patient is what
    // independent draws produce; the shared burden must prevent it.
    if (patient.labs.wbc > 14) assert.ok(patient.labs.neutrophil_percent > 78);
  }
});

test("haemoglobin and platelets belong to the population, not to the appendix", () => {
  const byPhenotype = {};
  for (const preset of learnerSelectablePresets()) {
    byPhenotype[preset.phenotype_id] = [];
    for (let index = 0; index < 200; index += 1) {
      const patient = generatePatient(preset.case_preset_id, `hb-${index}`);
      byPhenotype[preset.phenotype_id].push(patient.labs.haemoglobin);
      const bounds = POPULATION_BLOOD.haemoglobin[patient.demographics.sex];
      assert.ok(
        patient.labs.haemoglobin >= bounds.min && patient.labs.haemoglobin <= bounds.max,
        `Hb ${patient.labs.haemoglobin} вне ${patient.demographics.sex} ${bounds.min}-${bounds.max}`
      );
      assert.ok(patient.labs.platelets >= 150 && patient.labs.platelets <= 400);
    }
  }
  // No phenotype declares a haemoglobin range any more.
  for (const phenotype of Object.values(PHENOTYPES)) {
    assert.equal(phenotype.authoring_ranges.haemoglobin, undefined);
    assert.equal(phenotype.authoring_ranges.platelets, undefined);
  }
});

test("every generated value stays inside the authored envelope, over a large sample", () => {
  for (const preset of learnerSelectablePresets()) {
    const ranges = PHENOTYPES[preset.phenotype_id].authoring_ranges;
    for (let index = 0; index < 200; index += 1) {
      const patient = generatePatient(preset.case_preset_id, `envelope-${index}`);
      for (const [key, bounds] of Object.entries(ranges)) {
        const value = patient.vitals[key] ?? patient.labs[key];
        if (value === undefined) continue;
        assert.ok(
          value >= bounds.min && value <= bounds.max,
          `${preset.case_preset_id}/${key}=${value} outside ${bounds.min}-${bounds.max}`
        );
      }
    }
  }
});

test("different seeds vary the patient, within the envelope", () => {
  const seen = new Set();
  for (let index = 0; index < 60; index += 1) {
    const patient = generatePatient("APP-002", `vary-${index}`);
    seen.add(`${patient.vitals.heart_rate}/${patient.labs.wbc}/${patient.presentation.hours_from_onset}`);
  }
  assert.ok(seen.size > 20, `expected variety, got ${seen.size} distinct patients`);
});

test("the resource profile never touches hidden physiology", () => {
  // Addendum: resource decides what help exists. A patient is the same patient
  // in a district hospital and a tertiary centre.
  const patient = generatePatient("APP-002", "resource");
  const serialized = JSON.stringify({ vitals: patient.vitals, labs: patient.labs, hidden: patient.hidden });
  for (const profile of ["KZ-R1-DISTRICT", "KZ-R2-URBAN", "KZ-R3-TERTIARY"]) {
    assert.equal(serialized.includes(profile), false);
  }
});

// --- A4 modifier decides the action set ------------------------------------

test("APP-002 always presents a woman of reproductive age with the branch", () => {
  for (let index = 0; index < 50; index += 1) {
    const patient = generatePatient("APP-002", `mod-on-${index}`);
    assert.equal(patient.demographics.sex, "female");
    assert.ok(patient.demographics.age >= 18 && patient.demographics.age <= 50);
    assert.ok(patient.enabled_action_ids.includes("pregnancy_test"));
    assert.ok(patient.enabled_dangerous_alternatives.includes("differential_ectopic"));
  }
});

test("the pregnancy branch follows the patient, not the preset", () => {
  // Owner decision: a woman of 18-50 gets the branch in EVERY preset, so no
  // preset has to keep young women out in order to stay safe. A preset that
  // never presented one would be training a different population.
  let reproductiveWomen = 0;
  let othersWithBranch = 0;

  for (const presetId of ["APP-001", "APP-003", "APP-004"]) {
    for (let index = 0; index < 150; index += 1) {
      const patient = generatePatient(presetId, `branch-${index}`);
      const { sex, age } = patient.demographics;
      const hasBranch = patient.enabled_action_ids.includes("pregnancy_test");

      assert.ok(age >= 18 && age <= 75, `age ${age} outside the adult population`);

      if (sex === "female" && age <= 50) {
        reproductiveWomen += 1;
        assert.ok(hasBranch, `женщина ${age} лет без ветви исключения беременности в ${presetId}`);
        assert.ok(patient.composition.population_modifier_ids.includes("MOD-PREGNANCY-POSSIBLE"));
      } else {
        if (hasBranch) othersWithBranch += 1;
        assert.equal(patient.hidden.pregnancy_present, null);
      }
    }
  }

  assert.ok(reproductiveWomen > 0, "presets must be able to present a young woman");
  assert.equal(othersWithBranch, 0, "men and older women must not acquire a pregnancy branch");
});

test("age is one adult population, not one per sex", () => {
  const bySex = { male: [], female: [] };
  for (let index = 0; index < 400; index += 1) {
    const patient = generatePatient("APP-004", `age-${index}`);
    bySex[patient.demographics.sex].push(patient.demographics.age);
  }
  for (const [sex, ages] of Object.entries(bySex)) {
    assert.ok(ages.length > 0, `${sex} must appear`);
    assert.ok(Math.min(...ages) < 40, `${sex}: expected young patients, min was ${Math.min(...ages)}`);
    assert.ok(Math.max(...ages) > 60, `${sex}: expected older patients, max was ${Math.max(...ages)}`);
  }
});

test("a modifier changes what must be done, not the patient's physiology", () => {
  assert.equal(V35_MODIFIERS["MOD-PREGNANCY-POSSIBLE"].physiology_delta, null);
});

// --- review flags ----------------------------------------------------------

test("the retrocecal envelope is flagged for review, not silently trusted", () => {
  // Raised by the owner: retrocecal position is not itself greater severity.
  const flag = PHENOTYPES.retrocecal.review_flag;
  assert.equal(flag.status, "NEEDS_CLINICAL_REVIEW");
  assert.match(flag.question_ru, /тяжёл|диапазон/i);

  // The envelope is higher than classic, which is exactly what needs deciding.
  assert.ok(PHENOTYPES.retrocecal.authoring_ranges.heart_rate.max > PHENOTYPES.classic.authoring_ranges.heart_rate.max);
});

test("the phenotype ranges are the addendum's, unwidened", () => {
  assert.deepEqual(PHENOTYPES.classic.authoring_ranges.heart_rate, { min: 86, max: 104 });
  assert.deepEqual(PHENOTYPES.classic.authoring_ranges.wbc, { min: 11, max: 16 });
  assert.deepEqual(PHENOTYPES.early_subtle.authoring_ranges.temperature_c, { min: 36.7, max: 37.7 });
  assert.deepEqual(PHENOTYPES.retrocecal.authoring_ranges.crp, { min: 40, max: 140 });
  assert.deepEqual(PHENOTYPES.pelvic.presentation.hours_from_onset, { min: 8, max: 24 });
});

// --- scoring contract (surgeon review section 1) --------------------------

test("the fourteen core actions carry reviewed provisional weights, and still do not score", () => {
  assert.equal(SCORING_CONTRACT.length, 14, "the count in HANDOFF was wrong; nothing was removed");

  for (const entry of SCORING_CONTRACT) {
    assert.equal(entry.clinical_review_status, "reviewed_provisional");
    // Reviewed is not live: weights await pilot calibration.
    assert.equal(entry.eligible_for_scoring, false, entry.canonical_id);
    assert.ok(entry.score_weight >= 1 && entry.score_weight <= 4);
    assert.ok(entry.criticality >= 0 && entry.criticality <= 4);
  }

  // Weight and criticality are independent: a small weight may still be a
  // critical gate. informed_consent is exactly that case.
  const consent = SCORING_CONTRACT.find((e) => e.canonical_id === "informed_consent");
  assert.equal(consent.score_weight, 2);
  assert.equal(consent.criticality, 4);
});

test("a gate has a scope, a target and a waiver - not a boolean", () => {
  const consent = SCORING_CONTRACT.find((e) => e.canonical_id === "informed_consent");
  assert.equal(consent.gate.gate_scope, "before_intervention");
  assert.deepEqual(consent.gate.blocks_action_ids, ["open_appendectomy_here"]);
  // The surgeon's example: emergency surgery on a patient without capacity.
  assert.ok(consent.gate.waiver_conditions.length > 0);

  // The WHO checklist is three gates, each with its own blocking point.
  assert.deepEqual(
    WHO_CHECKPOINTS.map((checkpoint) => checkpoint.checkpoint_id),
    ["sign_in", "time_out", "sign_out"]
  );
  assert.equal(WHO_CHECKPOINTS[0].gate_scope, "before_induction");
  assert.equal(WHO_CHECKPOINTS[1].gate_scope, "before_incision");
  assert.equal(WHO_CHECKPOINTS[2].gate_scope, "before_leaving_theatre");
});

test("uncertainty is reasoning, and sepsis and escalation are conditional", () => {
  const uncertainty = SCORING_CONTRACT.find(
    (e) => e.canonical_id === "calibrate_and_state_uncertainty"
  );
  assert.equal(uncertainty.domain, "diagnostic_reasoning", "moved out of escalation");
  assert.equal(uncertainty.leaf_action_id, "declare_uncertainty", "the engine id still resolves");
  assert.equal(uncertainty.legacy_canonical_id, "declare_uncertainty");

  for (const id of ["recognize_sepsis", "call_senior_surgeon", "call_intensive_care"]) {
    const entry = SCORING_CONTRACT.find((e) => e.canonical_id === id);
    assert.equal(entry.conditional, true, `${id} must only score when the state warrants it`);
  }
});

test("the denominator is the actions this case actually contains", () => {
  const byDomain = scorableByDomain(v3Case);
  assert.deepEqual(
    byDomain.map((row) => row.domain).sort(),
    ["communication", "diagnostic_reasoning", "escalation", "perioperative_safety"]
  );
  for (const row of byDomain) {
    assert.ok(row.max_weight >= 0);
    // Conditional entries stay out of the denominator until their condition holds.
    for (const entry of row.entries) {
      if (entry.conditional) assert.ok(!Number.isNaN(entry.score_weight));
    }
  }

  // A case that does not carry an action cannot penalise its absence.
  const stripped = { ...v3Case, acceptable_alternatives: [], expected_actions: [], unnecessary_actions: [], unsafe_actions: [] };
  for (const row of scorableByDomain(stripped)) {
    assert.deepEqual(row.entries, [], `${row.domain} must be empty for a case with no actions`);
  }
});

test("nothing added by V3.5 is eligible for scoring", () => {
  for (const contract of ACTION_CONTRACTS) assert.equal(contract.eligible_for_scoring, false);
  for (const entry of ALTERNATIVE_DISEASES) assert.equal(entry.eligible_for_scoring, false);
  assert.equal(LOAD_COMPOSITION.eligible_for_scoring, false);
  assert.equal(generatePatient("APP-002", "score").eligible_for_scoring, false);
});

test("the three reasoning contracts resolve to reasoning, never to an action", () => {
  for (const id of ["problem_representation", "diagnostic_justification", "test_justification"]) {
    const contract = ACTION_CONTRACTS.find((entry) => entry.contract_id === id);
    assert.deepEqual(contract.aliases, []);
    assert.ok(contract.reasoning_flags.length > 0);
  }
});

// --- locale contract -------------------------------------------------------

test("the locale contract counts missing keys instead of inventing Kazakh", () => {
  const readiness = localeReadiness();
  const ru = readiness.find((row) => row.locale === "ru");
  const kk = readiness.find((row) => row.locale === "kk");

  assert.equal(ru.learner_ready, true, `RU is the source locale: ${ru.missing.join(", ")}`);
  assert.equal(kk.learner_ready, false);
  assert.equal(kk.status, "pending_language_review");
  assert.ok(kk.missing.length > 0, "missing Kazakh keys must be countable, not discovered in a pilot");
});

// --- honesty about done ----------------------------------------------------

test("readiness reports a valid manifest and V3.5 as not yet done", () => {
  const readiness = v35Readiness(v3Case);
  assert.equal(readiness.content_version, V35_CONTENT_VERSION);
  assert.equal(readiness.manifest_valid, true);
  // The generator now feeds the case factory; the path states still do not
  // drive the engine, which is what keeps V3.5 from being done.
  assert.equal(readiness.generator_wired_to_case_factory, true);
  assert.equal(readiness.engine_wired, false);
  assert.ok(readiness.blocking_for_done.length > 0);
  assert.deepEqual(readiness.faculty_preview_presets, ["APP-005"]);
});

test("the manifest declares a content version, not just a label", () => {
  assert.match(V35_CONTENT_VERSION, /^3\.5\.\d+$/);
  assert.equal(v35Manifest.content_version, V35_CONTENT_VERSION);
});
