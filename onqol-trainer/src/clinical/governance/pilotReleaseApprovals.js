/**
 * Canonical pilot approval manifest.
 *
 * Code cannot manufacture any of these approvals. An owner changes one record
 * only after the named review or operational verification exists, and the
 * deployment environment must carry the same approval_id. That makes a release
 * reproducible and prevents arbitrary environment strings from impersonating a
 * signature.
 */
export const PILOT_RELEASE_APPROVAL_SCHEMA_VERSION = "pilot-release-approvals-v1.0";

const pending = (scope) => Object.freeze({
  status: "pending",
  approval_id: null,
  reviewer: null,
  approved_at: null,
  evidence: null,
  scope,
});

const approved = ({ approval_id, reviewer, approved_at, evidence, scope }) => Object.freeze({
  status: "approved",
  approval_id,
  reviewer,
  approved_at,
  evidence,
  scope,
});

export const PILOT_RELEASE_APPROVALS = Object.freeze({
  schema_version: PILOT_RELEASE_APPROVAL_SCHEMA_VERSION,
  pilot_scope_id: "ONQOL-RU-REFERENCE-APP001-004-FORMATIVE-2026-08",
  content_version: "3.5.7",
  scope: Object.freeze({
    locale: "ru",
    scenario_mode: "reference",
    case_preset_ids: Object.freeze(["APP-001", "APP-002", "APP-003", "APP-004"]),
    scoring_mode: "formative_only",
    excluded: Object.freeze([
      "kk_learner_mode",
      "real_facility_mode",
      "APP-005",
      "complication_paths",
      "alternative_hidden_truths",
      "numeric_scoring",
    ]),
  }),
  approvals: Object.freeze({
    provider_key_rotation: pending("Current production provider key was rotated and the old key revoked."),
    hosting_protection: pending("Production domain protection and authenticated access were verified on the deployed URL."),
    clinical_signoff: approved({
      approval_id: "ONQOL-CLINICAL-20260820",
      reviewer: "Сарина Т.Т., independent clinical reviewer",
      approved_at: "2026-08-20",
      evidence: "PILOT_CLINICAL_SIGNOFF_APP001_004_SARINA_TT_2026-08-20.pdf",
      scope:
        "N=8 residents; RU; REFERENCE-FULL; APP-001–004 stable learner path; " +
        "formative-only. Real facility mode, KK, APP-005, complications, alternative " +
        "hidden truths and numeric scoring excluded.",
    }),
    ru_language_review: pending(
      "All reachable learner-facing RU runtime copy in " +
      "PILOT_RU_RUNTIME_COPY_REVIEW_2026-08-20.md and the matching PDF; " +
      "structured snapshots in PILOT_RU_RUNTIME_SNAPSHOTS_2026-08-20.json."
    ),
    resource_profile_review: approved({
      approval_id: "ONQOL-REFERENCE-FULL-20260820",
      reviewer: "Каукенова Б.Н., clinical owner",
      approved_at: "2026-08-20T00:00:00+05:00",
      evidence: "REFERENCE_RESOURCE_PROFILE_PILOT_APPROVAL_2026-08-20.md",
      scope:
        "RU/reference/APP-001–004/formative-only; REFERENCE-FULL only; " +
        "real facility mode, KZ-R1/R2/R3, site routing, blood-product availability " +
        "and transfer destination excluded.",
    }),
    privacy_owner_approval: pending("Participant notice, consent, retention, export and deletion workflow."),
  }),
});
