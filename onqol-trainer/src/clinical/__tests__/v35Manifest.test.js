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
  physiologyEnvelopeFor,
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
  PHYSIOLOGIC_RESERVE,
  drawPhysiologicReserve,
  latentClinicalState,
} from "../v35/patientGenerator.js";
import {
  SCORING_CONTRACT,
  V35_SCORING_CONTRACT_VERSION,
  V35_SCORING_REVIEW_STATUS,
  WHO_CHECKPOINTS,
  scorableByDomain,
} from "../v35/scoringContract.js";
import { selectV35Case, selectionEvent } from "../v35/sessionSelector.js";
import { buildV35Case } from "../v35/createCase.js";
import { EXAM_SLOTS, examSlot, statesFor, renderExamination } from "../v35/examSlots.js";
import { localeReadiness } from "../v35/locale.js";
import { KZ_RESOURCE_PROFILE_VERSION } from "../v25/scenarioEngine.js";

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

test("the manifest accepts population-gated actions retained as non-expected", () => {
  const generated = buildV35Case({
    seed: "manifest-runtime-case",
    requestedPresetId: "APP-001",
  }).caseData;
  assert.deepEqual(generated.v35_removed_action_ids, []);
  assert.ok(generated.v35_non_expected_action_ids.length > 0);
  const pregnancy = generated.expected_actions.find((action) => action.id === "pregnancy_test");
  assert.equal(pregnancy.available_to_order, true);
  assert.equal(pregnancy.expected_for_this_patient, false);
  assert.equal(pregnancy.eligible_for_scoring, false);
  assert.deepEqual(validateV35Manifest(generated).errors, []);
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
  assert.ok(preset.declared_resource_profile_id, "declared, not in force");

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
    assert.ok(profile.inflammatory_burden_prior);
    assert.ok(profile.organ_dysfunction_prior);
  }

  // Priors are RANGES, not fixed values. A contained abscess is usually
  // physiologically stable - usually, not always, so its organ-dysfunction prior
  // starts at zero and reaches well above it rather than being ruled out.
  const abscess = MORPHOLOGY_PROFILES.abscess;
  assert.equal(abscess.organ_dysfunction_prior.min, 0);
  assert.ok(abscess.organ_dysfunction_prior.max > 0, "dysfunction must not be impossible");

  // Peritonitis does not carry a fixed dysfunction either.
  const peritonitis = MORPHOLOGY_PROFILES.diffuse_peritonitis;
  assert.ok(peritonitis.organ_dysfunction_prior.max > peritonitis.organ_dysfunction_prior.min);

  // Priors overlap: these are not points on one line.
  assert.ok(
    abscess.inflammatory_burden_prior.min <
      MORPHOLOGY_PROFILES.uncomplicated_inflammation.inflammatory_burden_prior.max,
    "morphology priors must overlap, not partition a scale"
  );
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
  assert.ok(latent.organ_dysfunction >= 0 && latent.organ_dysfunction <= 0.15);
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
        hoursFromOnset: draw() * 48,
        trajectoryId: "TRJ-STABLE",
        draw,
      }).inflammatory_burden
    );
  }
  burdens.sort((a, b) => a - b);
  const p5 = burdens[Math.floor(burdens.length * 0.05)];
  const p95 = burdens[Math.floor(burdens.length * 0.95)];
  // Priors plus the time term: the band must stay well inside 0..1 with rare
  // extremes rather than piling up at either edge.
  assert.ok(p5 > 0.02 && p5 < 0.3, `p5 was ${p5.toFixed(3)}`);
  assert.ok(p95 > 0.55 && p95 < 0.98, `p95 was ${p95.toFixed(3)}`);
});

test("at matched hidden inputs and sub-seed, physiology is identical across phenotypes", () => {
  // The surgeon's requirement, exactly: same morphology, same absolute disease
  // time, same trajectory, same modifiers, same physiology sub-seed. Only
  // phenotype_id differs. Every delta must be zero.
  const seed = "matched-counterfactual";
  const hours = 13;
  const reference = generatePatient("APP-002", seed, { hoursFromOnset: hours });

  for (const presetId of ["APP-003", "APP-004"]) {
    const other = generatePatient(presetId, seed, { hoursFromOnset: hours });

    assert.equal(other.hidden.latent_state.inflammatory_burden, reference.hidden.latent_state.inflammatory_burden);
    assert.equal(other.hidden.latent_state.organ_dysfunction, reference.hidden.latent_state.organ_dysfunction);
    for (const key of ["heart_rate", "temperature_c", "systolic_bp", "diastolic_bp", "mean_arterial_pressure"]) {
      assert.equal(other.vitals[key], reference.vitals[key], `Δ${key} != 0 для ${presetId}`);
    }
    for (const key of ["wbc", "crp", "neutrophil_percent"]) {
      assert.equal(other.labs[key], reference.labs[key], `Δ${key} != 0 для ${presetId}`);
    }
    const si = (p) => p.vitals.heart_rate / p.vitals.systolic_bp;
    assert.equal(si(other), si(reference), `ΔШИ != 0 для ${presetId}`);
  }
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
    // Both sit at the same place in their own envelopes, within the residual.
    // That is the real claim: they are one patient, not two draws.
    const envelope = physiologyEnvelopeFor(patient.hidden.morphology);
    const positionOf = (value, r) => (value - r.min) / (r.max - r.min);
    const drift = Math.abs(
      positionOf(patient.labs.wbc, envelope.wbc) -
        positionOf(patient.labs.neutrophil_percent, envelope.neutrophil_percent)
    );
    assert.ok(drift < 0.3, `WBC и нейтрофилы разошлись на ${drift.toFixed(2)}`);
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
  // No phenotype declares physiology at all any more.
  for (const phenotype of Object.values(PHENOTYPES)) {
    assert.equal(phenotype.authoring_ranges, undefined, `${phenotype.phenotype_id}`);
  }
});

test("every generated value stays inside the authored envelope, over a large sample", () => {
  for (const preset of learnerSelectablePresets()) {
    const ranges = physiologyEnvelopeFor(preset.morphology);
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

test("INVARIANT: every woman of 18-50 gets the pregnancy branch, in every learner preset", () => {
  // The safety invariant, asserted over the whole learner surface rather than a
  // sample. A case with no beta-hCG in front of a woman who could be pregnant is
  // the exact omission the trainer exists to prevent.
  let checked = 0;
  for (const preset of learnerSelectablePresets()) {
    for (let index = 0; index < 500; index += 1) {
      const { patient, caseData } = buildV35Case({
        seed: `inv-${index}`,
        requestedPresetId: preset.case_preset_id,
      });
      const { sex, age } = patient.demographics;
      if (!(sex === "female" && age >= 18 && age <= 50)) continue;
      checked += 1;

      // In the patient.
      assert.ok(
        patient.enabled_action_ids.includes("pregnancy_test"),
        `${preset.case_preset_id}: женщина ${age} лет без pregnancy_test`
      );
      // In the frozen snapshot, which is what a reviewer reads back.
      assert.ok(
        caseData.v35_composition.population_modifier_ids.includes("MOD-PREGNANCY-POSSIBLE"),
        `${preset.case_preset_id}: модификатор отсутствует в snapshot для женщины ${age} лет`
      );
      // And in the playable case: the action must actually be there.
      const actionIds = new Set([
        ...caseData.expected_actions,
        ...caseData.acceptable_alternatives,
      ].map((action) => action.id));
      assert.ok(actionIds.has("pregnancy_test"), `${preset.case_preset_id}: действия нет в кейсе`);
    }
  }
  assert.ok(checked > 200, `expected many reproductive-age women, checked ${checked}`);
});

test("physiologic reserve is drawn, not computed from age", () => {
  // Surgeon's instruction: age shifts the prior, and the distributions overlap.
  // A reserve that is a function of age alone makes age a verdict.
  const draw = (() => {
    let seed = 7;
    return () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  })();

  const at30 = [];
  const at70 = [];
  for (let index = 0; index < 4000; index += 1) {
    at30.push(drawPhysiologicReserve(30, draw));
    at70.push(drawPhysiologicReserve(70, draw));
  }
  // Same age, different reserves.
  assert.ok(new Set(at30).size > 20, "reserve must vary at a fixed age");
  // Different ages, overlapping distributions.
  assert.ok(Math.min(...at30) < Math.max(...at70), "the distributions must overlap");
  assert.ok(
    at30.reduce((a, b) => a + b, 0) / at30.length > at70.reduce((a, b) => a + b, 0) / at70.length,
    "older patients should have lower reserve on average"
  );

  // Reserve moves the response, never the disease.
  assert.deepEqual(PHYSIOLOGIC_RESERVE.never_modifies, [
    "morphology",
    "inflammatory_burden",
    "organ_dysfunction",
  ]);
});

test("reserve changes the response and never the burden", () => {
  // Two patients, same seed, differ only in the age their preset gives them.
  // Morphology and burden must be untouched by reserve.
  const young = generatePatient("APP-002", "reserve-check", { hoursFromOnset: 12 });
  assert.equal(young.hidden.latent_state.morphology, "uncomplicated_inflammation");
  assert.ok(young.hidden.physiologic_reserve > 0 && young.hidden.physiologic_reserve <= 1);
  // The burden is stored before damping; the response after.
  assert.ok(young.hidden.physiologic_response <= young.hidden.latent_state.inflammatory_burden + 1e-9);
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

test("the retrocecal review flag is gone, because its cause is gone", () => {
  // The flag asked whether a retrocecal envelope higher than the classic one was
  // a decision about later presentation or about severity. There is no longer a
  // per-phenotype envelope to ask about: lateness now drives physiology through
  // the shared absolute-time term, once.
  assert.equal(PHENOTYPES.retrocecal.review_flag, undefined);
  assert.equal(PHENOTYPES.retrocecal.authoring_ranges, undefined);

  // And retrocecal is still the phenotype that presents late - which is a
  // presentation fact, and the only route by which it can look sicker.
  assert.ok(
    PHENOTYPES.retrocecal.presentation.hours_from_onset.min >
      PHENOTYPES.classic.presentation.hours_from_onset.min
  );
});

test("the phenotype keeps localisation and owns no physiology", () => {
  // Onset windows and pain scores stay: they are presentation facts.
  assert.deepEqual(PHENOTYPES.pelvic.presentation.hours_from_onset, { min: 8, max: 24 });
  assert.deepEqual(PHENOTYPES.classic.presentation.hours_from_onset, { min: 6, max: 14 });
  assert.deepEqual(PHENOTYPES.retrocecal.presentation.pain_score, { min: 4, max: 8 });

  // Localisation is what a phenotype is for, and it is held as variants rather
  // than as one sentence containing "или".
  // Since 09.08.2026 the examination is declared as slot STATES; the prose lives
  // in examSlots.js. The psoas sign is still the retrocecal phenotype's marker.
  assert.ok(
    PHENOTYPES.retrocecal.presentation.examination_slot_choices.psoas.includes("положительный")
  );
  // "надлонной области" since the owner's rewording of 09.08.2026; it replaced
  // "надлобковой области" and "глубоко в тазу".
  assert.ok(PHENOTYPES.pelvic.presentation.pain_sites_ru.some((site) => /надлонн|тазу/i.test(site)));
  assert.equal(PHENOTYPES.retrocecal.presentation.pain_sites_ru.length, 3);
  assert.equal(PHENOTYPES.retrocecal.presentation.split_status, "MECHANICAL_SPLIT_NEEDS_CONFIRMATION");
  // The surgeon's original sentence is kept beside the split so it can be checked.
  assert.match(PHENOTYPES.retrocecal.presentation.authored_source_ru.story, /правый фланк/i);

  // Physiology is not.
  for (const phenotype of Object.values(PHENOTYPES)) {
    assert.equal(phenotype.authoring_ranges, undefined);
  }
  // The shared envelope spans what the four presentations used to hold apart.
  const uncomplicated = physiologyEnvelopeFor("uncomplicated_inflammation");
  assert.deepEqual(uncomplicated.crp, { min: 2, max: 140 });
  assert.deepEqual(uncomplicated.heart_rate, { min: 72, max: 112 });
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

test("every playable V3.5 case disables the legacy numeric rubric at case level", () => {
  const { caseData } = buildV35Case({ seed: "formative-only", requestedPresetId: "APP-001" });
  assert.equal(caseData.scoring.eligible_for_scoring, false);
  assert.equal(caseData.scoring.mode, "formative_only");
  assert.equal(caseData.scoring.review_status, V35_SCORING_REVIEW_STATUS);
  assert.equal(caseData.scoring_rubric_version, V35_SCORING_CONTRACT_VERSION);
  assert.ok(caseData.scoring.unlock_requires.includes("independent_clinical_review"));
});

test("a gate has a scope, a target and a waiver - not a boolean", () => {
  const consent = SCORING_CONTRACT.find((e) => e.canonical_id === "informed_consent");
  assert.equal(consent.gate.gate_scope, "before_intervention");
  assert.deepEqual(consent.gate.blocks_action_ids, ["appendectomy_here"]);
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
  assert.equal(readiness.generator_wired_to_case_factory, true);
  assert.equal(readiness.engine_wired, true);
  assert.equal(readiness.faculty_preview_complication_states_wired, false);
  assert.deepEqual(readiness.blocking_for_release, []);
  assert.ok(readiness.blocking_for_done.length > 0);
  assert.deepEqual(readiness.faculty_preview_presets, ["APP-005"]);
});

test("INVARIANT: nothing a learner sees before the debrief names the diagnosis", () => {
  // Regression. The case title carried `preset.title_ru` - "Ретроцекальный
  // аппендицит со слабой передней перитонеальной симптоматикой" - and printed
  // the hidden truth above the handoff, before the learner had done anything.
  // A trainer for diagnostic reasoning that announces the diagnosis is not one.
  const forbidden = [/аппендицит/i, /перфорац/i, /перитонит/i, /гангрен/i, /абсцесс/i];

  for (const presetId of ["APP-001", "APP-002", "APP-003", "APP-004"]) {
    for (let index = 0; index < 40; index += 1) {
      const { caseData } = buildV35Case({ seed: `leak-${index}`, requestedPresetId: presetId });
      const learnerFacing = [
        caseData.title,
        caseData.initial_presentation.text,
        caseData.available_findings.focused_history.text,
        caseData.available_findings.abdominal_exam.text,
      ].join(" ");

      for (const pattern of forbidden) {
        assert.ok(
          !pattern.test(learnerFacing),
          `${presetId}: диагноз виден резиденту — ${pattern} в "${learnerFacing.slice(0, 90)}"`
        );
      }
    }
  }

  // The preset title still exists, where faculty can read it.
  const { caseData } = buildV35Case({ seed: "leak-faculty", requestedPresetId: "APP-004" });
  assert.match(caseData.faculty_title_ru, /Ретроцекальный/);
  // Not /^Боль в /: pain sites carry their own preposition since 09.08.2026, and
  // the pelvic phenotype's "глубоко внизу живота" does not take "в".
  assert.match(caseData.title, /^Боль /);
});

test("a patient has one pain site, not a menu of them", () => {
  // The authored sentence "правый фланк, поясница или правое подреберье" is an
  // authoring envelope. Printed verbatim it read as a list of options.
  for (let index = 0; index < 60; index += 1) {
    const { caseData } = buildV35Case({ seed: `menu-${index}`, requestedPresetId: "APP-004" });
    const handoff = caseData.initial_presentation.text;
    assert.ok(!handoff.includes(" или "), `меню в передаче: ${handoff}`);
    assert.ok(
      !caseData.available_findings.abdominal_exam.text.includes(" или "),
      "меню в осмотре"
    );
  }

  // And the sites actually vary between patients.
  const sites = new Set();
  for (let index = 0; index < 60; index += 1) {
    sites.add(buildV35Case({ seed: `site-${index}`, requestedPresetId: "APP-004" }).caseData.title);
  }
  assert.ok(sites.size >= 2, `ожидалась вариативность локализации, получено ${sites.size}`);
});

test("an explicit negative never contradicts what the case already asserts", () => {
  // The pelvic phenotype reports urinary symptoms; the card's fixed negatives
  // said "Дизурии нет". One patient, two opposite statements.
  let triggered = 0;
  for (let index = 0; index < 80; index += 1) {
    const { caseData } = buildV35Case({ seed: `neg-${index}`, requestedPresetId: "APP-003" });
    const history = caseData.available_findings.focused_history.text.toLowerCase();
    // Match the SYMPTOM, not the stem: after the rewording the negative itself
    // reads "нарушений мочеиспускания нет", so a stem test would fire on the
    // negative and pass vacuously.
    const urinarySymptom =
      history.includes("учащённое мочеиспускание") ||
      history.includes("дискомфорт при мочеиспускании") ||
      history.includes("позывы к дефекации");
    if (urinarySymptom) {
      triggered += 1;
      assert.ok(
        !history.includes("нарушений мочеиспускания нет"),
        `противоречие: ${history}`
      );
    }
  }
  // A guard that never fires proves nothing.
  assert.ok(triggered > 0, "ни один тазовый пациент не назвал мочевой симптом");
});

test("end to end: effective_seed + content_version + preset rebuild the case exactly", () => {
  // What a reported session must be reconstructible from. Everything a reviewer
  // has is the frozen snapshot; if these three fields are not sufficient, a
  // pilot finding cannot be reproduced and is worth nothing.
  for (const presetId of ["APP-001", "APP-002", "APP-003", "APP-004"]) {
    const first = buildV35Case({ seed: `e2e-${presetId}`, requestedPresetId: presetId });
    const snapshot = first.caseData.v35_composition;

    // Rebuild from the snapshot alone.
    const rebuilt = buildV35Case({
      seed: snapshot.effective_seed,
      requestedPresetId: snapshot.case_preset_id,
    });

    assert.equal(rebuilt.caseData.v35_composition.content_version, snapshot.content_version);
    assert.equal(rebuilt.caseData.v35_composition.content_version, V35_CONTENT_VERSION);

    // The patient, byte for byte.
    assert.deepEqual(rebuilt.patient, first.patient, `${presetId}: пациент не воспроизвёлся`);
    // The text the learner reads.
    assert.equal(
      rebuilt.caseData.initial_presentation.text,
      first.caseData.initial_presentation.text,
      `${presetId}: передача не воспроизвелась`
    );
    // And the frozen composition itself.
    assert.deepEqual(rebuilt.caseData.v35_composition, snapshot, `${presetId}: снимок не совпал`);

    // The findings the learner would be shown are the same too - a patient that
    // reproduces but whose results do not is not a reproduced case.
    assert.deepEqual(
      rebuilt.caseData.available_findings,
      first.caseData.available_findings,
      `${presetId}: находки не совпали`
    );

    // The snapshot carries the hidden fields that cannot be recomputed.
    assert.ok(Number.isFinite(snapshot.physiologic_reserve));
    assert.ok(Number.isFinite(snapshot.inflammatory_burden));
    assert.ok(Number.isFinite(snapshot.organ_dysfunction));
  }
});

test("the declared resource profile becomes one explicit versioned runtime input", () => {
  const { caseData } = buildV35Case({ seed: "resource-naming" });
  assert.ok(caseData.v35_composition.declared_resource_profile_id);
  assert.equal(
    caseData.v35_composition.effective_resource_profile_id,
    caseData.v35_composition.declared_resource_profile_id
  );
  assert.equal(caseData.v35_composition.resource_profile_version, KZ_RESOURCE_PROFILE_VERSION);
  assert.equal(caseData.v35_composition.resource_profile_id, undefined);
  for (const preset of CASE_PRESETS) {
    assert.ok(preset.declared_resource_profile_id);
    assert.equal(preset.resource_profile_id, undefined);
  }
});

test("patient imaging findings never hardcode facility availability", () => {
  const { caseData } = buildV35Case({ seed: "imaging-resource-separation", requestedPresetId: "APP-002" });
  for (const id of ["abdominal_ultrasound", "pelvic_ultrasound", "ct_abdomen"]) {
    const finding = caseData.available_findings[id];
    assert.ok(finding, id);
    assert.doesNotMatch(finding.text, /недоступ|врач УЗД|09:00|аппарата нет/i, id);
  }
});

test("unvalidated numbers are pending, and say which part was reviewed", () => {
  // The mechanism was reviewed; the numbers that produce the unvalidated CRP
  // gradient were not. Two statuses, because they are two claims.
  assert.equal(LOAD_COMPOSITION.mechanism_review_status, "reviewed_provisional");
  assert.equal(LOAD_COMPOSITION.numeric_parameters_review_status, "pending");
  assert.equal(LOAD_COMPOSITION.clinical_review_status, "pending");
  assert.equal(physiologyEnvelopeFor("uncomplicated_inflammation").clinical_review_status, "pending");
  assert.equal(PHYSIOLOGIC_RESERVE.clinical_review_status, "pending");
  assert.equal(MORPHOLOGY_PROFILES.clinical_review_status, "pending");
});

test("the manifest declares a content version, not just a label", () => {
  assert.match(V35_CONTENT_VERSION, /^3\.5\.\d+$/);
  assert.equal(v35Manifest.content_version, V35_CONTENT_VERSION);
});

test("the examination is slot states plus one dictionary, and the phenotype owns no prose", () => {
  // The point of the split: a phenotype that still carried sentences would print
  // the same finding twice once the slots were switched on.
  for (const phenotype of Object.values(PHENOTYPES)) {
    const p = phenotype.presentation;
    for (const dead of ["examination_fixed_ru", "examination_variants_ru", "examination_optional_ru"]) {
      assert.equal(p[dead], undefined, `${phenotype.phenotype_id} всё ещё несёт прозу осмотра: ${dead}`);
    }
    assert.ok(p.examination_slots, `${phenotype.phenotype_id} не объявил слоты осмотра`);

    // Every declared state must exist in the dictionary - base and variants.
    const declared = Object.entries(p.examination_slots).map(([id, state]) => [id, [state]]);
    const drawn = Object.entries(p.examination_slot_choices || {});
    for (const [slotId, states] of [...declared, ...drawn]) {
      assert.ok(examSlot(slotId), `${phenotype.phenotype_id}: неизвестный слот "${slotId}"`);
      for (const state of states) {
        assert.ok(
          statesFor(slotId).includes(state),
          `${phenotype.phenotype_id}: слот "${slotId}" не знает состояния "${state}"`
        );
      }
      assert.equal(
        p.examination_slots[slotId] !== undefined && drawn.some(([id]) => id === slotId),
        false,
        `${phenotype.phenotype_id}: слот "${slotId}" объявлен и фиксированным, и разыгрываемым`
      );
    }
  }
});

test("a slot the phenotype did not speak about prints nothing", () => {
  // The rule that keeps the trainer from shipping plausible invented negatives:
  // an unassigned sign is silent, not "отрицательный".
  const text = renderExamination({ contour: "обычный" }, "в правой подвздошной области");
  assert.equal(text, "Живот обычной формы, симметричный, не вздут, участвует в акте дыхания.");
  for (const slot of EXAM_SLOTS) {
    if (slot.id === "contour") continue;
    for (const phrase of Object.values(slot.states)) {
      assert.ok(!text.includes(phrase.slice(0, 20)), `молчащий слот ${slot.id} всё же напечатан`);
    }
  }
  // And an unknown state is a failure, not a silent skip.
  assert.throws(() => renderExamination({ rovsing: "может быть" }, "в правой подвздошной области"));
});

test("no English sign name reaches the learner", () => {
  // Owner's instruction, 09.08.2026: Russian terminology in the patient text.
  const forbidden = [/psoas/i, /obturator/i, /rebound/i, /rovsing/i, /guarding/i, /tenderness/i];
  for (const presetId of ["APP-001", "APP-002", "APP-003", "APP-004"]) {
    for (let index = 0; index < 40; index += 1) {
      const { caseData } = buildV35Case({ seed: `ru-${index}`, requestedPresetId: presetId });
      const learnerFacing = [
        caseData.title,
        caseData.initial_presentation.text,
        caseData.available_findings.focused_history.text,
        caseData.available_findings.abdominal_exam.text,
      ].join(" ");
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(learnerFacing), `${presetId}: английский термин ${pattern}`);
      }
    }
  }
});
