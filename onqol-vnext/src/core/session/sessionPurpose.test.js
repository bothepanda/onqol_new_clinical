import { test } from "node:test";
import assert from "node:assert/strict";

import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import { createSession } from "./createSession.js";
import { AI_INTERACTION_V2 } from "../../ai/interaction/featureFlags.js";
import { REASONING_SCHEMA_VERSION } from "../reasoning/reasoningState.js";
import { buildContentGovernance } from "../replay/buildDebrief.js";
import {
  evaluateSessionAudience,
  PRESET_RUNTIME_STATUS,
  SESSION_PURPOSE,
  SessionAudienceGateError,
} from "./sessionPurpose.js";

const base = (casePresetId, sessionPurpose) => ({
  sessionId: `audience-${casePresetId}`,
  seed: "audience-gate",
  mode: "reference",
  casePresetId,
  sessionPurpose,
  bundle: diseaseBundle,
  locale: "ru",
  startIso: "2026-08-28T09:00:00+05:00",
});

function rejectedWith(code, run) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof SessionAudienceGateError);
    assert.equal(error.code, code);
    return true;
  });
}

test("APP-001 cannot start as learner_pilot", () => {
  rejectedWith("preset_not_learner_enabled", () =>
    createSession(base("APP-001", SESSION_PURPOSE.LEARNER_PILOT)),
  );
});

test("APP-004 is learner-enabled: pilot sessions start, internal development still routes to the legacy envelope blocker", () => {
  // Promoted to runtime_status: learner_enabled on 2026-09-06 (Clinical Lead)
  // once every learner_pilot-route patient-truth dependency reached
  // approved_for_training with recorded first + independent second review.
  const pilot = createSession(base("APP-004", SESSION_PURPOSE.LEARNER_PILOT));
  assert.equal(pilot.state.session.purpose, SESSION_PURPOSE.LEARNER_PILOT);
  assert.equal(pilot.state.session.patientTruthApproved, true);

  // internal_development / faculty_preview still reach the unreviewed legacy
  // union envelope (ENV-UNCOMPLICATED-INFLAMMATION), so patient truth is not
  // approved on that route and no surface may present this as pilot-ready.
  const internal = createSession(base("APP-004", SESSION_PURPOSE.INTERNAL_DEVELOPMENT));
  assert.equal(internal.state.session.purpose, SESSION_PURPOSE.INTERNAL_DEVELOPMENT);
  assert.equal(internal.state.session.patientTruthApproved, false);
});

test("APP-005 starts only in an explicitly allowed preview/development context", () => {
  assert.ok(createSession(base("APP-005", SESSION_PURPOSE.INTERNAL_DEVELOPMENT)));
  assert.ok(createSession(base("APP-005", SESSION_PURPOSE.FACULTY_PREVIEW)));
  rejectedWith("preset_not_learner_enabled", () =>
    createSession(base("APP-005", SESSION_PURPOSE.LEARNER_PILOT)),
  );
  rejectedWith("preset_not_approved_for_production", () =>
    createSession(base("APP-005", SESSION_PURPOSE.PRODUCTION)),
  );
});

test("a future learner-enabled preset passes pilot gate only with approved patient truth", () => {
  for (const runtimeStatus of [
    PRESET_RUNTIME_STATUS.LEARNER_ENABLED,
    PRESET_RUNTIME_STATUS.APPROVED_FOR_TRAINING,
  ]) {
    const preset = { runtime_status: runtimeStatus };
    assert.deepEqual(
      evaluateSessionAudience({
        sessionPurpose: SESSION_PURPOSE.LEARNER_PILOT,
        preset,
        patientTruthApproved: false,
      }),
      { allowed: false, code: "patient_truth_not_approved", details: {} },
    );
    assert.equal(
      evaluateSessionAudience({
        sessionPurpose: SESSION_PURPOSE.LEARNER_PILOT,
        preset,
        patientTruthApproved: true,
      }).allowed,
      true,
    );
  }
});

test("production additionally requires an approved preset and production release", () => {
  const preset = { runtime_status: PRESET_RUNTIME_STATUS.APPROVED_FOR_TRAINING };
  assert.equal(
    evaluateSessionAudience({
      sessionPurpose: SESSION_PURPOSE.PRODUCTION,
      preset,
      patientTruthApproved: true,
      productionRelease: { production_allowed: false },
    }).code,
    "production_release_not_approved",
  );
  assert.equal(
    evaluateSessionAudience({
      sessionPurpose: SESSION_PURPOSE.PRODUCTION,
      preset,
      patientTruthApproved: true,
      productionRelease: { production_allowed: true },
    }).allowed,
    true,
  );
});

test("omitting sessionPurpose is itself a fail-closed error", () => {
  rejectedWith("session_purpose_required_or_unknown", () =>
    createSession({ ...base("APP-004", undefined), sessionPurpose: undefined }),
  );
});

test("AI_INTERACTION_V2 is explicit, off by default, and recorded on the session", () => {
  const baseline = createSession(base("APP-004", SESSION_PURPOSE.INTERNAL_DEVELOPMENT));
  assert.equal(baseline.state.session.interactionFlags[AI_INTERACTION_V2], false);
  assert.equal(baseline.state.reasoning.schemaVersion, undefined);
  const optedIn = createSession({
    ...base("APP-004", SESSION_PURPOSE.INTERNAL_DEVELOPMENT),
    interactionFlags: { [AI_INTERACTION_V2]: true },
  });
  assert.equal(optedIn.state.session.interactionFlags[AI_INTERACTION_V2], true);
  assert.equal(optedIn.state.reasoning.schemaVersion, REASONING_SCHEMA_VERSION);
});

test("pilotReady is derived and becomes true only for an approved learner-facing session", () => {
  const governance = (session) => buildContentGovernance({ session, simulatorLimitations: [] });
  const approvedPilot = {
    purpose: SESSION_PURPOSE.LEARNER_PILOT,
    presetRuntimeStatus: PRESET_RUNTIME_STATUS.APPROVED_FOR_TRAINING,
    patientTruthApproved: true,
    productionReleaseAllowed: false,
  };
  assert.equal(governance(approvedPilot).pilotReady, true);
  assert.equal(governance({ ...approvedPilot, patientTruthApproved: false }).pilotReady, false);
  assert.equal(governance({ ...approvedPilot, presetRuntimeStatus: PRESET_RUNTIME_STATUS.REVIEW_PENDING }).pilotReady, false);
  assert.equal(governance({ ...approvedPilot, purpose: SESSION_PURPOSE.INTERNAL_DEVELOPMENT }).pilotReady, false);
  assert.equal(
    governance({ ...approvedPilot, purpose: SESSION_PURPOSE.PRODUCTION, productionReleaseAllowed: false }).pilotReady,
    false,
  );
  assert.equal(
    governance({ ...approvedPilot, purpose: SESSION_PURPOSE.PRODUCTION, productionReleaseAllowed: true }).pilotReady,
    true,
  );
});
