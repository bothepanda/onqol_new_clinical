/**
 * The domain event vocabulary.
 *
 * Every meaningful change to the world is one of these. Current state is never
 * edited in place anywhere in the codebase: it is `reduce(seed, events)`, which
 * is what makes replay, export, debrief and clinical audit the same mechanism
 * rather than four parallel ones that can quietly disagree.
 *
 * Adding a disease must not add event types. If a second module needs
 * `GALLBLADDER_REMOVED`, the abstraction is wrong - it needs
 * SOURCE_CONTROL_COMPLETED carrying content-supplied detail.
 */
export const EVENT = Object.freeze({
  // Session lifecycle
  SESSION_STARTED: "SESSION_STARTED",
  PATIENT_ARRIVED: "PATIENT_ARRIVED",
  TIME_ADVANCED: "TIME_ADVANCED",
  SESSION_ENDED: "SESSION_ENDED",

  // Learner turn bookkeeping - what was said, what it was read as
  LEARNER_TURN_RECEIVED: "LEARNER_TURN_RECEIVED",
  COMMAND_ACCEPTED: "COMMAND_ACCEPTED",
  COMMAND_REJECTED: "COMMAND_REJECTED",
  CLARIFICATION_REQUESTED: "CLARIFICATION_REQUESTED",
  REASONING_STATED: "REASONING_STATED",

  // Assessment
  HISTORY_OBTAINED: "HISTORY_OBTAINED",
  EXAMINATION_PERFORMED: "EXAMINATION_PERFORMED",
  PATIENT_REASSESSED: "PATIENT_REASSESSED",
  VITALS_OBSERVED: "VITALS_OBSERVED",
  PATIENT_QUESTION_ANSWERED: "PATIENT_QUESTION_ANSWERED",

  // Investigations
  TEST_ORDERED: "TEST_ORDERED",
  TEST_IN_PROGRESS: "TEST_IN_PROGRESS",
  TEST_PRELIMINARY_REPORTED: "TEST_PRELIMINARY_REPORTED",
  TEST_RESULTED: "TEST_RESULTED",
  TEST_UNAVAILABLE: "TEST_UNAVAILABLE",
  TEST_CANCELLED: "TEST_CANCELLED",

  // Treatment
  MEDICATION_ORDERED: "MEDICATION_ORDERED",
  MEDICATION_ADMINISTERED: "MEDICATION_ADMINISTERED",
  INFUSION_STARTED: "INFUSION_STARTED",
  INFUSION_COMPLETED: "INFUSION_COMPLETED",
  PROCEDURE_PERFORMED: "PROCEDURE_PERFORMED",
  MONITORING_PRESCRIBED: "MONITORING_PRESCRIBED",
  TREATMENT_EFFECT_APPLIED: "TREATMENT_EFFECT_APPLIED",
  // Matrix PO05: early oral intake as tolerated is ordinary ward care. The
  // order is recorded so it appears in the debrief; no physiological effect is
  // modeled, because none has been reviewed.
  ORAL_INTAKE_PRESCRIBED: "ORAL_INTAKE_PRESCRIBED",

  // Plan and perioperative state
  MANAGEMENT_PLAN_COMMITTED: "MANAGEMENT_PLAN_COMMITTED",
  PREOP_ITEM_COMPLETED: "PREOP_ITEM_COMPLETED",
  PREOP_ITEM_OMITTED: "PREOP_ITEM_OMITTED",
  CONSENT_OBTAINED: "CONSENT_OBTAINED",
  // Matrix PR02: last solid food / clear liquid times. Obtained by the learner
  // or, if they never asked, by the anesthesiologist on arrival.
  FASTING_HISTORY_OBTAINED: "FASTING_HISTORY_OBTAINED",
  CONSENT_REFUSED: "CONSENT_REFUSED",
  PROCEDURE_STARTED: "PROCEDURE_STARTED",
  OPERATIVE_FINDING_REVEALED: "OPERATIVE_FINDING_REVEALED",
  OPERATIVE_DECISION_MADE: "OPERATIVE_DECISION_MADE",
  SOURCE_CONTROL_COMPLETED: "SOURCE_CONTROL_COMPLETED",
  PROCEDURE_COMPLETED: "PROCEDURE_COMPLETED",

  // World / hospital
  PATIENT_MOVED: "PATIENT_MOVED",
  TRANSFER_INITIATED: "TRANSFER_INITIATED",
  RESOURCE_CONSTRAINT_REVEALED: "RESOURCE_CONSTRAINT_REVEALED",
  RESOURCE_BECAME_AVAILABLE: "RESOURCE_BECAME_AVAILABLE",
  STAFF_CALLED: "STAFF_CALLED",
  STAFF_ARRIVED: "STAFF_ARRIVED",
  STAFF_MESSAGE: "STAFF_MESSAGE",

  // Patient course
  DISEASE_PROGRESSED: "DISEASE_PROGRESSED",
  POSTOPERATIVE_RECOVERY_UPDATED: "POSTOPERATIVE_RECOVERY_UPDATED",
  DETERIORATION_DETECTED: "DETERIORATION_DETECTED",
  COMPLICATION_OCCURRED: "COMPLICATION_OCCURRED",
  COMPLICATION_CHECK_CLEARED: "COMPLICATION_CHECK_CLEARED",
  RECOVERY_MILESTONE: "RECOVERY_MILESTONE",
  // Matrix PO17: automatic hospital workflow, not a learner checkpoint.
  SPECIMEN_SENT_TO_PATHOLOGY: "SPECIMEN_SENT_TO_PATHOLOGY",
  // Matrix PO18/PO20: the system issues the reviewed follow-up wording and red
  // flags after a valid discharge, rather than testing recitation every case.
  DISCHARGE_INSTRUCTIONS_ISSUED: "DISCHARGE_INSTRUCTIONS_ISSUED",

  // Teaching
  MENTOR_INTERVENED: "MENTOR_INTERVENED",
  SAFETY_RULE_FIRED: "SAFETY_RULE_FIRED",

  // Governance / audit trail (task brief P0-5, P0-8)
  SIMULATOR_LIMITATION_NOTED: "SIMULATOR_LIMITATION_NOTED",

  // Endpoints
  PATIENT_DISCHARGED: "PATIENT_DISCHARGED",
  PATIENT_TRANSFERRED: "PATIENT_TRANSFERRED",
  PATIENT_DIED: "PATIENT_DIED",
});

export const EVENT_TYPES = Object.freeze(Object.values(EVENT));

/**
 * Events that carry information the learner has now seen. Anything listed here
 * moves a finding out of hidden patient truth and into the learner-visible
 * record, which is the only surface the mentor envelope is allowed to read.
 */
export const DISCLOSING_EVENTS = Object.freeze([
  EVENT.PATIENT_ARRIVED,
  EVENT.HISTORY_OBTAINED,
  EVENT.EXAMINATION_PERFORMED,
  EVENT.PATIENT_REASSESSED,
  EVENT.VITALS_OBSERVED,
  EVENT.PATIENT_QUESTION_ANSWERED,
  EVENT.FASTING_HISTORY_OBTAINED,
  // Ordering an investigation discloses that it is running. The learner
  // obviously knows what they just ordered, and Contract §6's own worked
  // example of a status snapshot ends "CT formal report is pending" - which
  // the snapshot could never say while an ordered-but-unresulted test was
  // absent from `revealed.results`. It discloses the ORDER, never the result:
  // TEST_ORDERED carries no `findingIds`, and the value stays hidden until
  // TEST_PRELIMINARY_REPORTED or TEST_RESULTED lands.
  EVENT.TEST_ORDERED,
  EVENT.TEST_PRELIMINARY_REPORTED,
  EVENT.TEST_RESULTED,
  EVENT.OPERATIVE_FINDING_REVEALED,
  EVENT.DETERIORATION_DETECTED,
  EVENT.COMPLICATION_OCCURRED,
  EVENT.RESOURCE_CONSTRAINT_REVEALED,
]);

/** Endpoints owned by patient/workflow logic - never by the mentor. */
export const TERMINAL_EVENTS = Object.freeze([
  EVENT.PATIENT_DISCHARGED,
  EVENT.PATIENT_TRANSFERRED,
  EVENT.PATIENT_DIED,
]);

export function isKnownEventType(type) {
  return EVENT_TYPES.includes(type);
}
