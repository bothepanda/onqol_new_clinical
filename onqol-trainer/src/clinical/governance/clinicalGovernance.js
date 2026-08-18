/**
 * Clinical evidence governance boundary.
 *
 * This module does not contain clinical truth. It decides whether a structured
 * rule is authorised to have a particular runtime effect. Language generation,
 * legacy transcripts and source metadata alone can never grant that authority.
 */

export const CLINICAL_GOVERNANCE_VERSION = "clinical-governance-v1.0";
export const SOURCE_REGISTRY_VERSION = "source-registry-v1.0";
export const CLINICAL_RULE_REGISTRY_VERSION = "clinical-rule-registry-v1.0";

export const CLINICAL_RULE_STATUS = Object.freeze({
  DRAFT: "draft",
  REVIEWED: "reviewed",
  APPROVED: "approved_for_training",
  DEPRECATED: "deprecated",
});

export const CLINICAL_RUNTIME_EFFECT = Object.freeze({
  PATIENT_TRUTH: "patient_truth",
  MENTOR_TEACHING: "mentor_teaching",
  SAFETY_VERDICT: "safety_verdict",
  AUTHORITATIVE_CORRECTION: "authoritative_correction",
  CRITICAL_PATHWAY_TRANSITION: "critical_pathway_transition",
  SCORING: "scoring",
});

export const HIGH_RISK_RULE_TYPES = Object.freeze([
  "medication_dose",
  "fluid_dose",
  "fluid_rate",
  "anticoagulation",
  "antibiotic",
  "blood_product",
  "vasoactive_drug",
  "airway_parameter",
  "ventilation_parameter",
  "invasive_procedure",
  "operative_indication",
  "source_control_timing",
  "icu_criterion",
  "transfer_criterion",
  "contraindication",
  "emergency_threshold",
]);

/**
 * Minimal registry scaffold. Metadata is migrated only from the existing
 * appendicitis source package. `last_checked` deliberately remains null: the
 * package's clinical-review date is not proof that either source was checked
 * on that date. Neither entry grants runtime authority by itself.
 */
export const SOURCE_REGISTRY = Object.freeze([
  Object.freeze({
    source_id: "WSES2025",
    organization: "World Society of Emergency Surgery",
    title:
      "Diagnosis and Treatment of Acute Appendicitis: 2025 Edition of the World Society of Emergency Surgery Jerusalem Guidelines",
    year_version: "2025 edition; publication year 2026",
    identifier: "10.1001/jamasurg.2025.6218",
    jurisdiction: "reference",
    last_checked: null,
    status: "needs_verification",
    migrated_from: "src/clinical/diseases/appendicitis/appendicitis.core.yaml",
    legacy_v1: false,
  }),
  Object.freeze({
    source_id: "KZ_AA_2018",
    organization:
      "Объединенная комиссия по качеству медицинских услуг Министерства здравоохранения Республики Казахстан",
    title: "Клинический протокол диагностики и лечения: Острый аппендицит",
    year_version: "2018; approval 2019-03-04; protocol 61",
    identifier: "protocol-61",
    jurisdiction: "KZ",
    last_checked: null,
    status: "needs_verification",
    migrated_from: "src/clinical/diseases/appendicitis/appendicitis.core.yaml",
    legacy_v1: false,
  }),
]);

/**
 * Incremental migration ledger, not an assertion that legacy content is ready.
 * These rows are intentionally non-authoritative until independent approval.
 */
export const CLINICAL_RULE_REGISTRY = Object.freeze([
  Object.freeze({
    rule_id: "APP-WSES-R9.1",
    module: "acute_appendicitis",
    rule_type: "source_control_timing",
    claim:
      "Perform laparoscopic appendectomy within 24 hours of hospital admission for adults with uncomplicated acute appendicitis selected for surgery.",
    conditions: ["adult", "uncomplicated", "selected_for_surgery"],
    exceptions: [],
    jurisdiction: "reference",
    resource_context: ["laparoscopy_available"],
    source_ids: ["WSES2025"],
    evidence_strength: "as_reported_by_source",
    review_status: CLINICAL_RULE_STATUS.REVIEWED,
    risk_class: "high",
    reviewed_by: [],
    reviewed_at: null,
    next_review_due: null,
    supersedes: null,
    allowed_runtime_effects: [],
    tests: [],
    migration_note:
      "Existing internally reviewed source mapping; independent approval and reviewer identities are still missing.",
    legacy_v1: false,
  }),
]);

function uniqueStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string" && item.trim()))]
    : [];
}

export function validateSourceRegistry(sources = SOURCE_REGISTRY) {
  const errors = [];
  const ids = new Set();
  for (const source of sources) {
    if (!source?.source_id) errors.push("source_id is required");
    if (ids.has(source?.source_id)) errors.push(`duplicate source_id: ${source.source_id}`);
    ids.add(source?.source_id);
    for (const field of ["organization", "title", "year_version", "jurisdiction", "status"]) {
      if (!source?.[field]) errors.push(`${source?.source_id || "unknown"}: ${field} is required`);
    }
    if (source?.legacy_v1 === true) {
      errors.push(`${source.source_id}: legacy V1 material is forbidden in the source registry`);
    }
  }
  return { ok: errors.length === 0, errors, sourceIds: ids };
}

export function validateClinicalRule(rule, sources = SOURCE_REGISTRY) {
  const errors = [];
  const sourceIds = new Set(sources.map((source) => source.source_id));
  const statuses = new Set(Object.values(CLINICAL_RULE_STATUS));
  const effects = new Set(Object.values(CLINICAL_RUNTIME_EFFECT));

  if (!rule?.rule_id) errors.push("rule_id is required");
  if (!rule?.module) errors.push(`${rule?.rule_id || "unknown"}: module is required`);
  if (!rule?.rule_type) errors.push(`${rule?.rule_id || "unknown"}: rule_type is required`);
  if (!rule?.claim) errors.push(`${rule?.rule_id || "unknown"}: claim is required`);
  if (!statuses.has(rule?.review_status)) {
    errors.push(`${rule?.rule_id || "unknown"}: invalid review_status`);
  }
  if (rule?.legacy_v1 === true) {
    errors.push(`${rule.rule_id}: legacy V1 material cannot be clinical evidence`);
  }

  const ruleSources = uniqueStrings(rule?.source_ids);
  if (!ruleSources.length) errors.push(`${rule?.rule_id || "unknown"}: source_ids are required`);
  for (const sourceId of ruleSources) {
    if (!sourceIds.has(sourceId)) errors.push(`${rule.rule_id}: unknown source ${sourceId}`);
  }

  const allowedEffects = uniqueStrings(rule?.allowed_runtime_effects);
  for (const effect of allowedEffects) {
    if (!effects.has(effect)) errors.push(`${rule.rule_id}: unknown runtime effect ${effect}`);
  }
  if (rule?.review_status !== CLINICAL_RULE_STATUS.APPROVED && allowedEffects.length) {
    errors.push(`${rule.rule_id}: non-approved rule cannot have runtime effects`);
  }
  if (
    rule?.review_status === CLINICAL_RULE_STATUS.APPROVED &&
    (rule?.risk_class === "high" || HIGH_RISK_RULE_TYPES.includes(rule?.rule_type)) &&
    uniqueStrings(rule?.reviewed_by).length < 2
  ) {
    errors.push(`${rule.rule_id}: high-risk approval requires at least two reviewers`);
  }
  return { ok: errors.length === 0, errors };
}

export function ruleAllowsRuntimeEffect(rule, effect, sources = SOURCE_REGISTRY) {
  if (!rule || rule.review_status !== CLINICAL_RULE_STATUS.APPROVED) return false;
  if (!validateClinicalRule(rule, sources).ok) return false;
  return uniqueStrings(rule.allowed_runtime_effects).includes(effect);
}

export function approvedRulesForEffect(
  ruleIds,
  effect,
  registry = CLINICAL_RULE_REGISTRY,
  sources = SOURCE_REGISTRY
) {
  const requested = new Set(uniqueStrings(ruleIds));
  return registry.filter(
    (rule) => requested.has(rule.rule_id) && ruleAllowsRuntimeEffect(rule, effect, sources)
  );
}

export function clinicalGovernanceReadiness(
  registry = CLINICAL_RULE_REGISTRY,
  sources = SOURCE_REGISTRY
) {
  const sourceValidation = validateSourceRegistry(sources);
  const ruleErrors = registry.flatMap((rule) => validateClinicalRule(rule, sources).errors);
  const pendingRules = registry
    .filter((rule) => rule.review_status !== CLINICAL_RULE_STATUS.APPROVED)
    .map((rule) => rule.rule_id);
  return {
    version: CLINICAL_GOVERNANCE_VERSION,
    source_registry_version: SOURCE_REGISTRY_VERSION,
    clinical_rule_registry_version: CLINICAL_RULE_REGISTRY_VERSION,
    structurally_valid: sourceValidation.ok && ruleErrors.length === 0,
    errors: [...sourceValidation.errors, ...ruleErrors],
    pending_rule_ids: pendingRules,
    learner_release_ready: sourceValidation.ok && ruleErrors.length === 0 && pendingRules.length === 0,
  };
}

