export const AI_INTERACTION_V2 = "AI_INTERACTION_V2";

/**
 * Stateful Grounded Mentor Wave A rollback flag. Disabled unless the session
 * creator opts in explicitly, same discipline as AI_INTERACTION_V2 below:
 * no environment value silently changes a replay's behavior, and a session
 * created with this flag off is byte-identical to pre-wave behavior (the
 * mentor working-memory fields in `state.mentor` stay at their initial
 * values, and `submitLearnerTurn` never calls the grounded renderer).
 */
export const STATEFUL_GROUNDED_MENTOR_V1 = "STATEFUL_GROUNDED_MENTOR_V1";

/**
 * Explicit rollback flag for the selective interaction migration.
 * Disabled unless the session creator opts in; no environment value silently
 * changes a replay's behavior.
 */
export function resolveInteractionFlags(overrides = {}) {
  return Object.freeze({
    [AI_INTERACTION_V2]: overrides[AI_INTERACTION_V2] === true,
    [STATEFUL_GROUNDED_MENTOR_V1]: overrides[STATEFUL_GROUNDED_MENTOR_V1] === true,
  });
}

export function isInteractionV2Enabled(value) {
  const flags = value?.interactionFlags ?? value?.session?.interactionFlags ?? value;
  return flags?.[AI_INTERACTION_V2] === true;
}

export function isStatefulGroundedMentorEnabled(value) {
  const flags = value?.interactionFlags ?? value?.session?.interactionFlags ?? value;
  return flags?.[STATEFUL_GROUNDED_MENTOR_V1] === true;
}

/**
 * Which interpreter the learner-facing app runs (wave §17).
 *
 * `semantic_first` (internal development default) - full free-language
 *   interpretation, literal binding and execution in code; no dictionary
 *   execution fallback for free text. Not promoted to the resident pilot.
 * `deterministic` - the vocabulary interpreter only (explicit rollback).
 * `hybrid` - deterministic fast path plus a schema/concept-validated semantic
 *   pass for what the fast path cannot resolve; still deterministic authority
 *   for execution, still fail-closed on any provider problem.
 *
 * AI_INTERACTION_V2 is a SEPARATE, older flag: it only enables discarded
 * split-semantic SHADOW telemetry and never changed which interpreter ran.
 * The two are independent on purpose.
 */
export const INTERPRETER_MODE = Object.freeze({ DETERMINISTIC: "deterministic", HYBRID: "hybrid", SEMANTIC_FIRST: "semantic_first" });

export function resolveInterpreterMode(rawValue, { purpose = "internal_development" } = {}) {
  if (rawValue === INTERPRETER_MODE.HYBRID) return INTERPRETER_MODE.HYBRID;
  if (purpose === "internal_development" && (!rawValue || rawValue === INTERPRETER_MODE.SEMANTIC_FIRST)) return INTERPRETER_MODE.SEMANTIC_FIRST;
  return INTERPRETER_MODE.DETERMINISTIC;
}
