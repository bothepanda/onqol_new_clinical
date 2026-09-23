/**
 * Stateful Grounded Mentor Wave A - the structured brief (ТЗ §15).
 *
 * Everything patient-shaped in here comes from `buildLearnerVisibleState`
 * (the one function allowed to answer "what does the learner currently
 * know" - `core/state/learnerView.js`), never from `state.truth` directly.
 * No hidden diagnosis, no unrevealed findings, no future trajectory - if a
 * field isn't in the learner-visible projection, it isn't in the brief.
 */
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import { selectCardsForIssue, buildRetrievalView } from "./cardRetrieval.js";

const RECENT_DIALOGUE_TURNS = 12;

/**
 * @param {object} args
 * @param {object} args.session   the session AFTER `submitLearnerTurn` ran this turn
 * @param {object} args.turn      `submitLearnerTurn`'s full return value for this turn
 * @param {Array}  [args.history] prior chat messages ({role, textRu}), most recent last
 * @param {string} args.text      the learner's raw text this turn
 * @param {object} [args.library] the approved clinical-card library (app004-library.json shape); omit for no cards
 */
export function buildMentorBrief({ session, turn, history = [], text, library = null }) {
  const visible = buildLearnerVisibleState(session.state);
  const mentor = turn.mentor ?? {};
  const issueId = mentor.openQuestion?.issueId ?? mentor.ruleId ?? visible.mentor.pendingMentorQuestion?.issueId ?? null;

  const executedActions = (turn.outcomes ?? [])
    .filter((result) => ["EXECUTED", "ALREADY_PENDING", "NO_PENDING_WORK"].includes(result.outcome))
    .map((result) => ({ type: result.command?.type ?? null, params: result.command?.params ?? null }));

  const worldEventsSinceLastTurn = [...(turn.timeEvents ?? []), ...(turn.afterEvents ?? [])].map((event) => ({
    type: event.type,
    atMinutes: event.atMinutes,
  }));

  return Object.freeze({
    learnerTurn: text,
    recentDialogue: history.slice(-RECENT_DIALOGUE_TURNS),
    executedActions,
    reasoningDelta: { mentorSignal: turn.interpreted?.mentorSignal ?? null, adequacy: mentor.adequacy ?? null },
    learnerVisiblePatientState: visible,
    worldEventsSinceLastTurn,
    activeIssue: issueId ? { issueId, mode: mentor.mode ?? null } : null,
    pendingQuestion: visible.mentor.pendingMentorQuestion,
    scaffoldingLevel: visible.mentor.scaffolding,
    probingStreak: visible.mentor.probingStreak,
    recentMentorQuestions: visible.mentor.recentMentorQuestions,
    deferredMentorIssues: visible.mentor.deferredMentorIssues,
    approvedClinicalCards: library
      ? selectCardsForIssue({ issueId, learnerText: text, library, visibleState: buildRetrievalView(visible), concepts: mentor.concepts ?? [], casePresetId: session.state.session.casePresetId })
      : [],
  });
}
