/**
 * Reading the provenance of one piece of clinical content.
 *
 * The 2026-08-25 remediation pass introduced the full provenance schema the
 * review task §21 requires:
 *
 *   id, authority_layer, jurisdiction, source, source_version_or_date,
 *   evidence_strength, review_status, reviewed_by, reviewed_at,
 *   second_review_required, second_reviewed_by, second_reviewed_at,
 *   next_review_due, notes
 *
 * Content authored before that pass carried a bare top-level `review_status`.
 * Both shapes are read through this module so no call site has to know which
 * one it is looking at, and so `scripts/buildContentIndex.mjs` can fail the
 * build when the two disagree.
 *
 * This module deliberately answers only "what does the content SAY about
 * itself". Whether that is enough to act with authority is
 * `core/rules/governance.js`, and the two are kept apart so a future change to
 * the promotion bar touches one file.
 */

/** The five authority layers (Core Runtime Spec §44-46, matrix "Authority layer"). */
export const AUTHORITY_LAYER = Object.freeze({
  PATIENT_TRUTH: "patient_truth",
  CLINICAL_RULE: "clinical_rule",
  CLINICAL_WORKFLOW: "clinical_workflow",
  CLINICAL_PATHWAY: "clinical_pathway",
  HOSPITAL_RULE: "hospital_rule",
  HOSPITAL_WORKFLOW: "hospital_workflow",
  SIMULATION_BEHAVIOR: "simulation_behavior",
  MENTOR_BEHAVIOR: "mentor_behavior",
  WORKFLOW: "workflow",
});

/**
 * A hospital/jurisdiction requirement is NOT universal medicine and must never
 * be taught as such (matrix §13). Callers use this to label a debrief entry.
 */
export const JURISDICTIONAL_LAYERS = Object.freeze([
  AUTHORITY_LAYER.HOSPITAL_RULE,
  AUTHORITY_LAYER.HOSPITAL_WORKFLOW,
]);

export function provenanceOf(item) {
  return item?.provenance ?? null;
}

/**
 * The single canonical read of a content object's review status.
 *
 * `provenance.review_status` wins when present; a bare top-level
 * `review_status` is the legacy fallback. `undefined` (no status at all) is
 * returned as-is, and `governance.js` treats it as not authoritative - a
 * missing status has never meant "approved".
 */
export function reviewStatusOf(item) {
  if (item == null) return undefined;
  return item.provenance?.review_status ?? item.review_status;
}

export function authorityLayerOf(item) {
  return item?.provenance?.authority_layer ?? item?.authority_layer ?? null;
}

export function jurisdictionOf(item) {
  return item?.provenance?.jurisdiction ?? item?.jurisdiction ?? null;
}

export function isJurisdictional(item) {
  return JURISDICTIONAL_LAYERS.includes(authorityLayerOf(item));
}

/**
 * Does this item still owe an independent second review before it may be
 * promoted? High-risk domains (medication dosing, anaesthesia, high-risk
 * operative safety, pharmacologic VTE prophylaxis) all set this (matrix
 * "Pass 4: independent review").
 */
export function needsSecondReview(item) {
  const provenance = provenanceOf(item);
  if (!provenance) return item?.second_review_required === true;
  if (provenance.second_review_required !== true) return false;
  return provenance.second_reviewed_by == null;
}

/**
 * A flat, exportable provenance record for the debrief / session export /
 * review inventory. Never invents a reviewer: an unreviewed item exports
 * `reviewed_by: null`, which is exactly what the task §21 asks for.
 */
export function provenanceRecord(item, fallbackId = null) {
  const provenance = provenanceOf(item) ?? {};
  return {
    id: provenance.id ?? item?.id ?? fallbackId,
    authority_layer: authorityLayerOf(item),
    jurisdiction: jurisdictionOf(item),
    source: provenance.source ?? null,
    source_version_or_date: provenance.source_version_or_date ?? null,
    evidence_strength: provenance.evidence_strength ?? null,
    review_status: reviewStatusOf(item) ?? null,
    reviewed_by: provenance.reviewed_by ?? null,
    reviewed_at: provenance.reviewed_at ?? null,
    second_review_required: provenance.second_review_required ?? false,
    second_reviewed_by: provenance.second_reviewed_by ?? null,
    second_reviewed_at: provenance.second_reviewed_at ?? null,
    next_review_due: provenance.next_review_due ?? null,
    notes: provenance.notes ?? null,
  };
}
