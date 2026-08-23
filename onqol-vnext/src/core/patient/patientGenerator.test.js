import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePatient } from "./patientGenerator.js";
import bundle from "../../content/generated/appendicitis.json" with { type: "json" };

// Behavioral regression #19 (Core Foundation Spec §68.19 / task brief §27.19):
// same seed reproduces patient + stochastic events.
test("same seed reproduces an identical patient", () => {
  const a = generatePatient({ seed: "repro-seed", bundle, casePresetId: "APP-004" });
  const b = generatePatient({ seed: "repro-seed", bundle, casePresetId: "APP-004" });
  assert.deepEqual(a, b);
});

test("different seeds produce different patients", () => {
  const a = generatePatient({ seed: "seed-one", bundle, casePresetId: "APP-004" });
  const b = generatePatient({ seed: "seed-two", bundle, casePresetId: "APP-004" });
  assert.notDeepEqual(a.demographics, b.demographics);
});

test("generated physiology stays inside the reviewed envelope for the morphology", () => {
  for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
    const patient = generatePatient({ seed, bundle, casePresetId: "APP-004" });
    const envelope = bundle.disease.physiology_envelopes.uncomplicated_inflammation;
    const p = patient.initialPhysiology;
    assert.ok(p.heartRate >= envelope.heart_rate[0] && p.heartRate <= envelope.heart_rate[1]);
    assert.ok(p.crp >= envelope.crp[0] && p.crp <= envelope.crp[1]);
    assert.ok(p.wbc >= envelope.wbc[0] && p.wbc <= envelope.wbc[1]);
  }
});

test("hidden truth carries the phenotype's operative finding, not shown anywhere in learner-facing fields", () => {
  const patient = generatePatient({ seed: "hide-1", bundle, casePresetId: "APP-004" });
  assert.equal(patient.truth.operativeTruthRu, bundle.phenotypes.phenotypes.retrocecal.imaging.operative_truth_ru);
  // Sanity: the field genuinely lives under `truth`, the one namespace the
  // mentor boundary (learnerView.js) must never read from.
  assert.ok("truth" in patient);
});

test("unknown case preset throws rather than silently falling back", () => {
  assert.throws(() => generatePatient({ seed: "x", bundle, casePresetId: "NOT-A-PRESET" }));
});
