import assert from "node:assert/strict";
import test from "node:test";
import { buildV35Case } from "../v35/createCase.js";
import { evaluateReleaseGate } from "../v35/releaseGate.js";

const caseData = buildV35Case({
  seed: "release-gate-test",
  requestedPresetId: "APP-001",
}).caseData;

test("production release is NO-GO while owner gates remain open", () => {
  const result = evaluateReleaseGate(caseData, {});
  assert.equal(result.decision, "NO-GO");
  assert.equal(result.deploy_allowed, false);
  assert.ok(result.blocker_codes.includes("provider_key_rotation_unconfirmed"));
  assert.ok(result.blocker_codes.includes("clinical_rule_registry_not_approved"));
  assert.equal(result.clinical_governance.structurally_valid, true);
  assert.equal(result.blocker_codes.some((code) => code.startsWith("v35_runtime_blocker_")), false);
  assert.equal(result.scoring_mode, "formative_only");
});

test("Kazakh cannot be enabled while its learner-facing copy is incomplete", () => {
  const result = evaluateReleaseGate(caseData, { ONQOL_ENABLE_KK: "confirmed" });
  assert.ok(result.blocker_codes.includes("kk_locale_incomplete"));
  assert.deepEqual(result.enabled_locales, ["ru", "kk"]);
});
