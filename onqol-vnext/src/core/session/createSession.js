import { createClock } from "../time/clock.js";
import { createInitialState, reduceEvents } from "../state/worldState.js";
import { createEvent, createEventLog } from "../events/eventLog.js";
import { EVENT } from "../events/eventTypes.js";
import { generatePatient } from "../patient/patientGenerator.js";
import { resolveHospitalProfile } from "../hospital/hospitalProfiles.js";
import { rollDynamicConstraints, applyConstraintsToCapabilities, applyConstraintsToStaff } from "../hospital/dynamicConstraints.js";
import { createRng } from "../rng.js";
import { inventoryPatientTruth, evaluateInflammatoryCalibrationForPilot } from "../patient/patientTruthGovernance.js";
import { assertSessionAudienceAllowed, SESSION_PURPOSE, SessionAudienceGateError } from "./sessionPurpose.js";
import { resolveInteractionFlags } from "../../ai/interaction/featureFlags.js";

/**
 * Building session zero: the seed, the generated patient, the hospital
 * profile, and the first two events (SESSION_STARTED, PATIENT_ARRIVED).
 *
 * This is the one place `createInitialState` is called from application code
 * - everything after this point is `applyEvent` folded over the log.
 */
export function createSession({ sessionId, seed, mode, realProfileId, casePresetId, bundle, locale, startIso, sessionPurpose, interactionFlags, jurisdictionContext = "KZ" }) {
  const rng = createRng(seed);
  const preset = (bundle.phenotypes?.case_presets ?? []).find(
    (candidate) => candidate.case_preset_id === casePresetId,
  );
  const patientTruth = inventoryPatientTruth({ bundle, casePresetId, sessionPurpose });
  const audienceDecision = assertSessionAudienceAllowed({
    sessionPurpose,
    preset,
    patientTruthApproved: patientTruth.approved,
    productionRelease: bundle.disease?.release_gate,
  });

  // APP004 Numeric Calibration Review 2026-08-31 (ENV): a learner-pilot /
  // production session may not be generated from the development-only union
  // envelope once the linked inflammatory profiles are the reviewed path. If
  // the profile calibration is not enabled + approved + valid, fail here
  // rather than let `generatePatient` fall back to the union ranges.
  if (sessionPurpose === SESSION_PURPOSE.LEARNER_PILOT || sessionPurpose === SESSION_PURPOSE.PRODUCTION) {
    const calibration = evaluateInflammatoryCalibrationForPilot({
      inflammatoryProfiles: bundle.disease?.inflammatory_profiles,
    });
    if (!calibration.ready) {
      throw new SessionAudienceGateError(calibration.code, {
        profileId: calibration.profileId ?? null,
        casePresetId,
      });
    }
  }

  // Deliberately after the audience decision: learner-facing requests fail
  // closed before any unapproved patient is instantiated. Direct
  // generatePatient() calls remain available to internal tests and authoring.
  const patient = generatePatient({ seed, bundle, casePresetId });
  const hospital = resolveHospitalProfile(mode, realProfileId);
  const clock = createClock({ startIso });

  // Dynamic constraints are drawn once, from the seed, and folded into the
  // capabilities the world will resolve against. They are NOT disclosed here
  // - the learner finds out when they run into one (task brief §12.3).
  const dynamicConstraints = rollDynamicConstraints({ mode, rng });
  const capabilities = applyConstraintsToCapabilities(hospital.capabilities, dynamicConstraints);
  const staff = applyConstraintsToStaff(hospital.staff, dynamicConstraints);

  // Review matrix §G1 / task §3: patient-generation content is Patient Truth
  // and no longer enjoys a blanket exemption from the runtime gate. The case
  // still instantiates - a development build needs a patient - but every
  // generating content object below `approved_for_training` is recorded as a
  // simulator limitation on the log, and the session is stamped
  // `patientTruthApproved: false` so no surface can present this build as
  // pilot-ready.
  const initial = createInitialState({
    session: {
      id: sessionId,
      seed,
      mode,
      locale,
      jurisdictionContext,
      purpose: sessionPurpose,
      interactionFlags: resolveInteractionFlags(interactionFlags),
      presetRuntimeStatus: preset.runtime_status,
      productionReleaseAllowed: bundle.disease?.release_gate?.production_allowed === true,
      presentationCategory: bundle.disease.presentation_category,
      contentVersions: { [bundle.disease.disease_id]: bundle.__contentVersion ?? "unversioned" },
      patientTruthApproved: patientTruth.approved,
    },
    patient,
    hospital: {
      profileId: hospital.profileId,
      profileTitleKey: hospital.profileTitleKey,
      capabilities,
      staff,
      dynamicConstraints,
      jurisdiction: hospital.jurisdiction ?? null,
      radiologyPolicy: hospital.radiologyPolicy ?? null,
      // Operational hospital data (Core Runtime Spec §46), not clinical content:
      // how long an ambulance takes is not a clinical rule and is not gated.
      transferEtaMinutes: hospital.transferEtaMinutes ?? null,
    },
    clock,
  });

  const startEvent = createEvent({
    type: EVENT.SESSION_STARTED,
    atMinutes: 0,
    atIso: clock.startIso,
    payload: {
      casePresetId,
      presentationCategory: bundle.disease.presentation_category,
      sessionPurpose,
      interactionFlags: resolveInteractionFlags(interactionFlags),
      audienceGate: audienceDecision.code,
    },
    cause: { actor: "system", source: "session_bootstrap" },
  });
  const arrivalEvent = createEvent({
    type: EVENT.PATIENT_ARRIVED,
    atMinutes: 0,
    atIso: clock.startIso,
    payload: { location: "emergency_department", handoffRu: buildHandoffText(patient) },
    cause: { actor: "system", source: "session_bootstrap" },
  });

  const patientTruthEvents = patientTruth.blocked.map((limitation) =>
    createEvent({
      type: EVENT.SIMULATOR_LIMITATION_NOTED,
      atMinutes: 0,
      atIso: clock.startIso,
      payload: limitation,
      cause: { actor: "system", source: "governance_gate:patient_generation" },
    }),
  );

  const events = createEventLog([startEvent, arrivalEvent, ...patientTruthEvents]);
  const state = reduceEvents(initial, events);

  // Passive disease drift is computed directly by `advanceTime` from elapsed
  // minutes (see its file header) - there is nothing to pre-schedule here.
  return { state, events, patient, clockRoot: clock, bundle, rng, sessionId, patientTruthInventory: patientTruth };
}

function buildHandoffText(patient) {
  const { age, sex } = patient.demographics;
  const sexLabel = sex === "female" ? "женщина" : "мужчина";
  return (
    `Приёмный покой. Острый живот. Передача СМП: ${sexLabel}, ${age} лет. ` +
    `Боль ${patient.presentation.painSiteRu} около ${Math.round(patient.presentation.onsetHours)} часов. ` +
    `Т ${patient.initialPhysiology.temperatureC} °C, ЧСС ${patient.initialPhysiology.heartRate}/мин, ` +
    // Systolic only, explicitly labelled. A diastolic value is NOT modeled by
    // the reviewed physiology envelope, and inventing a plausible "/70" - as
    // an earlier version of this line did - is exactly the fabricated
    // clinical fact the governance spec forbids (Governance Spec §2).
    `ЧДД ${patient.initialPhysiology.respiratoryRate}/мин, АД сист. ${patient.initialPhysiology.systolicBp} мм рт.ст.`
  );
}
