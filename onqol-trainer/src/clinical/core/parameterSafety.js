/**
 * Parameter safety is a fail-safe gate, not a prescribing engine.
 *
 * The pilot has no approved range for weight-based IV fluid orders. Such an
 * order is preserved as written, classified `not_yet_reviewed`, and not applied
 * until an approved rule exists. This does not label the value wrong and never
 * invents a replacement.
 */

import {
  CLINICAL_RUNTIME_EFFECT,
  ruleAllowsRuntimeEffect,
} from "../governance/clinicalGovernance.js";

/**
 * Three blocked orders, three different things to say.
 *
 * 1. REVIEWED_UNSAFE - a reviewed rule looked at the stated parameter and
 *    rejected it. The pilot knows the range and this order is outside it. Danger,
 *    and it speaks like danger.
 * 2. HIGH_RISK_AWAITING_REVIEW - the parameter belongs to a class this file
 *    enumerates as high risk (weight-based fluid volume) and no reviewed rule
 *    exists yet. The pilot cannot tell 20 ml/kg from 200, so it fails safe and
 *    still stops. This is the behaviour PARAMETER_SAFETY_RULES exists for.
 * 3. NO_REVIEWED_CONTENT - a drug or parameter the pilot holds nothing about at
 *    all. It is a gap in the training content, not a verdict on the learner, and
 *    it must not be spoken in the register of danger. This is the "Стоп: ... не
 *    прошли проверку" the live run of 20.08.2026 printed for an order nobody had
 *    objected to.
 *
 * All three keep the order off the patient - that is decided by blocks_application
 * and does not change. Only the first two are danger.
 */
export const PARAMETER_GOVERNANCE_CLASS = Object.freeze({
  HIGH_RISK_AWAITING_REVIEW: "high_risk_parameter_awaiting_review",
  NO_REVIEWED_CONTENT: "no_reviewed_content",
});

export const REVIEWED_UNSAFE_VERDICTS = Object.freeze([
  "reviewed_unsafe",
  "reviewed_questionable",
]);

export function isReviewedUnsafeParameter(signal) {
  return REVIEWED_UNSAFE_VERDICTS.includes(signal?.safety_verdict);
}

/**
 * Blocked because the pilot holds nothing about it - case 3. Not danger, and the
 * only one of the three whose wording changes.
 */
export function isGovernanceGapParameter(signal) {
  return (
    Boolean(signal?.blocks_application) &&
    !isReviewedUnsafeParameter(signal) &&
    signal?.governance_class === PARAMETER_GOVERNANCE_CLASS.NO_REVIEWED_CONTENT
  );
}

/** Cases 1 and 2: the mentor stops, and says so. */
export function parameterFailsSafeIntoStop(signal) {
  return Boolean(signal?.blocks_application) && !isGovernanceGapParameter(signal);
}

export const PARAMETER_SAFETY_RULES = Object.freeze([
  Object.freeze({
    coverage_id: "iv_fluid_weight_based_not_yet_reviewed_v1",
    concept_ids: ["iv_fluids"],
    parameter: "volume_per_weight",
    unit: "ml/kg",
    review_status: "not_yet_reviewed",
    safety_verdict: "not_yet_reviewed",
    governance_policy_id: "GOV-PARAMETER-UNREVIEWED-001",
    blocks_application: true,
  }),
]);

const PER_KG_RE = /(?:из\s+расч[её]та\s+)?(\d+(?:[.,]\d+)?)\s*мл\s*(?:\/|на)\s*(?:кг|килограмм[а-я]*)/iu;

function normaliseUnit(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/миллилитр[а-я]*/g, "мл")
    .replace(/килограмм[а-я]*/g, "кг")
    .replace(/\s+/g, "")
    .replace("млнакг", "мл/кг")
    .replace("ml/kg", "мл/кг");
}

function parameterFromEntry(entry) {
  const unit = normaliseUnit(entry?.dose_unit);
  if (unit !== "мл/кг") return null;
  const value = Number(entry?.dose_value);
  if (!Number.isFinite(value)) return null;
  return { value, unit: "ml/kg", verbatim: entry.verbatim || null };
}

function hasTranscribedTreatmentParameter(entry) {
  return Boolean(
    entry?.verbatim && (
      entry.drug_name ||
      entry.dose_value !== null && entry.dose_value !== undefined ||
      entry.dose_unit ||
      entry.route ||
      entry.rate ||
      entry.frequency ||
      entry.duration ||
      entry.fluid_type ||
      entry.volume_ml !== null && entry.volume_ml !== undefined ||
      entry.timing
    )
  );
}

/** Deterministic transcription fallback for the one structured pilot shape. */
export function extractWeightBasedFluidParameter(input, actionIds = []) {
  if (!actionIds.includes("iv_fluids")) return null;
  const match = String(input || "").match(PER_KG_RE);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return {
    concept_id: "iv_fluids",
    verbatim: match[0],
    drug_name: null,
    dose_value: value,
    dose_unit: "мл/кг",
    route: null,
    rate: null,
    frequency: null,
    duration: null,
    fluid_type: null,
    volume_ml: null,
    timing: null,
    review_status: "transcribed_not_validated",
    eligible_for_scoring: false,
  };
}

/**
 * Returns structured review records. A verdict of `requires_clinical_review`
 * is a process verdict: the pilot lacks a reviewed range, so it fails closed.
 */
function matchingApprovedRule(entry, parsed, clinicalRules, sourceRegistry) {
  return (clinicalRules || []).find((rule) => {
    const contract = rule.parameter_contract;
    return (
      ruleAllowsRuntimeEffect(rule, CLINICAL_RUNTIME_EFFECT.SAFETY_VERDICT, sourceRegistry) &&
      contract?.concept_ids?.includes(entry.concept_id) &&
      contract?.parameter === "volume_per_weight" &&
      contract?.unit === parsed.unit
    );
  });
}

function reviewedVerdict(rule, parsed, sourceRegistry) {
  const range = rule.parameter_contract?.safe_range;
  if (!range || !Number.isFinite(range.min) || !Number.isFinite(range.max)) {
    return null;
  }
  const safe = parsed.value >= range.min && parsed.value <= range.max;
  return {
    review_status: "approved_for_training",
    safety_verdict: safe ? "reviewed_safe" : rule.parameter_contract.outside_verdict || "reviewed_unsafe",
    source_rule_id: rule.rule_id,
    governance_policy_id: null,
    blocks_application: !safe,
    authoritative_correction:
      !safe &&
      ruleAllowsRuntimeEffect(
        rule,
        CLINICAL_RUNTIME_EFFECT.AUTHORITATIVE_CORRECTION,
        sourceRegistry
      )
        ? rule.authoritative_correction || null
        : null,
  };
}

export function reviewActionParameters(
  parameters = [],
  input = "",
  actionIds = [],
  options = {}
) {
  const entries = [...parameters];
  const fallback = extractWeightBasedFluidParameter(input, actionIds);
  if (
    fallback &&
    !entries.some(
      (entry) => entry.concept_id === "iv_fluids" && parameterFromEntry(entry)
    )
  ) {
    entries.push(fallback);
  }

  const reviews = [];
  for (const entry of entries) {
    const parsed = parameterFromEntry(entry);
    if (!parsed) {
      if (!hasTranscribedTreatmentParameter(entry)) continue;
      reviews.push({
        concept_id: entry.concept_id,
        parameter: "treatment_order",
        value: entry.dose_value ?? entry.volume_ml ?? null,
        unit: entry.dose_unit || (entry.volume_ml !== null ? "ml" : null),
        verbatim: entry.verbatim,
        recognized_drug: entry.drug_name || null,
        parameter_validation_status: "not_yet_reviewed",
        review_status: "not_yet_reviewed",
        safety_verdict: "not_yet_reviewed",
        source_rule_id: null,
        governance_policy_id: "GOV-PARAMETER-UNREVIEWED-001",
        blocks_application: true,
        applied_to_patient: false,
        governance_class: PARAMETER_GOVERNANCE_CLASS.NO_REVIEWED_CONTENT,
        blocking_reason: entry.drug_name
          ? "drug_or_parameter_not_validated"
          : "parameter_not_validated",
        authoritative_correction: null,
      });
      continue;
    }
    const coverage = PARAMETER_SAFETY_RULES.find(
      (candidate) =>
        candidate.concept_ids.includes(entry.concept_id) && candidate.unit === parsed.unit
    );
    if (!coverage) continue;
    const approvedRule = matchingApprovedRule(
      entry,
      parsed,
      options.clinicalRules,
      options.sourceRegistry
    );
    const governed = approvedRule
      ? reviewedVerdict(approvedRule, parsed, options.sourceRegistry)
      : null;
    reviews.push({
      concept_id: entry.concept_id,
      parameter: coverage.parameter,
      value: parsed.value,
      unit: parsed.unit,
      verbatim: parsed.verbatim,
      review_status: governed?.review_status || coverage.review_status,
      safety_verdict: governed?.safety_verdict || coverage.safety_verdict,
      source_rule_id: governed?.source_rule_id || null,
      governance_policy_id:
        governed?.governance_policy_id || coverage.governance_policy_id,
      blocks_application: governed?.blocks_application ?? coverage.blocks_application,
      authoritative_correction: governed?.authoritative_correction || null,
      recognized_drug: entry.drug_name || null,
      // An enumerated high-risk class. Until a rule exists the pilot cannot tell a
      // safe figure from a lethal one, so this one fails safe and keeps stopping.
      governance_class: PARAMETER_GOVERNANCE_CLASS.HIGH_RISK_AWAITING_REVIEW,
      parameter_validation_status: governed?.review_status || coverage.review_status,
      applied_to_patient: !(governed?.blocks_application ?? coverage.blocks_application),
      blocking_reason: (governed?.blocks_application ?? coverage.blocks_application)
        ? "parameter_not_validated"
        : null,
    });
  }
  return { parameters: entries, reviews };
}
