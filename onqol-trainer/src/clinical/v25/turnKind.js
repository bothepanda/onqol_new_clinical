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
      reason: "learner asked for the previous question to be restated",
      // The only kind that stops the clinical path outright.
      blocks_clinical_turn: true,
    };
  }

  if (REPEAT_RE.test(text)) {
    return {
      kind: "repeat_or_correction",
      reason: "learner restated an answer already given",
      // NOT blocking: the restatement usually carries the plan, and the learner's
      // reasoning still deserves to be recorded. Re-execution is prevented by
      // idempotency instead - see suppressDuplicateOperations().
      blocks_clinical_turn: false,
    };
  }

  return { kind: "unknown", reason: null, blocks_clinical_turn: false };
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
