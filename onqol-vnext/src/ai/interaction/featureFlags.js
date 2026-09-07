export const AI_INTERACTION_V2 = "AI_INTERACTION_V2";

/**
 * Explicit rollback flag for the selective interaction migration.
 * Disabled unless the session creator opts in; no environment value silently
 * changes a replay's behavior.
 */
export function resolveInteractionFlags(overrides = {}) {
  return Object.freeze({
    [AI_INTERACTION_V2]: overrides[AI_INTERACTION_V2] === true,
  });
}

export function isInteractionV2Enabled(value) {
  const flags = value?.interactionFlags ?? value?.session?.interactionFlags ?? value;
  return flags?.[AI_INTERACTION_V2] === true;
}

/**
 * Which interpreter the learner-facing app runs (wave §17).
 *
 * `deterministic` (default) - the vocabulary interpreter only.
 * `hybrid` - deterministic fast path plus a schema/concept-validated semantic
 *   pass for what the fast path cannot resolve; still deterministic authority
 *   for execution, still fail-closed on any provider problem.
 *
 * AI_INTERACTION_V2 is a SEPARATE, older flag: it only enables discarded
 * split-semantic SHADOW telemetry and never changed which interpreter ran.
 * The two are independent on purpose.
 */
export const INTERPRETER_MODE = Object.freeze({ DETERMINISTIC: "deterministic", HYBRID: "hybrid" });

export function resolveInterpreterMode(rawValue) {
  return rawValue === INTERPRETER_MODE.HYBRID ? INTERPRETER_MODE.HYBRID : INTERPRETER_MODE.DETERMINISTIC;
}
