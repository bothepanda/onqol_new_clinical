import { buildLearnerVisibleState } from "../../core/state/learnerView.js";

/**
 * The mentor decision function: (learner-visible state, this turn's outcome,
 * fired teaching rules) -> a response mode and (if any) scaffolding.
 *
 * Mentor Behavior Spec §3.3-§6: the mentor decides WHETHER and HOW to teach.
 * It never decides clinical truth - every teaching_point_ru this function can
 * surface came from a reviewed rule in `bundle.rules` (already filtered to
 * eligible-against-learner-visible-state by `core/rules/ruleEngine.js` before
 * it ever reaches here) or from a fixed scaffolding-ladder phrase. Nothing
 * here calls an LLM for the DECISION; a provider may only be used later to
 * vary the natural-language rendering of a chosen mode (see
 * `docs/KNOWN_GAPS.md`), never to choose the mode itself.
 */
export const MENTOR_MODE = Object.freeze({
  CONTINUE: "CONTINUE",
  REINFORCE: "REINFORCE",
  CLARIFY: "CLARIFY",
  CHALLENGE: "CHALLENGE",
  TEACH: "TEACH",
  SAFETY_STOP: "SAFETY_STOP",
});

/**
 * The scaffolding ladder (Mentor Spec §7), all four rungs genuinely
 * distinct. Levels 3 and 4 previously fell back to level 2's cue, so a
 * learner who said "не знаю" three times got the same help three times -
 * the opposite of progressive support.
 *
 * IMPORTANT - what these may and may not say: each rung is a REASONING
 * scaffold, not a clinical claim. Level 3 offers directions to think in;
 * level 4 explains how to structure the decision. Neither states a dose, a
 * threshold, an indication, or a diagnosis, because no approved clinical
 * rule is supplying one here (Mentor Spec §17, Governance Spec §2). When an
 * approved rule IS available, its own `teaching_point_ru` is used instead of
 * this ladder - see the CHALLENGE branch below.
 */
const SCAFFOLD_PROMPTS_RU = Object.freeze({
  1: "Что именно изменит твоё решение?",
  2: "Подумай отдельно о гемодинамике, источнике проблемы и времени.",
  3: "Давай сузим. Сейчас есть три направления: продолжить наблюдение с переоценкой, добрать данные исследованием, или переходить к вмешательству. Какое из них ты считаешь самым безопасным прямо сейчас и почему?",
  4: "Хорошо, разберём вместе, как строится это решение. Сначала определяешь, стабилен ли пациент — это задаёт, есть ли у тебя время. Дальше формулируешь, какая гипотеза объясняет картину и какие опасные альтернативы её конкурируют. Потом спрашиваешь себя, какое исследование или наблюдение реально изменит твой следующий шаг, а какое просто отложит его. Начни с первого: пациент сейчас стабилен?",
});

/**
 * @param {object} args
 * @param {object} args.state           full world state (for scaffolding bookkeeping only)
 * @param {object} args.turnResult      the executeCommand result for this turn (or last of several)
 * @param {string} [args.mentorSignal]  "STUCK" | "ATTEMPT" | undefined, from the interpreter
 */
export function decideMentorResponse({ state, turnResult, mentorSignal }) {
  // Safety outranks everything else (Mentor Spec §5.6, §20).
  if (turnResult?.outcome === "SAFETY_STOP") {
    return {
      mode: MENTOR_MODE.SAFETY_STOP,
      textRu: turnResult.teachingPointRu,
      ruleId: turnResult.ruleId,
      openQuestion: null,
    };
  }

  if (mentorSignal === "STUCK") {
    const nextLevel = Math.min(4, (state.mentor.scaffolding ?? 0) + 1);
    return {
      mode: MENTOR_MODE.TEACH,
      textRu: SCAFFOLD_PROMPTS_RU[nextLevel] ?? SCAFFOLD_PROMPTS_RU[4],
      scaffolding: nextLevel,
      openQuestion: { issueId: state.mentor.openQuestion?.issueId ?? "generic", expects: ["reasoning"], scaffolding: nextLevel },
    };
  }

  // Committing to an operation is the one moment the contract explicitly
  // asks the mentor to speak (Contract §16, task brief §7.5): the decision
  // is made, but the patient is not prepared, and the learner should own
  // naming the preparation rather than being handed a checklist. Asked once
  // per case - `raisedIssues` is what stops it repeating.
  const committedPlan = (turnResult?.events ?? []).some((event) => event.type === "MANAGEMENT_PLAN_COMMITTED");
  if (committedPlan && !state.mentor.raisedIssues.includes("preop_preparation")) {
    return {
      mode: MENTOR_MODE.CLARIFY,
      textRu: "Что нужно сделать до операции?",
      openQuestion: { issueId: "preop_preparation", expects: ["preoperative_preparation"], scaffolding: 1 },
      scaffolding: 1,
    };
  }

  // A Level-2 rule fired without blocking execution: the mentor may challenge
  // once (Mentor Spec §5.2/§6.4, Contract §18 Level 2 default).
  const challenge = (turnResult?.firedRules ?? []).find((rule) => rule.level === "LEVEL_2_EDUCATIONAL");
  if (challenge && state.mentor.lastInterventionTurn !== state.turn) {
    return { mode: MENTOR_MODE.CHALLENGE, textRu: challenge.teaching_point_ru, ruleId: challenge.id, openQuestion: null };
  }

  if (turnResult?.outcome === "CLARIFY") {
    // Routine order clarification belongs to hospital staff (Contract §10),
    // not the mentor - this branch exists only so callers that ask the
    // mentor engine "what should happen" get an explicit non-answer instead
    // of an implicit one.
    return { mode: MENTOR_MODE.CONTINUE, textRu: null, openQuestion: null, delegateToStaff: true };
  }

  // A competent turn with nothing to flag: silence is a valid teaching
  // decision (Mentor Spec §6.1) - the mentor does not comment on every turn.
  const silentStreak = (state.mentor.silentTurns ?? 0) + 1;
  const shouldReinforce = silentStreak > 0 && silentStreak % 6 === 0; // occasional, not every turn
  if (shouldReinforce) {
    return { mode: MENTOR_MODE.REINFORCE, textRu: "Разумно, продолжай.", openQuestion: null };
  }

  return { mode: MENTOR_MODE.CONTINUE, textRu: null, openQuestion: null };
}

/**
 * Building the envelope the mentor is allowed to reason from - the
 * hidden-truth boundary (Foundation Spec §51-52) made concrete for this
 * layer specifically, so a future LLM-backed mentor renderer has exactly one
 * object to receive and cannot reach past it for `state.truth`.
 */
export function buildMentorEnvelope(state) {
  return buildLearnerVisibleState(state);
}
