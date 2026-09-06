/**
 * Audience/release gate for session creation.
 *
 * Patient generation remains available to tests and authoring tools. The
 * release boundary is the SESSION: a learner-facing audience may not receive a
 * generated patient unless both the preset and every patient-truth dependency
 * meet the required governance status.
 */
export const SESSION_PURPOSE = Object.freeze({
  INTERNAL_DEVELOPMENT: "internal_development",
  FACULTY_PREVIEW: "faculty_preview",
  LEARNER_PILOT: "learner_pilot",
  PRODUCTION: "production",
});

export const PRESET_RUNTIME_STATUS = Object.freeze({
  REVIEW_PENDING: "review_pending",
  DEVELOPMENT_ONLY: "development_only",
  FACULTY_PREVIEW: "faculty_preview",
  LEARNER_ENABLED: "learner_enabled",
  APPROVED_FOR_TRAINING: "approved_for_training",
});

const KNOWN_PURPOSES = new Set(Object.values(SESSION_PURPOSE));
const INTERNAL_STATUSES = new Set(Object.values(PRESET_RUNTIME_STATUS));
const FACULTY_STATUSES = new Set([
  PRESET_RUNTIME_STATUS.DEVELOPMENT_ONLY,
  PRESET_RUNTIME_STATUS.FACULTY_PREVIEW,
]);
const PILOT_STATUSES = new Set([
  PRESET_RUNTIME_STATUS.LEARNER_ENABLED,
  PRESET_RUNTIME_STATUS.APPROVED_FOR_TRAINING,
]);

export class SessionAudienceGateError extends Error {
  constructor(code, details = {}) {
    super(`Session audience gate rejected creation: ${code}`);
    this.name = "SessionAudienceGateError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Pure decision function, kept separate from createSession so future release
 * fixtures can prove the gate without fabricating a clinical bundle.
 */
export function evaluateSessionAudience({ sessionPurpose, preset, patientTruthApproved, productionRelease }) {
  if (!KNOWN_PURPOSES.has(sessionPurpose)) {
    return rejection("session_purpose_required_or_unknown", { sessionPurpose });
  }
  if (!preset) return rejection("case_preset_not_found");

  const runtimeStatus = preset.runtime_status ?? null;
  if (sessionPurpose === SESSION_PURPOSE.INTERNAL_DEVELOPMENT) {
    return INTERNAL_STATUSES.has(runtimeStatus)
      ? acceptance()
      : rejection("preset_not_enabled_for_internal_development", { runtimeStatus });
  }

  if (sessionPurpose === SESSION_PURPOSE.FACULTY_PREVIEW) {
    return FACULTY_STATUSES.has(runtimeStatus)
      ? acceptance()
      : rejection("preset_not_enabled_for_faculty_preview", { runtimeStatus });
  }

  if (sessionPurpose === SESSION_PURPOSE.LEARNER_PILOT) {
    if (!PILOT_STATUSES.has(runtimeStatus)) {
      return rejection("preset_not_learner_enabled", { runtimeStatus });
    }
    if (patientTruthApproved !== true) return rejection("patient_truth_not_approved");
    return acceptance();
  }

  if (runtimeStatus !== PRESET_RUNTIME_STATUS.APPROVED_FOR_TRAINING) {
    return rejection("preset_not_approved_for_production", { runtimeStatus });
  }
  if (patientTruthApproved !== true) return rejection("patient_truth_not_approved");
  if (productionRelease?.production_allowed !== true) {
    return rejection("production_release_not_approved", {
      productionAllowed: productionRelease?.production_allowed ?? null,
    });
  }
  return acceptance();
}

export function assertSessionAudienceAllowed(input) {
  const decision = evaluateSessionAudience(input);
  if (!decision.allowed) throw new SessionAudienceGateError(decision.code, decision.details);
  return decision;
}

export function isLearnerFacingSessionApproved(session) {
  if (![SESSION_PURPOSE.LEARNER_PILOT, SESSION_PURPOSE.PRODUCTION].includes(session?.purpose)) {
    return false;
  }
  return evaluateSessionAudience({
    sessionPurpose: session.purpose,
    preset: session.presetRuntimeStatus ? { runtime_status: session.presetRuntimeStatus } : null,
    patientTruthApproved: session.patientTruthApproved,
    productionRelease: { production_allowed: session.productionReleaseAllowed === true },
  }).allowed;
}

function acceptance() {
  return { allowed: true, code: "allowed", details: {} };
}

function rejection(code, details = {}) {
  return { allowed: false, code, details };
}
