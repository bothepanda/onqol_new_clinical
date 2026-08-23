/**
 * Runtime clinical-content governance gate (Governance Spec §7-8, §19;
 * Core Foundation Spec §47; task brief P0-5).
 *
 * `scripts/buildContentIndex.mjs` already enforces provenance fields at
 * author/build time. This module is the counterpart at RUN time: the one
 * place that decides whether a piece of reviewed-but-maybe-not-approved
 * content is allowed to become authoritative - patient truth, a safety
 * stop, or teaching the mentor is allowed to state as fact.
 *
 * Binding product-owner instruction (2026-08-23, recorded in
 * docs/IMPLEMENTATION_GAP_AUDIT_2026-08-23.md): strictly `approved_for_training`
 * only. `reviewed_internal`, `reviewed`, `draft`, `pending`, and anything
 * else - including the absence of the field - is NOT authoritative, and
 * this pass does not bulk-promote any existing content to reach that bar.
 *
 * What this gate does NOT cover, by design (Foundation Spec §44-46's
 * five-authority split): Hospital/World Engine operational data - resource
 * ETAs, staff arrival times, investigation turnaround - and Patient Engine
 * generation content (phenotype library, physiology envelopes) that
 * produces the patient itself rather than asserting a clinical rule about
 * safety, dosing, indication, or teaching. See the gap audit for the exact
 * reasoning; this file only gates Clinical Rule Layer content: rules,
 * treatment effects, disease trajectories, and complications.
 */

export const RUNTIME_AUTHORITATIVE_STATUS = "approved_for_training";

/** @param {string|undefined|null} reviewStatus */
export function isRuntimeAuthoritative(reviewStatus) {
  return reviewStatus === RUNTIME_AUTHORITATIVE_STATUS;
}

/**
 * Splits a list of items (rules, treatment effects, trajectories,
 * complications - anything carrying `review_status`) into what may act with
 * authority now and what is a recorded, auditable simulator limitation.
 *
 * Nothing is dropped: `blocked` entries are still returned so callers can
 * log/expose them as `SIMULATOR_LIMITATION`, never silently discard them
 * (Governance Spec §24 auditability; task §21 "must not be penalized").
 */
export function partitionByAuthority(items, getReviewStatus = (item) => item?.review_status) {
  const authoritative = [];
  const blocked = [];
  for (const item of items) {
    if (isRuntimeAuthoritative(getReviewStatus(item))) authoritative.push(item);
    else blocked.push(item);
  }
  return { authoritative, blocked };
}

/** A structured, non-clinical marker for "this would have applied, but isn't approved yet". */
export function simulatorLimitation({ kind, id, reviewStatus }) {
  return { kind, id, reviewStatus: reviewStatus ?? null, reason: "not_approved_for_training" };
}
