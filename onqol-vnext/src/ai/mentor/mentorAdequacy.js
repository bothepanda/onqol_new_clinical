/**
 * Stateful Grounded Mentor Wave A - the learner-adequacy classifier
 * (ТЗ §9). Deterministic and small on purpose: it never calls an LLM and
 * never invents a clinical judgement - it only reads what the interpreter,
 * `mentorEngine.decideMentorResponse`, and `state.mentor`'s existing working
 * memory already produced, and turns that into one of six named states so
 * `mentorMemory.js` can decide whether to close the current issue, escalate
 * scaffolding, or defer it.
 *
 * This module deliberately does NOT touch the interpreter (it is mid-flight,
 * unrelated work - see docs/LEGACY_REAL_LANGUAGE_REMEDIATION_2026-09-20.md).
 * Everything here is new code in the mentor layer, consuming the
 * interpreter's existing output as-is.
 */

export const ADEQUACY = Object.freeze({
  SUFFICIENT: "SUFFICIENT",
  PARTIAL: "PARTIAL",
  VAGUE: "VAGUE",
  STUCK: "STUCK",
  EVASIVE: "EVASIVE",
  UNSAFE: "UNSAFE",
});

// "не знаю" and its close variants - the exact turn spec §8's example is
// built around. Matched loosely (stems only) because Cyrillic input in this
// corpus carries free inflection and typos (see legacy-real-language corpus
// notes on RU/EN mixing and typos kept verbatim).
const STUCK_PATTERNS = [
  /не\s+зна[ею]/iu,
  /не\s+увер[ея]н/iu,
  /понятия не имею/iu,
  /затрудняюсь/iu,
];

// A reply short enough, and generic enough, that it cannot by itself carry
// the reasoning the pending question asked for - "да", "нет", "лапароскопия"
// (one noun, no rationale), etc. Length threshold is deliberately generous;
// this is a coarse Wave-A heuristic, not an NLU model.
const VAGUE_MAX_CHARS = 12;

const EVASIVE_PATTERNS = [
  /не\s+важно/iu,
  /проехали/iu,
  /давай\s+дальше/iu,
  /это\s+не\s+ко\s+мне/iu,
];

/**
 * @param {object} args
 * @param {object} args.mentorCandidate  `decideMentorResponse()`'s output for THIS turn
 * @param {object} args.interpreted      the interpreter's output for THIS turn
 * @param {object} args.turnResult       the last command result of THIS turn (or `{outcome:"EXECUTED"}` for a zero-command turn)
 * @param {object|null} args.pendingMentorQuestion  `state.mentor.pendingMentorQuestion` BEFORE this turn
 * @param {string} args.text             the learner's raw text this turn
 */
export function classifyAdequacy({ mentorCandidate, interpreted, turnResult, pendingMentorQuestion, text }) {
  // Safety outranks everything else, exactly as in mentorEngine.js.
  if (mentorCandidate.mode === "SAFETY_STOP" || turnResult?.outcome === "SAFETY_STOP") return ADEQUACY.UNSAFE;

  const noCommands = !interpreted?.commands?.length;
  const hasPendingQuestion = Boolean(pendingMentorQuestion);

  // A committed clinical action, with nothing the deterministic engine chose
  // to challenge or clarify about it, is a sufficient turn whether or not a
  // question was pending - the action itself is the answer (ТЗ §13: broad
  // approved actions do not require the learner to narrate their reasoning).
  if (!noCommands && mentorCandidate.mode === "CONTINUE" && !mentorCandidate.openQuestion) {
    return ADEQUACY.SUFFICIENT;
  }

  if (hasPendingQuestion && noCommands) {
    const trimmed = (text ?? "").trim();
    if (STUCK_PATTERNS.some((pattern) => pattern.test(trimmed))) return ADEQUACY.STUCK;
    if (EVASIVE_PATTERNS.some((pattern) => pattern.test(trimmed))) return ADEQUACY.EVASIVE;
    if (trimmed.length > 0 && trimmed.length <= VAGUE_MAX_CHARS) return ADEQUACY.VAGUE;
  }

  // The interpreter's existing binary signal (unchanged input, richer output).
  if (interpreted?.mentorSignal === "STUCK") return ADEQUACY.STUCK;
  if (interpreted?.mentorSignal === "ATTEMPT") return ADEQUACY.PARTIAL;

  // The deterministic engine decided there is something to challenge/clarify/
  // teach: a real issue exists this turn, but nothing above classified the
  // learner's own words as inadequate - treat as a fresh partial attempt
  // rather than assuming sufficiency the engine itself just contradicted.
  if (mentorCandidate.openQuestion) return ADEQUACY.PARTIAL;

  return ADEQUACY.SUFFICIENT;
}

/**
 * ТЗ §8: a short reply is not an independent turn when a mentor question is
 * still open - it must be read against that question. This is the gate
 * `submitLearnerTurn.js` uses to decide whether to run adequacy classification
 * against `state.mentor.pendingMentorQuestion` at all this turn.
 */
export function answersPendingQuestion({ interpreted, pendingMentorQuestion }) {
  return Boolean(pendingMentorQuestion) && !interpreted?.commands?.length;
}
