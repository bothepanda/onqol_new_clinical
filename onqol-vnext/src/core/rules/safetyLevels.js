/**
 * The four-level clinical error model (Foundation Spec §57, Contract §18).
 *
 * These labels are an internal execution classification. They are never
 * rendered to the learner - the mentor speaks in plain teaching language, and
 * the debrief speaks in plain teaching language; "LEVEL_3" appears only in
 * the event log and the dev panel.
 */
export const SAFETY_LEVEL = Object.freeze({
  LEVEL_1_DEFENSIBLE: "LEVEL_1_DEFENSIBLE",
  LEVEL_2_EDUCATIONAL: "LEVEL_2_EDUCATIONAL",
  LEVEL_3_DANGEROUS: "LEVEL_3_DANGEROUS",
  LEVEL_4_CATASTROPHIC: "LEVEL_4_CATASTROPHIC",
});

/**
 * Default execution behavior per level. A rule may override `execute` (e.g. a
 * Level 3 rule authored as always-block for a specific action), but nothing
 * outside this table decides the default, and content cannot invent a fifth
 * level.
 */
export const LEVEL_DEFAULTS = Object.freeze({
  [SAFETY_LEVEL.LEVEL_1_DEFENSIBLE]: { execute: "always", mentorMode: "CONTINUE" },
  [SAFETY_LEVEL.LEVEL_2_EDUCATIONAL]: { execute: "on_persistence", mentorMode: "CHALLENGE" },
  [SAFETY_LEVEL.LEVEL_3_DANGEROUS]: { execute: "on_persistence_if_modeled", mentorMode: "CHALLENGE" },
  [SAFETY_LEVEL.LEVEL_4_CATASTROPHIC]: { execute: "never", mentorMode: "SAFETY_STOP" },
});

export function defaultsFor(level) {
  const defaults = LEVEL_DEFAULTS[level];
  if (!defaults) throw new Error(`Unknown safety level "${level}".`);
  return defaults;
}
