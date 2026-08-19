/**
 * Was this prerequisite closed at any point in the session?
 *
 * WHY THIS IS ITS OWN FILE. Replay 91ba7206 turn 5: the learner had already
 * written «согласие пациента, уведомить анестезиолога, узнать оперблок» on the
 * previous turn, and the trainer still demanded them, because the check ran
 * against one narrow view of one turn. Being asked for something you have just
 * done is the single fastest way to lose a learner, and it is what ended that
 * session on turn 7.
 *
 * The rule in base rules v2 is: a blocking prerequisite is closed when the
 * corresponding action was expressed ANYWHERE earlier in the session - as a
 * recognised concept, as a completed action, or as an order transcribed by the
 * operationalization registry. Not by matching a phrase inside the current
 * message, and not by the learner repeating a magic word.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. The WHO surgical safety checkpoints are not
 * closed by content. Sign In, Time Out and Sign Out are separate verifications
 * whose whole purpose is to be performed as their own act; consent and a phone
 * call to the anaesthetist are inputs to Sign In, not substitutes for it, and
 * the case's own action contract lists them as distinct checkpoints. Softening
 * that is a clinical decision for the reviewer, not a code change - see
 * CLINICAL_DECISIONS_REQUIRED.md.
 */

/** Checkpoints that are never satisfied by other actions having happened. */
export const NON_SUBSTITUTABLE_PREREQUISITES = Object.freeze([
  "who_sign_in",
  "who_time_out",
  "who_sign_out",
]);

/** Action states that mean "the learner expressed this action". */
const EXPRESSED_STATUSES = Object.freeze(["performed", "ordered", "proposed"]);

/**
 * Everything the learner has expressed across the whole session, as action ids.
 *
 * @param {object} session  a V2.5/V3.5 session
 * @returns {Set<string>}
 */
export function expressedActionIds(session) {
  const expressed = new Set(session?.completedActions || []);
  const memory = session?.workingMemory || {};
  for (const state of Object.values(memory.actionStates || {})) {
    if (state?.action_id && EXPRESSED_STATUSES.includes(state.status)) {
      expressed.add(state.action_id);
    }
  }
  // An order the learner stated and the nurse transcribed counts as expressed
  // even where its parameters could not be validated: the prerequisite asks
  // whether the step was taken, not whether the pilot could grade it.
  for (const record of Object.values(memory.orderRecords || {})) {
    if (record?.action_id) expressed.add(record.action_id);
  }
  return expressed;
}

/**
 * @param {object} session
 * @param {string} prerequisiteId
 * @param {string[]} [alsoThisTurn]  action ids named in the current turn
 */
export function prerequisiteSatisfied(session, prerequisiteId, alsoThisTurn = []) {
  if (NON_SUBSTITUTABLE_PREREQUISITES.includes(prerequisiteId)) {
    // Still transcript-wide - performing Sign In on turn 3 counts on turn 9 -
    // but only the checkpoint itself closes the checkpoint.
    return (
      (session?.completedActions || []).includes(prerequisiteId) ||
      alsoThisTurn.includes(prerequisiteId)
    );
  }
  return expressedActionIds(session).has(prerequisiteId) || alsoThisTurn.includes(prerequisiteId);
}
