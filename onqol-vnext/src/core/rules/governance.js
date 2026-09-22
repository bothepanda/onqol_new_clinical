/**
 * Runtime clinical-content governance gate (Governance Spec §7-8, §19;
 * Core Runtime Spec §47; task brief P0-5).
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
 * What this gate does NOT cover, by design (Core Runtime Spec §44-46's
 * five-authority split): Hospital/World Engine operational data - resource
 * ETAs, staff arrival times, investigation turnaround. Those are operational
 * facts about a simulated hospital, not clinical claims.
 *
 * PATIENT GENERATION IS NO LONGER AN EXCEPTION (matrix §G1, 2026-08-25).
 * The previous version of this comment excused phenotype/physiology content
 * from the gate because otherwise no patient could be generated. The clinical
 * review rejected that: patient generation is explicitly Patient Truth and
 * cannot be a permanent carve-out. It is still instantiated for internal
 * development, but `core/patient/patientTruthGovernance.js` now inventories
 * every generating content object, records each non-approved one as a
 * SIMULATOR_LIMITATION on session start, and marks the whole session
 * `patientTruthApproved: false` so no build carrying unapproved patient truth
 * can be represented as pilot-ready.
 */

import { reviewStatusOf } from "./contentProvenance.js";

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
export function partitionByAuthority(items, getReviewStatus = reviewStatusOf) {
  const authoritative = [];
  const blocked = [];
  for (const item of items) {
    if (isRuntimeAuthoritative(getReviewStatus(item))) authoritative.push(item);
    else blocked.push(item);
  }
  return { authoritative, blocked };
}

/**
 * The gate applied to a whole content OBJECT rather than a bare status string.
 * Added in the 2026-08-25 remediation pass so call sites stop reaching for
 * `item.review_status` directly and pick up `provenance.review_status`
 * automatically (see `contentProvenance.js`).
 */
export function isContentAuthoritative(item) {
  return isRuntimeAuthoritative(reviewStatusOf(item));
}

/** A structured, non-clinical marker for "this would have applied, but isn't approved yet". */
export function simulatorLimitation({ kind, id, reviewStatus, reason = "not_approved_for_training" }) {
  return { kind, id, reviewStatus: reviewStatus ?? null, reason };
}

/** The platform has no modeled content for this at all (as opposed to content that exists but is not approved). */
export const LIMITATION_REASON_NOT_MODELED = "not_modeled";
