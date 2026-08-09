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
  APPENDICITIS_PHENOTYPES,
  V35_MODIFIERS,
  learnerSelectablePhenotypes,
} from "../v35/phenotypes.js";
import { V35_MIMICS, facultyPreview } from "../v35/mimics.js";
import { PATH_STATES, STABLE_PATH } from "../v35/pathStates.js";
import { ACTION_CONTRACTS } from "../v35/actionContracts.js";

const v3Case = createV3Case();

// --- completeness (addendum 14) -------------------------------------------

test("the manifest carries exactly 5 phenotypes, 8 alternatives, 16 states and 32 contracts", () => {
  assert.equal(APPENDICITIS_PHENOTYPES.length, REQUIRED_COUNTS.phenotypes);
  assert.equal(V35_MIMICS.length, REQUIRED_COUNTS.mimics);
  assert.equal(PATH_STATES.length, REQUIRED_COUNTS.path_states);
  assert.equal(ACTION_CONTRACTS.length, REQUIRED_COUNTS.action_contracts);
});

test("the manifest validates against the real case, with every alias resolving", () => {
  const result = validateV35Manifest(v3Case);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("every transition, stable-path step and contract reference resolves", () => {
  // Covered by the validator, asserted separately so a regression names itself.
  const stateIds = new Set(PATH_STATES.map((state) => state.state_id));
  for (const state of PATH_STATES) {
    for (const target of state.allowed_transitions) {
      assert.ok(stateIds.has(target), `${state.state_id} -> ${target}`);
    }
  }
  assert.equal(STABLE_PATH.at(-1), "complete");
  assert.ok(STABLE_PATH.includes("discharge"), "the stable path must reach discharge");
});

// --- safety (addendum 14) --------------------------------------------------

test("the learner randomizer can never select APP-005 or an alternative", () => {
  const selectable = learnerSelectablePhenotypes().map((phenotype) => phenotype.preset_id);
  assert.deepEqual(selectable, ["APP-001", "APP-002", "APP-003", "APP-004"]);
  assert.ok(!selectable.includes("APP-005"));

  for (const mimic of V35_MIMICS) {
    assert.equal(mimic.runtime_status, "disease_stub_inactive");
    assert.equal(mimic.eligible_for_scoring, false);
  }
});

test("nothing added by V3.5 is eligible for scoring", () => {
  for (const contract of ACTION_CONTRACTS) {
    assert.equal(contract.eligible_for_scoring, false, contract.contract_id);
  }
});

test("an inactive phenotype or alternative explains itself in faculty preview", () => {
  const app005 = APPENDICITIS_PHENOTYPES.find((p) => p.preset_id === "APP-005");
  assert.equal(app005.runtime_status, "faculty_preview");
  assert.match(app005.inactivity_reason_ru, /\S/);

  for (const mimic of V35_MIMICS) {
    const preview = facultyPreview(mimic);
    assert.ok(preview.hidden_truth_ru, `${mimic.mimic_id} must reveal its hidden truth to faculty`);
    assert.match(preview.inactivity_reason_ru, /\S/);
    assert.equal(preview.open_review_gates.clinical, "pending");
  }
});

test("pregnancy actions belong to a modifier, not to every patient", () => {
  // The decision taken with the owner: a male patient's case does not merely
  // score beta-hCG at zero, it does not contain the action at all.
  const modifier = V35_MODIFIERS["MOD-PREGNANCY-POSSIBLE"];
  assert.ok(modifier.enables_action_ids.includes("pregnancy_test"));
  assert.ok(modifier.enables_action_ids.includes("pelvic_gynecologic_screen"));

  const gated = ACTION_CONTRACTS.filter((c) => c.requires_modifier === "MOD-PREGNANCY-POSSIBLE");
  assert.deepEqual(
    gated.map((c) => c.contract_id).sort(),
    ["pregnancy_test", "reproductive_safety_screen"]
  );

  // APP-002 is the reproductive-age preset; APP-001 and APP-004 are not.
  const byId = (id) => APPENDICITIS_PHENOTYPES.find((p) => p.preset_id === id);
  assert.ok(byId("APP-002").default_modifiers.includes("MOD-PREGNANCY-POSSIBLE"));
  assert.deepEqual(byId("APP-001").default_modifiers, []);
  assert.deepEqual(byId("APP-004").default_modifiers, []);
});

// --- authoring honesty -----------------------------------------------------

test("the phenotype ranges are the addendum's, unwidened", () => {
  // Spot-check against CLAUDE_CODE_ONQOL_V3_5_ADDENDUM.md 4.2. If someone
  // "tidies" a range, this fails rather than quietly shipping a different
  // patient population.
  const byId = (id) => APPENDICITIS_PHENOTYPES.find((p) => p.preset_id === id);
  assert.deepEqual(byId("APP-002").authoring_ranges.heart_rate, { min: 86, max: 104 });
  assert.deepEqual(byId("APP-002").authoring_ranges.wbc, { min: 11, max: 16 });
  assert.deepEqual(byId("APP-001").authoring_ranges.temperature_c, { min: 36.7, max: 37.7 });
  assert.deepEqual(byId("APP-004").authoring_ranges.crp, { min: 40, max: 140 });
  assert.deepEqual(byId("APP-003").presentation.hours_from_onset, { min: 8, max: 24 });
});

test("a range is authoring guidance and says so, never a clinical cutoff", () => {
  // The field name is the contract. A rule that reads a range as a threshold
  // would have to rename it first, which is a reviewable diff.
  for (const phenotype of APPENDICITIS_PHENOTYPES) {
    assert.ok(phenotype.authoring_ranges, `${phenotype.preset_id} declares authoring ranges`);
    assert.equal(phenotype.authoring_ranges.intervention_threshold, undefined);
  }
});

test("alternatives are stubs and admit exactly what they are missing", () => {
  for (const mimic of V35_MIMICS) {
    assert.ok(
      mimic.missing_for_authoring.includes("deterministic_findings"),
      `${mimic.mimic_id} must not claim to have findings`
    );
    assert.notEqual(
      mimic.runtime_status,
      "authoring_complete_inactive",
      "nothing here is authoring-complete, whatever the addendum's default string says"
    );
  }
});

test("perforated ulcer is carried as a principal disease, not a distractor", () => {
  // Master plan 13.2, which the owner asked to win on schema questions.
  const entry = V35_MIMICS.find((mimic) => mimic.mimic_id === "MIMIC-PERF-ULCER-001");
  assert.equal(entry.entity_type, "principal_disease");
  assert.equal(entry.disease_card_id, "DIS-PERFORATED-PUD");
  assert.match(entry.reclassification_reason, /13\.2/);

  const distractors = V35_MIMICS.filter((mimic) => mimic.entity_type === "mimic");
  assert.equal(distractors.length, 7, "seven true alternatives plus one principal disease");
});

test("the three reasoning contracts resolve to reasoning, never to an action", () => {
  // Making problem_representation an action would break "reasoning fields never
  // create a completed action", which has its own test in v31Reasoning.
  for (const id of ["problem_representation", "diagnostic_justification", "test_justification"]) {
    const contract = ACTION_CONTRACTS.find((c) => c.contract_id === id);
    assert.deepEqual(contract.aliases, [], `${id} must not alias a leaf action`);
    assert.ok(contract.reasoning_flags.length > 0, `${id} must resolve to reasoning flags`);
  }
});

// --- honesty about done ----------------------------------------------------

test("readiness reports the manifest as valid and V3.5 as not yet done", () => {
  const readiness = v35Readiness(v3Case);
  assert.equal(readiness.content_version, V35_CONTENT_VERSION);
  assert.equal(readiness.manifest_valid, true);

  // The point of this test: a valid manifest must never be mistaken for a
  // finished version. Addendum 16 asks for the exact blocker instead.
  assert.equal(readiness.engine_wired, false);
  assert.ok(readiness.blocking_for_done.length > 0);
  assert.deepEqual(readiness.faculty_preview_phenotypes, ["APP-005"]);
});

test("the manifest declares a content version, not just a label", () => {
  assert.match(V35_CONTENT_VERSION, /^3\.5\.\d+$/);
  assert.equal(v35Manifest.content_version, V35_CONTENT_VERSION);
  assert.equal(v35Manifest.vertical, "acute_appendicitis_adult");
});
