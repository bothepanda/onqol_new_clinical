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
  V35_MODIFIERS,
  learnerSelectablePresets,
  presetsById,
  resolvePreset,
} from "../v35/phenotypes.js";
import { ALTERNATIVE_DISEASES, alternativesFor, facultyPreview } from "../v35/alternatives.js";
import { PATH_STATES, STABLE_PATH } from "../v35/pathStates.js";
import { ACTION_CONTRACTS } from "../v35/actionContracts.js";
import {
  LOAD_COMPOSITION,
  coherenceViolations,
  generatePatient,
  physiologicLoad,
} from "../v35/patientGenerator.js";
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

test("physiological load comes from morphology, time and trajectory - never from the phenotype", () => {
  // The owner's point: a retrocecal appendix is in a different place, not a
  // sicker patient. The composition table has no phenotype term at all.
  assert.equal(LOAD_COMPOSITION.phenotype, undefined);
  assert.deepEqual(Object.keys(LOAD_COMPOSITION.morphology).sort(), [
    "abscess",
    "diffuse_peritonitis",
    "gangrene_necrosis",
    "perforation",
    "uncomplicated_inflammation",
  ]);

  // Same morphology, time and trajectory produce the same load whatever the
  // presentation is called.
  const inputs = { morphology: "uncomplicated_inflammation", timeInWindow: 0.5, trajectoryId: "TRJ-STABLE" };
  assert.equal(physiologicLoad(inputs), physiologicLoad({ ...inputs }));

  // Perforation is sicker than uncomplicated inflammation, all else equal.
  assert.ok(
    physiologicLoad({ ...inputs, morphology: "perforation" }) > physiologicLoad(inputs)
  );
});

test("the cluster hangs together: one load, not six independent draws", () => {
  for (const preset of learnerSelectablePresets()) {
    for (let index = 0; index < 50; index += 1) {
      const patient = generatePatient(preset.case_preset_id, `cluster-${index}`);
      assert.deepEqual(
        coherenceViolations(patient),
        [],
        `${preset.case_preset_id} seed ${index}: ${JSON.stringify(coherenceViolations(patient))}`
      );
    }
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
  assert.equal(readiness.generator_wired_to_case_factory, false);
  assert.equal(readiness.engine_wired, false);
  assert.ok(readiness.blocking_for_done.length > 0);
  assert.deepEqual(readiness.faculty_preview_presets, ["APP-005"]);
});

test("the manifest declares a content version, not just a label", () => {
  assert.match(V35_CONTENT_VERSION, /^3\.5\.\d+$/);
  assert.equal(v35Manifest.content_version, V35_CONTENT_VERSION);
});
