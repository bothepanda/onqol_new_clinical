/**
 * Explicit clinical commands.
 *
 * This is the seam the whole architecture turns on (Core Runtime Spec §48-49):
 * the interpreter's only job is to turn free learner text into zero or more of
 * these, with every required parameter filled in or explicitly missing. A
 * command with a missing required parameter is never guessed - it comes back
 * as a CLARIFY outcome from `validateCommand` and the hospital character asks
 * for the missing piece (Contract §10).
 *
 * The domain core never receives raw text. It only ever receives these.
 */
export const COMMAND = Object.freeze({
  TAKE_HISTORY: "TAKE_HISTORY",
  ASK_PATIENT: "ASK_PATIENT",
  EXAMINE: "EXAMINE",
  REQUEST_STATUS: "REQUEST_STATUS",
  WAIT: "WAIT",
  ORDER_TEST: "ORDER_TEST",
  ORDER_MEDICATION: "ORDER_MEDICATION",
  ORDER_INFUSION: "ORDER_INFUSION",
  ORDER_PROCEDURE: "ORDER_PROCEDURE",
  PRESCRIBE_MONITORING: "PRESCRIBE_MONITORING",
  ORDER_ORAL_INTAKE: "ORDER_ORAL_INTAKE",
  REASSESS: "REASSESS",
  STATE_REASONING: "STATE_REASONING",
  CALL_STAFF: "CALL_STAFF",
  COMMIT_MANAGEMENT_PLAN: "COMMIT_MANAGEMENT_PLAN",
  OBTAIN_CONSENT: "OBTAIN_CONSENT",
  SET_NPO: "SET_NPO",
  ASK_FASTING_HISTORY: "ASK_FASTING_HISTORY",
  ESTABLISH_IV_ACCESS: "ESTABLISH_IV_ACCESS",
  GIVE_ANTIBIOTIC_PROPHYLAXIS: "GIVE_ANTIBIOTIC_PROPHYLAXIS",
  REQUEST_ANESTHESIA_REVIEW: "REQUEST_ANESTHESIA_REVIEW",
  MOVE_PATIENT: "MOVE_PATIENT",
  START_PROCEDURE: "START_PROCEDURE",
  OPERATIVE_DECISION: "OPERATIVE_DECISION",
  DISPOSITION: "DISPOSITION",
  TRANSFER: "TRANSFER",
  DISCHARGE: "DISCHARGE",
  ANSWER_MENTOR: "ANSWER_MENTOR",
  REPEAT_LAST: "REPEAT_LAST",
  END_CASE: "END_CASE",
});

/**
 * Required parameters per command. `validateCommand` uses this to decide
 * SUFFICIENT vs CLARIFY - it never invents the missing value (Core Runtime Spec
 * §48; Contract §8.2/§8.4).
 */
const REQUIRED_PARAMS = Object.freeze({
  [COMMAND.ASK_PATIENT]: ["topic"],
  [COMMAND.ORDER_TEST]: ["testId"],
  [COMMAND.ORDER_MEDICATION]: ["drugId", "dose", "route"],
  [COMMAND.ORDER_INFUSION]: ["fluidId", "volumeMl"], // durationMinutes XOR bolus, checked separately
  [COMMAND.ORDER_PROCEDURE]: ["procedureId"],
  [COMMAND.EXAMINE]: ["region"],
  [COMMAND.REASSESS]: ["targets"],
  [COMMAND.CALL_STAFF]: ["role"],
  [COMMAND.COMMIT_MANAGEMENT_PLAN]: ["intent"],
  // Matrix AB03 / task §16.1: "антибиотикопрофилактика" is an intent, not an
  // order. All three of drug, dose and route are required, so an incomplete
  // statement comes back as a NURSE clarification instead of the system
  // choosing a regimen the learner never named.
  [COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS]: ["drugId", "dose", "route"],
  [COMMAND.MOVE_PATIENT]: ["to"],
  [COMMAND.START_PROCEDURE]: ["approach"],
  [COMMAND.OPERATIVE_DECISION]: ["decisionId", "choice"],
  [COMMAND.DISPOSITION]: ["destination"],
  [COMMAND.TRANSFER]: ["destination"],
});

export function requiredParamsFor(type) {
  return REQUIRED_PARAMS[type] ?? [];
}

/**
 * @typedef {object} ClinicalCommand
 * @property {string} id            stable id for causal tracing
 * @property {string} type          one of COMMAND
 * @property {object} params
 * @property {string} sourceText    the learner fragment this command was read from
 */
export function createCommand({ id, type, params = {}, sourceText }) {
  if (!Object.values(COMMAND).includes(type)) throw new Error(`Unknown command type "${type}".`);
  return Object.freeze({ id, type, params: Object.freeze({ ...params }), sourceText });
}

/**
 * @returns {{ outcome: "SUFFICIENT" }|{ outcome: "CLARIFY", missing: string[] }}
 */
export function validateCommand(command) {
  const required = requiredParamsFor(command.type);
  const missing = required.filter((key) => command.params[key] === undefined || command.params[key] === null || command.params[key] === "");

  if (command.type === COMMAND.ORDER_INFUSION) {
    const hasDurationOrBolus = command.params.durationMinutes != null || command.params.bolus === true;
    if (!hasDurationOrBolus) missing.push("durationMinutes_or_bolus");
  }

  if (command.type === COMMAND.WAIT) {
    const hasWaitTarget = command.params.afterMinutes != null || command.params.untilNextPending === true;
    if (!hasWaitTarget) missing.push("afterMinutes_or_next_event");
  }

  return missing.length > 0 ? { outcome: "CLARIFY", missing } : { outcome: "SUFFICIENT" };
}
