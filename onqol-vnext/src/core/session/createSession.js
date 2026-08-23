import { createClock } from "../time/clock.js";
import { createInitialState, reduceEvents } from "../state/worldState.js";
import { createEvent, createEventLog } from "../events/eventLog.js";
import { EVENT } from "../events/eventTypes.js";
import { generatePatient } from "../patient/patientGenerator.js";
import { resolveHospitalProfile } from "../hospital/hospitalProfiles.js";
import { rollDynamicConstraints, applyConstraintsToCapabilities, applyConstraintsToStaff } from "../hospital/dynamicConstraints.js";
import { createRng } from "../rng.js";

/**
 * Building session zero: the seed, the generated patient, the hospital
 * profile, and the first two events (SESSION_STARTED, PATIENT_ARRIVED).
 *
 * This is the one place `createInitialState` is called from application code
 * - everything after this point is `applyEvent` folded over the log.
 */
export function createSession({ sessionId, seed, mode, realProfileId, casePresetId, bundle, locale, startIso }) {
  const rng = createRng(seed);
  const patient = generatePatient({ seed, bundle, casePresetId });
  const hospital = resolveHospitalProfile(mode, realProfileId);
  const clock = createClock({ startIso });

  // Dynamic constraints are drawn once, from the seed, and folded into the
  // capabilities the world will resolve against. They are NOT disclosed here
  // - the learner finds out when they run into one (task brief §12.3).
  const dynamicConstraints = rollDynamicConstraints({ mode, rng });
  const capabilities = applyConstraintsToCapabilities(hospital.capabilities, dynamicConstraints);
  const staff = applyConstraintsToStaff(hospital.staff, dynamicConstraints);

  const initial = createInitialState({
    session: {
      id: sessionId,
      seed,
      mode,
      locale,
      presentationCategory: bundle.disease.presentation_category,
      contentVersions: { [bundle.disease.disease_id]: bundle.__contentVersion ?? "unversioned" },
    },
    patient,
    hospital: {
      profileId: hospital.profileId,
      profileTitleKey: hospital.profileTitleKey,
      capabilities,
      staff,
      dynamicConstraints,
    },
    clock,
  });

  const startEvent = createEvent({
    type: EVENT.SESSION_STARTED,
    atMinutes: 0,
    atIso: clock.startIso,
    payload: { casePresetId, presentationCategory: bundle.disease.presentation_category },
    cause: { actor: "system", source: "session_bootstrap" },
  });
  const arrivalEvent = createEvent({
    type: EVENT.PATIENT_ARRIVED,
    atMinutes: 0,
    atIso: clock.startIso,
    payload: { location: "emergency_department", handoffRu: buildHandoffText(patient) },
    cause: { actor: "system", source: "session_bootstrap" },
  });

  const events = createEventLog([startEvent, arrivalEvent]);
  const state = reduceEvents(initial, events);

  // Passive disease drift is computed directly by `advanceTime` from elapsed
  // minutes (see its file header) - there is nothing to pre-schedule here.
  return { state, events, patient, clockRoot: clock, bundle, rng, sessionId };
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
