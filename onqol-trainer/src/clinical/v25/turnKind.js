// What KIND of turn this is, decided before anything clinical happens.
//
// WHY
//
// In the first live run the learner typed "не понимаю вопроса". The engine
// routed it as a clinical move, recorded `declare_uncertainty` as a proposed
// diagnosis and charged the patient four minutes. Asking the teacher to repeat
// the question is not a statement of diagnostic uncertainty, and it is not
// something that happens to a patient.
//
// One turn later the learner repeated her own plan verbatim to make the point
// that she had already answered. The engine ran observation, NPO and the fluids
// a second time and advanced the clock another two hours. Saying the same thing
// twice does not give the patient a second infusion.
//
// So conversation management is separated from clinical action. This module
// answers one question - is the learner talking to the patient, or to the
// trainer about the conversation - and it answers it deterministically, before
// the router, because a turn that manages the conversation must not be able to
// reach the clinical engine at all.
//
// WHAT IT DELIBERATELY DOES NOT DO
//
// It does not judge clinical content, and it never classifies by topic. Only
// unambiguous conversational formulas match. Anything else falls through to the
// clinical path exactly as before: a false `clarification_request` would eat a
// real clinical order, which is far worse than a missed one.

/** The kinds a turn can have. `clinical_*` are decided downstream, by the router. */
export const TURN_KINDS = Object.freeze([
  "clinical_action",
  "clinical_reasoning",
  "mentor_answer",
  "patient_question",
  "conversation_management",
  "clarification_request",
  "repeat_or_correction",
  "interface_command",
  "unknown",
]);

/** Kinds that must never create actions, move the clock or touch the score. */
export const CONVERSATIONAL_KINDS = Object.freeze(["clarification_request"]);

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "I did not understand the question."
 *
 * Anchored at the start of the message and length-capped: a long message that
 * happens to open with "не понимаю" is carrying clinical content too, and the
 * clinical content wins. The learner who writes "не понимаю, делать ли КТ" is
 * asking a clinical question, not asking for a repeat.
 */
// NOTE on `\b`: JavaScript defines a word boundary over ASCII word characters
// only, so `\b` after a Cyrillic word never matches. Every boundary here is
// therefore written as "whitespace or end of string".
const CLARIFICATION_RE =
  /^(не\s+понимаю|не\s+поняла?|непонятно|что\s+вы\s+имеете\s+в\s+виду|что\s+значит\s+вопрос|поясни(те)?\s+вопрос|повтори(те)?\s+вопрос|переформулируй(те)?|уточни(те)?\s+вопрос)(\s|$)/;

/** "I already said that." Prefix only - what follows may be the plan itself. */
const REPEAT_RE =
  /^(я\s+же\s+(сказал|сказала|говорил|говорила)|я\s+уже\s+(сказал|сказала|говорил|говорила|ответил|ответила)|повторяю|это\s+и\s+есть\s+мо[йе]\s+(план|ответ)|как\s+я\s+(сказал|сказала)\s+выше)(\s|$)/;
const MEMORY_DISPUTE_RE =
  /^(я\s+же\s+(?:сделал[аи]?|указал[аи]?|написал[аи]?)\s+(?:все|всё|это)(?:\s+выше)?|я\s+уже\s+(?:это\s+)?(?:сделал[аи]?|указал[аи]?|написал[аи]?)|это\s+(?:было|есть)\s+(?:выше|в\s+прошлом\s+сообщении)|я\s+же\s+все\s+это\s+выше)(\s|$)/;

/**
 * An explicit request to do something AGAIN, which is a real clinical order.
 *
 * This is the escape hatch from idempotency: "повтори ОАК" orders a second blood
 * count, and a second blood count genuinely costs time and genuinely happens.
 */
const EXPLICIT_REPEAT_ACTION_RE =
  /(^|\s)(повтори|повторить|повторите|ещ[её]\s+раз|заново|снова|перепроверь|в\s+динамике|контрольн)/;

/** How long a message may be and still be nothing but a request to repeat. */
const CLARIFICATION_MAX_WORDS = 8;

/**
 * Classify one learner message.
 *
 * @param {string} input raw learner text
 * @returns {{kind: string, reason: string|null, blocks_clinical_turn: boolean}}
 */
export function classifyTurn(input) {
  const text = normalize(input);
  if (!text) return { kind: "unknown", reason: "empty", blocks_clinical_turn: false };

  const words = text.split(" ").length;

  if (CLARIFICATION_RE.test(text) && words <= CLARIFICATION_MAX_WORDS) {
    return {
      kind: "clarification_request",
      semantic_kind: "conversation_management",
      reason: "learner asked for the previous question to be restated",
      // The only kind that stops the clinical path outright.
      blocks_clinical_turn: true,
    };
  }

  if (MEMORY_DISPUTE_RE.test(text) && words <= 14) {
    return {
      kind: "repeat_or_correction",
      semantic_kind: "conversation_management",
      reason: "learner disputed whether prerequisite actions were already recorded",
      reason_code: "memory_dispute",
      blocks_clinical_turn: true,
    };
  }

  if (REPEAT_RE.test(text)) {
    return {
      kind: "repeat_or_correction",
      semantic_kind: "unknown",
      reason: "learner restated an answer already given",
      // NOT blocking: the restatement usually carries the plan, and the learner's
      // reasoning still deserves to be recorded. Re-execution is prevented by
      // idempotency instead - see suppressDuplicateOperations().
      blocks_clinical_turn: false,
    };
  }

  return { kind: "unknown", semantic_kind: "unknown", reason: null, blocks_clinical_turn: false };
}

/**
 * Genuine uncertainty is an answer about the learner's state, not a set of
 * grounds. Same shape as the pattern the mentor policy uses to tell "не знаю"
 * apart from evasion.
 */
const GENUINE_UNCERTAINTY_RE =
  /(?:^|[^а-яё])(не\s+знаю|не\s+помню|не\s+уверен(?:а)?|затрудняюсь|не\s+могу\s+решить)(?:$|[^а-яё])/iu;

function emptyContextualReasoning() {
  return {
    stability: { stated: false, learner_assessment: null },
    problem_representation: { stated: false, verbatim: null },
    working_diagnosis: { stated: false, concept_id: null, uncertainty_stated: false },
    differential: {
      stated: false,
      ranked: false,
      has_dangerous_alternative: false,
      concept_ids: [],
      items: [],
    },
    investigations: [],
    management: { plan_stated: false, urgency_stated: false, rationale_stated: false },
    observation: {
      active: false,
      goal_stated: false,
      reassessment_interval_stated: false,
      escalation_criteria_stated: false,
    },
    reassessment: { stated: false },
    contingency: {
      stated: false,
      specificity: null,
      trigger_concept_ids: [],
      trigger_verbatim: [],
    },
    disposition: { stated: false, destination: null },
    consultation: { own_assessment_stated: false, consultation_question_stated: false },
  };
}

/**
 * Resolve elliptical answers against the immediately preceding mentor question.
 * The text remains a learner claim and never becomes a patient fact.
 */
export function interpretPendingMentorAnswer(input, pendingQuestion, context = {}) {
  if (!pendingQuestion || !String(input || "").trim()) return null;
  const expects = new Set(pendingQuestion.expects || []);
  if (!expects.size) return null;
  const delta = emptyContextualReasoning();
  const verbatim = String(input).trim();
  const observationList =
    (verbatim.match(/(?:^|[^\p{L}])ли(?=$|[^\p{L}])/giu) || []).length >= 2;
  const explicitConditional = /(?:^|\s)(если|при\s+ухудш|ухудшени|изменени)/iu.test(verbatim);
  const parameterReply =
    expects.has("treatment_parameter") &&
    (/\d+(?:[.,]\d+)?\s*(?:мл|mg|мг|ml)(?:\s*\/\s*(?:кг|kg))?/iu.test(verbatim) ||
      /(отменяю|убираю|без\s+расч[её]та|не\s+применяю)/iu.test(verbatim));
  if (
    context.hasClinicalAction &&
    !observationList &&
    !explicitConditional &&
    !parameterReply &&
    verbatim.split(/\s+/u).length > 6
  ) {
    return null;
  }
  if (context.hasPatientQuestion && !observationList && !explicitConditional) return null;

  let matched = false;
  if (expects.has("contingency")) {
    matched = true;
    delta.contingency = {
      stated: true,
      specificity: observationList
        ? "partial"
        : verbatim.split(/\s+/u).length <= 4
          ? "vague"
          : "specific",
      trigger_concept_ids: [],
      trigger_verbatim: [verbatim],
    };
  }
  if (observationList) {
    delta.observation.active = true;
    delta.observation.goal_stated = true;
    delta.observation.escalation_criteria_stated = true;
  }
  if (expects.has("observation")) {
    matched = true;
    delta.observation.active = true;
    delta.observation.goal_stated = true;
    delta.observation.escalation_criteria_stated = true;
    delta.contingency = {
      stated: true,
      specificity: "specific",
      trigger_concept_ids: [],
      trigger_verbatim: [verbatim],
    };
  }
  // The two questions that ask the learner to argue: what supports the working
  // hypothesis, and what does not fit it. The answer is recorded as evidence on
  // the hypothesis - the learner's own words, never a patient fact - which is
  // what stops the same rule asking again and what stops the debrief reporting
  // grounds as never named when they were named on the very next turn.
  const grounds = expects.has("diagnosis_grounds");
  const counter = expects.has("counter_evidence");
  // "ммм" is not an argument. The engine cannot judge whether the reasoning is
  // good - that is the mentor's job and it reads the words - but it can tell
  // that nothing was named, and it must not let a filler close the question the
  // way a real answer does.
  const namesSomething =
    !/^(?:м+|э+|ну|хм+|ааа+)[\s.!?]*$/iu.test(verbatim) &&
    !GENUINE_UNCERTAINTY_RE.test(verbatim) &&
    /\p{L}{4,}/u.test(verbatim);
  if ((grounds || counter) && context.workingDiagnosisConceptId && namesSomething) {
    matched = true;
    delta.differential.items = [
      {
        concept_id: context.workingDiagnosisConceptId,
        rank: null,
        dangerous: false,
        evidence_for: grounds ? [verbatim] : [],
        evidence_against: counter ? [verbatim] : [],
      },
    ];
    delta.differential.concept_ids = [context.workingDiagnosisConceptId];
  }
  if (expects.has("stability")) {
    matched = true;
    delta.stability.stated = true;
    delta.stability.learner_assessment = null;
  }
  if (expects.has("management")) {
    matched = true;
    delta.management.plan_stated = true;
  }
  if (expects.has("reassessment")) {
    matched = true;
    delta.reassessment.stated = true;
  }
  if (expects.has("treatment_parameter")) {
    matched = parameterReply;
  }
  if (
    [...expects].some((domain) =>
      [
        "current_decision",
        "immediate_actions",
        "ownership",
        "action_scope",
        "operative_objective",
        "operative_approach",
      ].includes(domain)
    ) &&
    (context.hasClinicalAction || context.hasReasoning)
  ) {
    matched = true;
  }
  if (!matched) return null;

  return {
    reasoning: delta,
    issue_id: pendingQuestion.issue_id,
    answered_contract: true,
  };
}

/** Recognise an explicit list of future monitoring/escalation criteria. */
export function interpretStandaloneReasoning(input) {
  const verbatim = String(input || "").trim();
  const questionList = (verbatim.match(/(?:^|[^\p{L}])ли(?=$|[^\p{L}])/giu) || []).length >= 2;
  const explicitEscalation =
    /(эскалац|позвать|звать|вызвать|немедленно\s+сообщ)/iu.test(verbatim) &&
    /(гипотони|тахикард|лихорад|температур|сатурац|олигур|диурез|кровотеч|сознани|нарастани[ея]\s+бол|с[аa]д\s*(?:ниже|<)|чсс\s*(?:выше|>)|\d+\s*\/\s*10)/iu.test(verbatim);
  const thresholdList =
    /(при\s+(?:гипотони|тахикард|лихорад|олигур|кровотеч|нарушени)|с[аa]д\s*(?:ниже|<)|чсс\s*(?:выше|>)|сатураци[яи]\s*(?:ниже|<))/iu.test(verbatim) &&
    (verbatim.match(/[,;]/g) || []).length >= 1;
  if (!questionList && !explicitEscalation && !thresholdList) return null;
  const delta = emptyContextualReasoning();
  delta.observation.active = true;
  delta.observation.goal_stated = true;
  delta.observation.escalation_criteria_stated = true;
  delta.contingency = {
    stated: true,
    specificity: explicitEscalation || thresholdList ? "specific" : "partial",
    trigger_concept_ids: [],
    trigger_verbatim: [verbatim],
  };
  return delta;
}

/** Classify the effective clinical semantics after routing and contextual interpretation. */
export function resolveTurnSemantics({ base, actions = [], parsed = {}, mentorAnswer = null }) {
  if (base?.blocks_clinical_turn) {
    return {
      ...base,
      kind: "conversation_management",
      legacy_kind: base.kind,
      semantic_kind: "conversation_management",
      components: ["conversation_management"],
    };
  }
  const hasAction = actions.length > 0 || (parsed.managementDecisions || []).length > 0;
  const hasReasoning = Boolean(parsed.reasoning);
  const hasPatientQuestion = (parsed.intents || []).some((intent) => intent.type === "question");
  const components = [];
  if (hasAction) components.push("clinical_action");
  if (mentorAnswer) components.push("mentor_answer");
  else if (hasReasoning) components.push("clinical_reasoning");
  if (hasPatientQuestion && !mentorAnswer) components.push("patient_question");
  const semanticKind = hasAction
    ? "clinical_action"
    : mentorAnswer
      ? "mentor_answer"
      : hasReasoning
        ? "clinical_reasoning"
        : hasPatientQuestion
          ? "patient_question"
          : "unknown";
  return {
    ...base,
    kind: semanticKind,
    legacy_kind: base?.kind || "unknown",
    semantic_kind: semanticKind,
    components: [...new Set(components.length ? components : [semanticKind])],
  };
}

/** Did the learner explicitly ask for something to be done again? */
export function requestsExplicitRepeat(input) {
  return EXPLICIT_REPEAT_ACTION_RE.test(normalize(input));
}

/**
 * Drop operations that would re-run something the patient already had.
 *
 * An action already in a terminal state is not performed twice by a message that
 * merely mentions it again. Suppression is recorded rather than silent, so the
 * event log can show that the learner said it and the engine chose not to repeat
 * it.
 *
 * Repeating IS allowed when the learner asks for it in words ("повтори ОАК",
 * "осмотр в динамике"): serial re-examination is a real clinical act.
 *
 * @param {Array} operations planned operations
 * @param {Object} actionStates workingMemory.actionStates
 * @param {boolean} explicitRepeat learner asked for a repeat in words
 */
export function suppressDuplicateOperations(operations, actionStates, explicitRepeat) {
  if (explicitRepeat) return { operations, suppressed: [] };
  const terminal = new Set(["resulted", "performed"]);
  const suppressed = [];
  const kept = operations.filter((operation) => {
    const status = actionStates?.[operation.action_id]?.status;
    if (!terminal.has(status)) return true;
    suppressed.push({ action_id: operation.action_id, previous_status: status });
    return false;
  });
  return { operations: kept, suppressed };
}
