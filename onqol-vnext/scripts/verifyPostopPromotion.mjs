#!/usr/bin/env node
/**
 * One-shot verification for the TRJ-POSTOP-RECOVERY focused-re-review promotion
 * (2026-09-01). Not a release artifact; safe to delete. Prints the learner_pilot
 * patient-truth inventory, the audience-gate decision, and the recovery-clock /
 * discharge behaviour that the second reviewer's conditions turn on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withShared } from "../src/core/content/loadBundle.js";
import { inventoryPatientTruth, evaluateInflammatoryCalibrationForPilot, isPatientTruthApproved } from "../src/core/patient/patientTruthGovernance.js";
import { evaluateSessionAudience } from "../src/core/session/sessionPurpose.js";
import { generatePatient } from "../src/core/patient/patientGenerator.js";
import { reviewStatusOf } from "../src/core/rules/contentProvenance.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const disease = JSON.parse(readFileSync(path.join(ROOT, "src/content/generated/appendicitis.json"), "utf8"));
const shared = JSON.parse(readFileSync(path.join(ROOT, "src/content/generated/shared.json"), "utf8"));
const bundle = withShared(disease, shared);
const preset = bundle.phenotypes.case_presets.find((p) => p.case_preset_id === "APP-004");

console.log("=== TRJ-POSTOP-RECOVERY provenance ===");
const course = bundle.trajectories.post_source_control_course;
console.log("review_status         :", course.provenance.review_status);
console.log("second_reviewed_by    :", JSON.stringify(course.provenance.second_reviewed_by));
console.log("second_reviewed_at    :", course.provenance.second_reviewed_at);
console.log("model_status          :", course.provenance.model_status);

console.log("\n=== inflammatory calibration (pilot) ===");
console.log(evaluateInflammatoryCalibrationForPilot({ inflammatoryProfiles: bundle.disease.inflammatory_profiles }));

for (const purpose of ["learner_pilot", "production", "internal_development"]) {
  const inv = inventoryPatientTruth({ bundle, casePresetId: "APP-004", sessionPurpose: purpose });
  console.log(`\n=== inventoryPatientTruth(sessionPurpose=${purpose}) ===`);
  console.log("blocked ids          :", JSON.stringify(inv.blocked.map((b) => b.id)));
  console.log("patientTruthApproved  :", isPatientTruthApproved(inv));
  const envEntry = inv.entries.find((e) => e.contentId === "uncomplicated_inflammation");
  const profEntry = inv.entries.find((e) => e.contentId === "inflammatory_profiles");
  console.log("legacy union envelope in entries:", Boolean(envEntry), envEntry ? `(reviewStatus=${envEntry.reviewStatus})` : "-> replaced by active profile mechanism");
  if (profEntry) console.log("active profile mechanism entry  :", profEntry.reviewStatus);
}

console.log("\n=== evaluateSessionAudience(learner_pilot) with runtime_status variants ===");
for (const rs of ["development_only", "learner_enabled", "approved_for_training"]) {
  const invPilot = inventoryPatientTruth({ bundle, casePresetId: "APP-004", sessionPurpose: "learner_pilot" });
  const decision = evaluateSessionAudience({
    sessionPurpose: "learner_pilot",
    preset: { ...preset, runtime_status: rs },
    patientTruthApproved: invPilot.approved,
    productionRelease: bundle.disease?.release_gate,
  });
  console.log(`runtime_status=${rs.padEnd(20)} ->`, JSON.stringify(decision));
}

console.log("\n=== legacy union envelope reachability on the learner_pilot generation path ===");
// generatePatient draws from the approved linked profiles; it must NOT fall back
// to the union envelope. Prove every generated patient sits inside a profile.
const profs = bundle.disease.inflammatory_profiles;
const order = profs.selection.order;
let outside = 0;
for (let i = 0; i < 200; i++) {
  const p = generatePatient({ seed: `verify-${i}`, bundle, casePresetId: "APP-004" });
  const hr = p.initialPhysiology.heartRate;
  const inSome = order.some((id) => {
    const r = profs[id].heart_rate;
    return hr >= r[0] && hr <= r[1];
  });
  if (!inSome) outside++;
}
console.log(`patients whose HR fell outside every approved profile range: ${outside} / 200 (0 = envelope unreachable)`);

console.log("\n=== union envelope own status (unchanged, intentionally not promoted) ===");
console.log("ENV-UNCOMPLICATED-INFLAMMATION review_status:", reviewStatusOf(bundle.disease.physiology_envelopes.uncomplicated_inflammation));
