import { COMMAND } from "../../core/commands/commandTypes.js";

/**
 * v3A semantic-promotion policy.
 *
 * A "promoted" command class is one where a fully validated semantic
 * interpretation may ADD a command the deterministic pass missed and may
 * CORRECT a conflicting deterministic reading. These are low-consequence,
 * reversible or read-only classes.
 *
 * Every other class is protected: a semantic candidate never silently
 * replaces a deterministic reading of a protected class, and a disagreement
 * involving a protected class is routed to clarification instead of execution
 * (candidateArbitration.js). The protected list is a POLICY over the existing
 * command types; it does not redefine any clinical safety classification
 * (HIGH_RISK_ACTIONS in modelConceptValidation.js is untouched).
 *
 * Widening this list is a contract change and needs its own evaluation.
 */
export const PROMOTION_POLICY_VERSION = "v3a1-2026-09-20-legacy-wave2";

export const V3A_PROMOTED_TYPES = Object.freeze([
  COMMAND.TAKE_HISTORY,
  COMMAND.ASK_PATIENT,
  COMMAND.EXAMINE,
  COMMAND.ORDER_TEST,
  COMMAND.REQUEST_STATUS,
  COMMAND.CALL_STAFF,
  COMMAND.ASK_FASTING_HISTORY,
  COMMAND.SET_NPO,
  COMMAND.ESTABLISH_IV_ACCESS,
  COMMAND.PRESCRIBE_MONITORING,
  COMMAND.REASSESS,
  // v3A.1: semantically promotable (owner decision 2026-09-20). Both need the
  // KIND of action in the learner's own words (`KIND_MUST_BE_EVIDENT`): a wait
  // advances clinical time irreversibly, and a consult request summons staff.
  COMMAND.WAIT,
  COMMAND.REQUEST_ANESTHESIA_REVIEW,
]);

export const V3A_PROTECTED_TYPES = Object.freeze([
  COMMAND.ORDER_MEDICATION,
  COMMAND.ORDER_INFUSION,
  COMMAND.GIVE_ANTIBIOTIC_PROPHYLAXIS,
  COMMAND.ORDER_PROCEDURE,
  COMMAND.COMMIT_MANAGEMENT_PLAN,
  COMMAND.START_PROCEDURE,
  COMMAND.OPERATIVE_DECISION,
  COMMAND.TRANSFER,
  COMMAND.DISPOSITION,
  COMMAND.DISCHARGE,
  COMMAND.MOVE_PATIENT,
  // v3A.1: explicit owner decision (previously default-deny by omission).
  COMMAND.ORDER_ORAL_INTAKE,
  COMMAND.OBTAIN_CONSENT,
]);

/**
 * Explicit conversation controls. They are read from the learner's control
 * phrase by the deterministic pass ("повтори", "завершить кейс") and from
 * nowhere else: a semantic candidate of one of these types is rejected
 * (`explicit_control_only`), so neither control can ever be inferred from
 * clinical semantics, and nothing semantic can override one.
 */
export const EXPLICIT_CONTROL_TYPES = Object.freeze([COMMAND.REPEAT_LAST, COMMAND.END_CASE]);

/**
 * Promoted types whose KIND must be evident in the learner's words even when no
 * concept identifies them: a semantic reading may not accept them on merely
 * "substantive" evidence. WAIT spends clinical time that cannot be given back;
 * REQUEST_ANESTHESIA_REVIEW summons a consultant.
 */
export const KIND_MUST_BE_EVIDENT = Object.freeze([
  COMMAND.WAIT, COMMAND.REQUEST_ANESTHESIA_REVIEW,
  // Legacy real-language wave 1-2: these three were accepted on "substantive words" alone and were read out of
  // sentences about something else (a preoperative label expanded into IV access and NPO; «гистологии» read as
  // history-taking). Their kind now has to be in the learner's words too (TYPE_ANCHORS).
  COMMAND.TAKE_HISTORY, COMMAND.SET_NPO, COMMAND.ESTABLISH_IV_ACCESS,
  // A read-only status check is harmless, but it was added from observations («давление низковато»): the wording has to ask.
  COMMAND.REQUEST_STATUS,
]);

/**
 * Protected model-originated commands (v3A.1): a semantic candidate of a
 * protected type may be ADDED, never substituted for a deterministic reading,
 * only when the learner committed to the action (commitmentPolicy.js) and the
 * candidate is COMPLETE with every identifying and numeric parameter literally
 * grounded in the learner's words. See candidateArbitration.js.
 *
 * Types on neither list (the bookkeeping types, explicit controls) are treated
 * as NOT promoted: default-deny for anything not explicitly approved.
 */
export function createPromotionPolicy({ promoted = V3A_PROMOTED_TYPES } = {}) {
  const promotedSet = new Set(promoted);
  const controls = new Set(EXPLICIT_CONTROL_TYPES);
  const evident = new Set(KIND_MUST_BE_EVIDENT);
  return Object.freeze({
    version: PROMOTION_POLICY_VERSION,
    promotedTypes: [...promotedSet],
    isPromoted: (type) => promotedSet.has(type),
    isProtected: (type) => !promotedSet.has(type),
    isExplicitControl: (type) => controls.has(type),
    requiresEvidentKind: (type) => evident.has(type),
  });
}

export const DEFAULT_PROMOTION_POLICY = createPromotionPolicy();
