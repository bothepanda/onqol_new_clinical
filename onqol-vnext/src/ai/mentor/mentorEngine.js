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
export function decideMentorResponse({ state, turnResult, mentorSignal, teachingCandidates = [], issueDefinitions = {}, policy = {} }) {
  // Safety outranks everything else (Mentor Spec §5.6, §20).
  if (turnResult?.outcome === "SAFETY_STOP") {
    return {
      mode: MENTOR_MODE.SAFETY_STOP,
      textRu: turnResult.teachingPointRu,
      ruleId: turnResult.ruleId,
      openQuestion: null,
    };
  }

  // Teaching candidates (Wave B, generic: content-declared issues and rules,
  // see teachingCandidates.js). A safety-critical current problem (priority 1)
  // outranks even a learner who is stuck on something older; every other
  // candidate waits until the "не знаю" handling below has had its turn.
  const candidate = teachingCandidates[0] ?? null;
  const fromCandidate = (c) => ({
    mode: c.mode,
    textRu: c.textRu,
    ...(c.ruleId ? { ruleId: c.ruleId } : {}),
    concepts: c.concepts ?? [],
    scaffolding: c.scaffolding ?? 1,
    openQuestion: { issueId: c.issueId, expects: c.expects ?? ["reasoning"], scaffolding: c.scaffolding ?? 1 },
  });
  if (candidate && candidate.priority <= 1) return fromCandidate(candidate);

  if (mentorSignal === "STUCK") {
    // Progressive scaffolding follows the PENDING issue's own level when there
    // is one (a different issue raised in between must not reset or skip it).
    // Content that declares its own no-issue ladder (`mentor_policy.generic_scaffold_ru`)
    // starts that ladder from 0 - the shared ladder below is a diagnostic-workup
    // script and would misread a "не знаю" in a different kind of case.
    const priorLevel = state.mentor.pendingMentorQuestion?.scaffoldingLevel ?? (policy.generic_scaffold_ru ? 0 : state.mentor.scaffolding ?? 0);
    const nextLevel = Math.min(4, priorLevel + 1);
    // `state.mentor.openQuestion` is cleared on every LEARNER_TURN_RECEIVED
    // (worldState.js), so by the turn AFTER the one that opened it, it is
    // already null - "не знаю" one full turn later would otherwise read as a
    // fresh "generic" issue instead of a continuation. `pendingMentorQuestion`
    // (Stateful Grounded Mentor Wave A) survives across turns for exactly
    // this; it is null whenever STATEFUL_GROUNDED_MENTOR_V1 is off, so this
    // falls through to the original `openQuestion` read (and then "generic")
    // unchanged for a flag-off session (ТЗ §8).
    const issueId = state.mentor.pendingMentorQuestion?.issueId ?? state.mentor.openQuestion?.issueId ?? "generic";
    // An issue that declares its own ladder speaks in its own terms; anything
    // else keeps the shared reasoning-scaffold wording exactly as before.
    const definition = issueDefinitions[issueId] ?? null;
    return {
      mode: MENTOR_MODE.TEACH,
      textRu: definition?.scaffold_ru?.[nextLevel] ?? (!definition && policy.generic_scaffold_ru?.[nextLevel]) ?? SCAFFOLD_PROMPTS_RU[nextLevel] ?? SCAFFOLD_PROMPTS_RU[4],
      scaffolding: nextLevel,
      ...(definition?.concepts ? { concepts: definition.concepts } : {}),
      openQuestion: { issueId, expects: definition?.expects ?? ["reasoning"], scaffolding: nextLevel },
    };
  }

  if (candidate) return fromCandidate(candidate);

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

  // Matrix O02 / MR04: the learner opened rather than laparoscoped, in a
  // hospital that HAS a laparoscopy stack.
  //
  // Why this is not driven by a rule: RULE-LAPAROSCOPIC-PREFERRED-WHEN-AVAILABLE
  // is unapproved and therefore inert, and the mentor may not state an
  // unapproved clinical claim. But this branch states none. It reports one
  // HOSPITAL RESOURCE FACT the learner can already see - the stack is available
  // - and asks them to justify their own choice. Asking "why" is not teaching,
  // and the question deliberately does not say open surgery is wrong or
  // impossible (matrix O02: "Allow if learner persists").
  const startedOpen = (turnResult?.events ?? []).find(
    (event) => event.type === "PROCEDURE_STARTED" && event.payload.approach === "open",
  );
  const laparoscopyAvailable = state.hospital?.capabilities?.laparoscopy?.available === true;
  if (startedOpen && laparoscopyAvailable && !state.mentor.raisedIssues.includes("open_approach_rationale")) {
    return {
      mode: MENTOR_MODE.CLARIFY,
      textRu: "Почему выбираешь открытый доступ? Лапароскопическая стойка доступна.",
      openQuestion: { issueId: "open_approach_rationale", expects: ["operative_approach_rationale"], scaffolding: 1 },
      scaffolding: 1,
    };
  }

  // Matrix O12/O13: the learner chose an operative option the simulator will
  // not perform. The CHALLENGE text comes from content
  // (`operative.yaml#options[].challenge_ru`), so the mentor asks the clinical
  // question without the simulator inventing a consequence.
  if (turnResult?.outcome === "OPTION_NOT_MODELED" && turnResult.challengeRu) {
    return {
      mode: MENTOR_MODE.CHALLENGE,
      textRu: turnResult.challengeRu,
      openQuestion: { issueId: `operative_option:${turnResult.blockedReason}`, expects: ["operative_rationale"], scaffolding: 1 },
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
  // Content may switch reinforcement off (`mentor_policy.reinforce_every_silent_turns: null`):
  // the fluids case forbids evaluative wording toward the learner.
  const reinforceEvery = policy.reinforce_every_silent_turns === undefined ? 6 : policy.reinforce_every_silent_turns;
  const shouldReinforce = reinforceEvery != null && silentStreak > 0 && silentStreak % reinforceEvery === 0; // occasional, not every turn
  if (shouldReinforce) {
    return { mode: MENTOR_MODE.REINFORCE, textRu: "Разумно, продолжай.", openQuestion: null };
  }

  return { mode: MENTOR_MODE.CONTINUE, textRu: null, openQuestion: null };
}

/**
 * Building the envelope the mentor is allowed to reason from - the
 * hidden-truth boundary (Core Runtime Spec §51-52) made concrete for this
 * layer specifically, so a future LLM-backed mentor renderer has exactly one
 * object to receive and cannot reach past it for `state.truth`.
 */
export function buildMentorEnvelope(state) {
  return buildLearnerVisibleState(state);
}
