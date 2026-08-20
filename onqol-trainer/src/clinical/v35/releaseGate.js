import { localeReadiness } from "./locale.js";
import { v35Readiness } from "./manifest.js";
import { clinicalGovernanceReadiness } from "../governance/clinicalGovernance.js";
import {
  PILOT_RELEASE_APPROVALS,
  PILOT_RELEASE_APPROVAL_SCHEMA_VERSION,
} from "../governance/pilotReleaseApprovals.js";

const REQUIRED_APPROVALS = Object.freeze([
  ["provider_key_rotation", "ONQOL_PROVIDER_KEY_ROTATION_ID", "provider_key_rotation_unconfirmed"],
  ["hosting_protection", "ONQOL_HOSTING_PROTECTION_ID", "hosting_protection_unconfirmed"],
  ["clinical_signoff", "ONQOL_CLINICAL_SIGNOFF_ID", "clinical_signoff_missing"],
  ["ru_language_review", "ONQOL_RU_LANGUAGE_REVIEW_ID", "ru_language_review_missing"],
  ["resource_profile_review", "ONQOL_RESOURCE_PROFILE_REVIEW_ID", "resource_profile_review_missing"],
  ["privacy_owner_approval", "ONQOL_PRIVACY_OWNER_APPROVAL_ID", "privacy_owner_approval_missing"],
]);
const PILOT_SCOPE_ID = "ONQOL-RU-REFERENCE-APP001-004-FORMATIVE-2026-08";
const PILOT_PRESET_IDS = Object.freeze(["APP-001", "APP-002", "APP-003", "APP-004"]);
const PILOT_EXCLUSIONS = Object.freeze([
  "kk_learner_mode",
  "real_facility_mode",
  "APP-005",
  "complication_paths",
  "alternative_hidden_truths",
  "numeric_scoring",
]);

function validProviderKey(value) {
  return typeof value === "string" && /^sk-[A-Za-z0-9_-]{16,}$/.test(value.trim());
}

function validAccessToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  return token.length >= 24 && !/(example|placeholder|changeme|test-token|^abc$)/i.test(token);
}

function validExactHttpsOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.origin === value.trim();
  } catch {
    return false;
  }
}

function approvalValid(manifest, approvalKey, envValue) {
  const approval = manifest?.approvals?.[approvalKey];
  if (!approval || approval.status !== "approved") return false;
  if (typeof approval.approval_id !== "string" || !/^ONQOL-[A-Z0-9-]{12,}$/.test(approval.approval_id)) {
    return false;
  }
  if (envValue !== approval.approval_id) return false;
  if (typeof approval.reviewer !== "string" || approval.reviewer.trim().length < 3) return false;
  if (typeof approval.evidence !== "string" || approval.evidence.trim().length < 3) return false;
  return Number.isFinite(Date.parse(approval.approved_at));
}

function approvalBlocker(manifest, approvalKey, envValue, pendingBlocker) {
  const approval = manifest?.approvals?.[approvalKey];
  if (!approval || approval.status !== "approved") return pendingBlocker;
  if (
    typeof approval.approval_id !== "string" ||
    !/^ONQOL-[A-Z0-9-]{12,}$/.test(approval.approval_id) ||
    typeof approval.reviewer !== "string" ||
    approval.reviewer.trim().length < 3 ||
    typeof approval.evidence !== "string" ||
    approval.evidence.trim().length < 3 ||
    !Number.isFinite(Date.parse(approval.approved_at))
  ) {
    return `${approvalKey}_manifest_record_invalid`;
  }
  if (!envValue) return `${approvalKey}_deployment_id_missing`;
  if (!approvalValid(manifest, approvalKey, envValue)) {
    return `${approvalKey}_deployment_id_mismatch`;
  }
  return null;
}

function manifestValid(manifest, contentVersion) {
  return Boolean(
    manifest &&
    manifest.schema_version === PILOT_RELEASE_APPROVAL_SCHEMA_VERSION &&
    manifest.pilot_scope_id === PILOT_SCOPE_ID &&
    manifest.content_version === contentVersion &&
    manifest.scope?.locale === "ru" &&
    manifest.scope?.scenario_mode === "reference" &&
    manifest.scope?.scoring_mode === "formative_only" &&
    JSON.stringify(manifest.scope?.case_preset_ids) === JSON.stringify(PILOT_PRESET_IDS) &&
    JSON.stringify(manifest.scope?.excluded) === JSON.stringify(PILOT_EXCLUSIONS)
  );
}

/** A machine-readable NO-GO/GO decision. No secret values are returned. */
export function evaluateReleaseGate(caseData, env = {}, approvalManifest = PILOT_RELEASE_APPROVALS) {
  const readiness = v35Readiness(caseData);
  const locales = localeReadiness();
  const governance = clinicalGovernanceReadiness();
  const ru = locales.find((row) => row.locale === "ru");
  const kk = locales.find((row) => row.locale === "kk");
  const blockers = [];

  if (!readiness.manifest_valid) blockers.push("v35_manifest_invalid");
  if (!governance.structurally_valid) blockers.push("clinical_governance_invalid");
  if (!governance.learner_release_ready) blockers.push("clinical_rule_registry_not_approved");
  blockers.push(...readiness.blocking_for_release.map((_, index) => `v35_runtime_blocker_${index + 1}`));
  if (!ru?.learner_ready) blockers.push("ru_locale_incomplete");
  if (env.ONQOL_ENABLE_KK === "confirmed" && !kk?.learner_ready) {
    blockers.push("kk_locale_incomplete");
  }
  if (
    env.ONQOL_ENABLE_REAL_MODE === "confirmed" ||
    env.VITE_ONQOL_FULL_CLINICAL_TEST === "confirmed"
  ) {
    blockers.push("real_facility_mode_forbidden");
  }
  if (!env.OPENAI_API_KEY) blockers.push("provider_key_missing");
  else if (!validProviderKey(env.OPENAI_API_KEY)) blockers.push("provider_key_invalid");
  if (!env.ONQOL_MAIN_ACCESS_TOKEN) blockers.push("pilot_access_token_missing");
  else if (!validAccessToken(env.ONQOL_MAIN_ACCESS_TOKEN)) blockers.push("pilot_access_token_invalid");
  if (!env.ONQOL_MAIN_ALLOWED_ORIGIN) blockers.push("exact_origin_missing");
  else if (!validExactHttpsOrigin(env.ONQOL_MAIN_ALLOWED_ORIGIN)) blockers.push("exact_origin_invalid");
  if (!manifestValid(approvalManifest, readiness.content_version)) {
    blockers.push("approval_manifest_invalid");
  }
  for (const [approvalKey, envName, blocker] of REQUIRED_APPROVALS) {
    const approvalFailure = approvalBlocker(
      approvalManifest,
      approvalKey,
      env[envName],
      blocker
    );
    if (approvalFailure) blockers.push(approvalFailure);
  }

  return {
    decision: blockers.length === 0 ? "GO" : "NO-GO",
    deploy_allowed: blockers.length === 0,
    content_version: readiness.content_version,
    manifest_valid: readiness.manifest_valid,
    scoring_mode: caseData.scoring?.mode || null,
    enabled_locales: env.ONQOL_ENABLE_KK === "confirmed" ? ["ru", "kk"] : ["ru"],
    locale_status: locales.map((row) => ({
      locale: row.locale,
      learner_ready: row.learner_ready,
      missing_keys: row.missing.length,
    })),
    blocker_codes: [...new Set(blockers)],
    runtime_blockers: readiness.blocking_for_release,
    clinical_governance: governance,
    approval_manifest: {
      schema_version: approvalManifest?.schema_version || null,
      pilot_scope_id: approvalManifest?.pilot_scope_id || null,
      content_version: approvalManifest?.content_version || null,
      statuses: Object.fromEntries(
        Object.entries(approvalManifest?.approvals || {}).map(([key, value]) => [key, value.status])
      ),
    },
  };
}
