import { localeReadiness } from "./locale.js";
import { v35Readiness } from "./manifest.js";
import { clinicalGovernanceReadiness } from "../governance/clinicalGovernance.js";

const REQUIRED_CONFIRMATIONS = Object.freeze([
  ["ONQOL_PROVIDER_KEY_ROTATED", "confirmed", "provider_key_rotation_unconfirmed"],
  ["ONQOL_HOSTING_AUTH_CONFIRMED", "confirmed", "hosting_protection_unconfirmed"],
  ["ONQOL_CLINICAL_SIGNOFF_ID", null, "clinical_signoff_missing"],
  ["ONQOL_RU_LANGUAGE_REVIEW_ID", null, "ru_language_review_missing"],
  ["ONQOL_RESOURCE_PROFILE_REVIEW_ID", null, "resource_profile_review_missing"],
  ["ONQOL_PRIVACY_OWNER_APPROVAL_ID", null, "privacy_owner_approval_missing"],
]);

function confirmed(value, exact = null) {
  if (exact !== null) return value === exact;
  return typeof value === "string" && value.trim().length >= 3;
}

/** A machine-readable NO-GO/GO decision. No secret values are returned. */
export function evaluateReleaseGate(caseData, env = {}) {
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
  if (!confirmed(env.OPENAI_API_KEY)) blockers.push("provider_key_missing");
  if (!confirmed(env.ONQOL_MAIN_ACCESS_TOKEN)) blockers.push("pilot_access_token_missing");
  if (!confirmed(env.ONQOL_MAIN_ALLOWED_ORIGIN)) blockers.push("exact_origin_missing");
  for (const [name, exact, blocker] of REQUIRED_CONFIRMATIONS) {
    if (!confirmed(env[name], exact)) blockers.push(blocker);
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
  };
}
