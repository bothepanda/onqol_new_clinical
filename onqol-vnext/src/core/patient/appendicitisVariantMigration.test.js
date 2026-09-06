import { test } from "node:test";
import assert from "node:assert/strict";

import { generatePatient } from "./patientGenerator.js";
import bundle from "../../content/generated/appendicitis.json" with { type: "json" };

const presetById = new Map(
  bundle.phenotypes.case_presets.map((preset) => [preset.case_preset_id, preset]),
);

test("V3.5 APP-001 through APP-005 are present; only APP-004 is learner-enabled", () => {
  for (const id of ["APP-001", "APP-002", "APP-003", "APP-004", "APP-005"]) {
    assert.ok(presetById.has(id), `${id} must be present in the vNext catalogue`);
  }
  assert.equal(presetById.get("APP-001").runtime_status, "review_pending");
  assert.equal(presetById.get("APP-002").runtime_status, "review_pending");
  assert.equal(presetById.get("APP-003").runtime_status, "review_pending");
  // Promoted 2026-09-06 (Clinical Lead) for the NU resident pilot after every
  // learner_pilot-route patient-truth dependency reached approved_for_training.
  assert.equal(presetById.get("APP-004").runtime_status, "learner_enabled");
  assert.equal(presetById.get("APP-005").runtime_status, "faculty_preview");
  const learnerEnabled = [...presetById.values()]
    .filter((preset) => preset.runtime_status === "learner_enabled")
    .map((preset) => preset.case_preset_id);
  assert.deepEqual(learnerEnabled, ["APP-004"]);
});

test("all migrated appendicitis variants instantiate deterministically for review", () => {
  const expectedPhenotypes = {
    "APP-001": "early_subtle",
    "APP-002": "classic",
    "APP-003": "pelvic",
    "APP-004": "retrocecal",
    "APP-005": "late_complicated",
  };
  for (const [casePresetId, phenotypeId] of Object.entries(expectedPhenotypes)) {
    const a = generatePatient({ seed: "migration-review", bundle, casePresetId });
    const b = generatePatient({ seed: "migration-review", bundle, casePresetId });
    assert.deepEqual(a, b);
    assert.equal(a.phenotypeId, phenotypeId);
    assert.equal(a.truth.trajectoryId, presetById.get(casePresetId).trajectory_id);
  }
});

test("APP-002 preserves its authored female reproductive-age constraint", () => {
  for (const seed of ["a", "b", "c", "d", "e"]) {
    const patient = generatePatient({ seed, bundle, casePresetId: "APP-002" });
    assert.equal(patient.demographics.sex, "female");
    assert.ok(patient.demographics.age >= 18 && patient.demographics.age <= 50);
  }
});

test("migrated phenotypes retain pending, source-ungraded provenance and withdrawn DRE is absent", () => {
  for (const id of ["early_subtle", "classic", "pelvic", "late_complicated"]) {
    const phenotype = bundle.phenotypes.phenotypes[id];
    assert.equal(phenotype.provenance.review_status, "pending");
    assert.equal(phenotype.provenance.evidence_strength, "NEEDS_SOURCE");
  }
  assert.equal(
    presetById.get("APP-002").demographics.provenance.evidence_strength,
    "NEEDS_SOURCE",
  );
  assert.equal(/rectal|ректал/i.test(JSON.stringify(bundle.phenotypes.phenotypes.pelvic)), false);
});
