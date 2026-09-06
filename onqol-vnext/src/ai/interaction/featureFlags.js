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
