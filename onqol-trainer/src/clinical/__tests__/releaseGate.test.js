import assert from "node:assert/strict";
import test from "node:test";
import { buildV35Case } from "../v35/createCase.js";
import { evaluateReleaseGate } from "../v35/releaseGate.js";
import { PILOT_RELEASE_APPROVALS } from "../governance/pilotReleaseApprovals.js";

const caseData = buildV35Case({
  seed: "release-gate-test",
  requestedPresetId: "APP-001",
}).caseData;

test("production release is NO-GO while owner gates remain open", () => {
  const result = evaluateReleaseGate(caseData, {});
  assert.equal(result.decision, "NO-GO");
  assert.equal(result.deploy_allowed, false);
  assert.ok(result.blocker_codes.includes("provider_key_rotation_unconfirmed"));
  // The rule registry stopped being a blocker once the twelve rules were signed.
  // Everything else still blocks, and production stays NO-GO.
  assert.equal(result.blocker_codes.includes("clinical_rule_registry_not_approved"), false);
  assert.ok(result.blocker_codes.includes("clinical_signoff_deployment_id_missing"));
  assert.ok(result.blocker_codes.includes("resource_profile_review_deployment_id_missing"));
  assert.equal(result.approval_manifest.statuses.clinical_signoff, "approved");
  assert.equal(result.approval_manifest.statuses.resource_profile_review, "approved");
  assert.equal(result.clinical_governance.structurally_valid, true);
  assert.equal(result.blocker_codes.some((code) => code.startsWith("v35_runtime_blocker_")), false);
  assert.equal(result.scoring_mode, "formative_only");
});

test("Kazakh cannot be enabled while its learner-facing copy is incomplete", () => {
  const result = evaluateReleaseGate(caseData, { ONQOL_ENABLE_KK: "confirmed" });
  assert.ok(result.blocker_codes.includes("kk_locale_incomplete"));
  assert.deepEqual(result.enabled_locales, ["ru", "kk"]);
});

const validEnvironment = () => ({
  OPENAI_API_KEY: `sk-${"a".repeat(24)}`,
  ONQOL_MAIN_ACCESS_TOKEN: "pilot-access-token-2026-strong",
  ONQOL_MAIN_ALLOWED_ORIGIN: "https://pilot.onqol.kz",
  ONQOL_PROVIDER_KEY_ROTATION_ID: "ONQOL-KEY-ROTATION-20260820",
  ONQOL_HOSTING_PROTECTION_ID: "ONQOL-HOST-PROTECTION-20260820",
  ONQOL_CLINICAL_SIGNOFF_ID: "ONQOL-CLINICAL-20260820",
  ONQOL_RU_LANGUAGE_REVIEW_ID: "ONQOL-RU-REVIEW-20260820",
  ONQOL_RESOURCE_PROFILE_REVIEW_ID: "ONQOL-REFERENCE-FULL-20260820",
  ONQOL_PRIVACY_OWNER_APPROVAL_ID: "ONQOL-PRIVACY-20260820",
});

function approvedManifest() {
  const manifest = structuredClone(PILOT_RELEASE_APPROVALS);
  const ids = {
    provider_key_rotation: "ONQOL-KEY-ROTATION-20260820",
    hosting_protection: "ONQOL-HOST-PROTECTION-20260820",
    clinical_signoff: "ONQOL-CLINICAL-20260820",
    ru_language_review: "ONQOL-RU-REVIEW-20260820",
    resource_profile_review: "ONQOL-REFERENCE-FULL-20260820",
    privacy_owner_approval: "ONQOL-PRIVACY-20260820",
  };
  for (const [key, approval_id] of Object.entries(ids)) {
    manifest.approvals[key] = {
      ...manifest.approvals[key],
      status: "approved",
      approval_id,
      reviewer: "Named reviewer",
      approved_at: "2026-08-20T10:00:00.000Z",
      evidence: "signed/review-record.md",
    };
  }
  return manifest;
}

test("dummy three-character values can never produce GO", () => {
  const result = evaluateReleaseGate(caseData, {
    OPENAI_API_KEY: "abc",
    ONQOL_MAIN_ACCESS_TOKEN: "abc",
    ONQOL_MAIN_ALLOWED_ORIGIN: "abc",
    ONQOL_CLINICAL_SIGNOFF_ID: "abc",
  });
  assert.equal(result.decision, "NO-GO");
  assert.ok(result.blocker_codes.includes("provider_key_invalid"));
  assert.ok(result.blocker_codes.includes("pilot_access_token_invalid"));
  assert.ok(result.blocker_codes.includes("exact_origin_invalid"));
});

test("valid credentials still cannot replace pending signed approvals", () => {
  const result = evaluateReleaseGate(caseData, validEnvironment());
  assert.equal(result.decision, "NO-GO");
  assert.ok(result.blocker_codes.includes("privacy_owner_approval_missing"));
});

test("REFERENCE-FULL approval is sufficient while KZ-R1/R2/R3 remain unreviewed", () => {
  const manifest = approvedManifest();
  manifest.approvals.resource_profile_review = structuredClone(
    PILOT_RELEASE_APPROVALS.approvals.resource_profile_review
  );
  const result = evaluateReleaseGate(caseData, validEnvironment(), manifest);
  assert.equal(result.decision, "GO");
  assert.equal(result.approval_manifest.statuses.resource_profile_review, "approved");
  assert.equal(result.blocker_codes.includes("resource_profile_review_missing"), false);
});

test("REFERENCE-FULL approval cannot authorize real facility mode", () => {
  const manifest = approvedManifest();
  manifest.approvals.resource_profile_review = structuredClone(
    PILOT_RELEASE_APPROVALS.approvals.resource_profile_review
  );
  const result = evaluateReleaseGate(
    caseData,
    {
      ...validEnvironment(),
      VITE_ONQOL_FULL_CLINICAL_TEST: "confirmed",
    },
    manifest
  );
  assert.equal(result.decision, "NO-GO");
  assert.ok(result.blocker_codes.includes("real_facility_mode_forbidden"));
});

test("GO requires strong configuration and matching approved manifest records", () => {
  const result = evaluateReleaseGate(caseData, validEnvironment(), approvedManifest());
  assert.equal(result.decision, "GO");
  assert.equal(result.deploy_allowed, true);
});

test("an approved manifest cannot silently widen the pilot scope", () => {
  const manifest = approvedManifest();
  manifest.scope.case_preset_ids = ["APP-001", "APP-002", "APP-003", "APP-005"];
  manifest.scope.excluded = manifest.scope.excluded.filter((item) => item !== "numeric_scoring");
  const result = evaluateReleaseGate(caseData, validEnvironment(), manifest);
  assert.equal(result.decision, "NO-GO");
  assert.ok(result.blocker_codes.includes("approval_manifest_invalid"));
});
