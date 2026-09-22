/**
 * Stateful Grounded Mentor Wave A - working-memory bookkeeping (ТЗ §7).
 *
 * Pure function: (prior `state.mentor`, this turn's deterministic candidate,
 * this turn's adequacy verdict) -> the new values for the four additive
 * `state.mentor` fields (`pendingMentorQuestion`, `probingStreak`,
 * `recentMentorQuestions`, `deferredMentorIssues`). `submitLearnerTurn.js`
 * only calls this when STATEFUL_GROUNDED_MENTOR_V1 is on for the session,
 * and only merges the result into the MENTOR_INTERVENED event payload then -
 * see worldState.js's reducer comment on that case for why a flag-off
 * session's `state.mentor` never grows these fields.
 *
 * Mirrors, deliberately, the working-memory field names from the donor
 * architecture (onqol-integration-v4's mentorBrief/mentorPolicy), adapted to
 * this repo's existing `mentorEngine.decideMentorResponse()` output shape
 * instead of rebuilding a parallel decision engine.
 */
import { ADEQUACY } from "./mentorAdequacy.js";

// After this many consecutive non-SUFFICIENT verdicts on the SAME issue
// (matching the scaffold ladder's 4 rungs - see mentorEngine.js), stop
// re-probing it this case and defer it to the debrief instead (ТЗ §14: the
// advancement rule - once reasoning is "as good as it will get right now",
// move the world forward rather than accumulating turns on one issue).
const MAX_PROBING_STREAK = 4;

/**
 * @param {object} args
 * @param {object} args.mentorCandidate        `decideMentorResponse()`'s output for THIS turn
 * @param {string} args.adequacy                one of ADEQUACY.*
 * @param {object} args.priorMentorState        `state.mentor` BEFORE this turn (post-LEARNER_TURN_RECEIVED)
 * @param {number} args.turn                    `state.turn` for this turn
 * @param {string} args.text                    the learner's raw text this turn
 */
export function advanceMentorMemory({ mentorCandidate, adequacy, priorMentorState, turn, text }) {
  const prior = priorMentorState;
  const issueId = mentorCandidate.openQuestion?.issueId ?? mentorCandidate.ruleId ?? null;
  const priorIssueId = prior.pendingMentorQuestion?.issueId ?? null;

  // The turn closed its issue: sufficient reasoning, or the deterministic
  // engine has nothing open. Closing must not require new evidence to persist
  // - it simply stops being pending (ТЗ §24: "closed issue is not immediately
  // reopened without new evidence" is enforced by mentorEngine.js itself only
  // opening a NEW openQuestion from its own rule/matrix conditions, never by
  // this module reopening one on its own).
  if (adequacy === ADEQUACY.SUFFICIENT || !mentorCandidate.openQuestion) {
    return {
      pendingMentorQuestion: null,
      probingStreak: 0,
      recentMentorQuestions: prior.recentMentorQuestions,
      deferredMentorIssues: prior.deferredMentorIssues,
    };
  }

  const sameIssue = issueId && issueId === priorIssueId;
  const nextStreak = sameIssue ? prior.probingStreak + 1 : 1;

  // Advancement rule, defensive edge: don't hammer the same issue forever.
  // Defer it - the debrief gets it instead of a sixth identical prompt.
  if (sameIssue && nextStreak > MAX_PROBING_STREAK) {
    return {
      pendingMentorQuestion: null,
      probingStreak: 0,
      recentMentorQuestions: prior.recentMentorQuestions,
      deferredMentorIssues: unique([...prior.deferredMentorIssues, issueId]),
    };
  }

  const pendingMentorQuestion = {
    issueId,
    askedTurn: turn,
    learnerQuote: (text ?? "").slice(0, 200),
    expectedAnswerDomains: mentorCandidate.openQuestion.expects ?? [],
    scaffoldingLevel: mentorCandidate.scaffolding ?? mentorCandidate.openQuestion.scaffolding ?? 0,
  };

  // Recorded once per NEW deterministic prompt (not per grounded rendering,
  // which happens later and asynchronously) - this is what a later turn's
  // "don't repeat an identical question" check compares against, keyed by
  // issue, not by the eventual LLM wording.
  const recentMentorQuestions = mentorCandidate.textRu
    ? [...prior.recentMentorQuestions, { issueId, prompt: mentorCandidate.textRu }].slice(-3)
    : prior.recentMentorQuestions;

  return {
    pendingMentorQuestion,
    probingStreak: nextStreak,
    recentMentorQuestions,
    deferredMentorIssues: prior.deferredMentorIssues,
  };
}

function unique(values) {
  return [...new Set(values)];
}
