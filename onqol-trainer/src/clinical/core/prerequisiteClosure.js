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
 * WHAT IS NOT A PREREQUISITE ANY MORE. The WHO checkpoints - Sign In, Time Out,
 * Sign Out - were blocking gates until the owner's decision of 20.08.2026
 * (CDR-18). They are run in theatre, largely by the nursing team; making a
 * resident's path depend on their naming the checkpoint taught the password
 * rather than the medicine. What those checkpoints are about is gated on its own
 * terms - consent, the anaesthetist, a ready team - and that is what a
 * prerequisite check is for. The actions themselves remain performable and
 * recordable and appear in the debrief; they block nothing.
 */

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
  return expressedActionIds(session).has(prerequisiteId) || alsoThisTurn.includes(prerequisiteId);
}
