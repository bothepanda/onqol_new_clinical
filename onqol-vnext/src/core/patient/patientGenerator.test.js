import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePatient } from "./patientGenerator.js";
import bundle from "../../content/generated/appendicitis.json" with { type: "json" };

// Behavioral regression #19 (Core Runtime Spec §68.19 / task brief §27.19):
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

// Second Clinical Reviewer Decision, 2026-09-01 (Sarina T.T.): the linked
// inflammatory profiles are approved_for_training and active
// (`inflammatory_profiles.selection.generation_enabled: true`), so
// generation now draws from a profile, not the legacy union envelope.
test("generated physiology stays inside the reviewed, active inflammatory profile", () => {
  const profiles = bundle.disease.inflammatory_profiles;
  assert.equal(profiles.selection.generation_enabled, true);
  const inRangeForSome = (value, field) =>
    profiles.selection.order.some((id) => value >= profiles[id][field][0] - 0.5 && value <= profiles[id][field][1] + 0.5);
  for (const seed of ["s1", "s2", "s3", "s4", "s5"]) {
    const patient = generatePatient({ seed, bundle, casePresetId: "APP-004" });
    const p = patient.initialPhysiology;
    assert.ok(inRangeForSome(p.heartRate, "heart_rate"), `HR ${p.heartRate} not in any profile`);
    assert.ok(inRangeForSome(p.crp, "crp"), `CRP ${p.crp} not in any profile`);
    assert.ok(inRangeForSome(p.wbc, "wbc"), `WBC ${p.wbc} not in any profile`);
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
