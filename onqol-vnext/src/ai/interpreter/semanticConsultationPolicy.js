import { COMMAND, validateCommand } from "../../core/commands/commandTypes.js";
import {
  APPROACH_SYNONYMS,
  CHEMISTRY_ANALYTE_SYNONYMS,
  DISPOSITION_SYNONYMS,
  DRUG_SYNONYMS,
  MONITORING_TARGETS,
  REGION_SYNONYMS,
  STAFF_SYNONYMS,
  TEST_SYNONYMS,
} from "./vocabulary.js";
import { NEUTRAL_TOKEN, tokenize } from "./textMatch.js";

/**
 * When is the semantic model consulted - and about WHICH clauses?
 *
 * Before v3 the answer was "only when the deterministic pass left an
 * unmatched fragment". That made a deterministic COMMAND automatically
 * authoritative even when the command was a wrong reading of free-form
 * language. v3 inverted the burden, but it decided for the WHOLE TURN: one
 * hedge word, or one clause with three free tokens, sent every clause of the turn to
 * the model - including the canonical ones the deterministic pass had already read
 * exactly. Measured on real resident turns that was 61 of 69 rows, and the model then
 * "corrected" clauses nobody needed a second opinion on (a canonical operation name
 * withheld because the model proposed something overlapping it).
 *
 * v3B decides per CLAUSE (clauseParser.js). A clause needs the model only when the
 * deterministic reading of THAT clause is not final:
 *
 *   unresolved   nothing was read from it, and it is not reasoning, courtesy or a cue-only
 *                clause governing a neighbour;
 *   ambiguous    a command was read but not from a canonical form: more free words than a
 *                bare verb and its object (unless the whole clause is a structural form the
 *                matcher anchors on), or an incomplete command that still has free words;
 *   conflicting  a committed clause that also carries negation / alternative / exclusion words
 *                («или», «вместо», «кроме», «без», «не …»): the words may contradict the reading;
 *   contextual   an elliptical reply the preceding system question could not resolve.
 *
 * Everything else is FINAL and is not sent: a canonical committed clause, a clause the commitment
 * gate withheld (hedged, conditional, deferred, refused - a second reading cannot make it a
 * decision), reasoning, courtesy, a nominal answer to a question that asked for reasoning. Only the
 * clauses that need a second reading are sent (`focus.text`); a turn whose clauses are all
 * canonical never reaches the provider.
 *
 * This is deliberately NOT a second Russian parser. It measures one structural property of words the
 * deterministic pass already consumed: how many of them are neither literal parameters nor entries
 * of the reviewed lexicon. Widening coverage is done by editing vocabulary data.
 */
export const CONSULTATION_REASON = Object.freeze({
  EXPLANATION_REQUEST: "explanation_request",
  CONTROL_OR_MENTOR: "control_or_mentor_intent",
  CLARIFICATION_ANSWER: "open_clarification_answer",
  UNMATCHED: "unmatched_fragments",
  HINT_WITHOUT_COMMAND: "actionable_hint_without_command",
  NO_ACTION_LANGUAGE: "no_action_language",
  HEDGE_OR_NEGATION: "hedge_or_negation_marker",
  NON_CANONICAL: "non_canonical_form",
  INCOMPLETE: "incomplete_deterministic_command",
  CANONICAL: "canonical_deterministic_form",
  // Every action the turn named was hedged, conditioned, asked about, deferred or
  // refused (commitmentPolicy.js). A second reading cannot make it a decision.
  ALL_UNCOMMITTED: "all_actions_uncommitted",
});

/** Free tokens allowed in a canonical fragment: a bare verb plus its object. */
export const CANONICAL_FREE_TOKEN_LIMIT = 2;

export const CONSULTATION_POLICY_VERSION = "consultation-2026-09-20-clause-level-r1";

const BOOKKEEPING = new Set([COMMAND.STATE_REASONING, COMMAND.ANSWER_MENTOR]);
const CONTROL_INTENTS = new Set(["REQUEST_CURRENT_STATUS", "REPEAT_REQUEST", "CONVERSATION_MANAGEMENT", "MENTOR_ANSWER"]);

/** Words that make a "nothing matched" clause look like an attempted action. */
const ACTIONABLE_HINT = /назнач|закаж|заказ|сделай|сделать|дай|дать|введ|вводи|бер[уи]|начина|провед|осмотр|анализ|исследов|препарат|мг|мл|в\/в|в\/м|п\/к/i;

/**
 * Negation, cancellation, alternative and exclusion inside a clause the gate COMMITTED: the words may contradict
 * the reading. (Hedge, condition and deferral are not here: the commitment gate has already decided those.)
 */
const CONFLICT_MARKER = /^(?:не|нет|без|отмен\S*|никак\S*|ничего|или|либо|вместо|кроме)$/;

export const LEXICON_TOKENS = new Set(
  [TEST_SYNONYMS, REGION_SYNONYMS, DRUG_SYNONYMS, CHEMISTRY_ANALYTE_SYNONYMS, STAFF_SYNONYMS, MONITORING_TARGETS, DISPOSITION_SYNONYMS, APPROACH_SYNONYMS]
    .flatMap((table) => Object.keys(table))
    .flatMap((phrase) => tokenize(phrase)),
);

export function freeTokens(fragment) {
  return tokenize(fragment).filter((token) => !NEUTRAL_TOKEN.test(token) && !LEXICON_TOKENS.has(token));
}

export function hasNonCanonicalMarker(text) {
  return tokenize(text).some((token) => CONFLICT_MARKER.test(token) || /^(?:возможно|может|вдруг|бы|пока|потом|позже|если)$/.test(token));
}

/** Why the deterministic reading of this clause is not final, or null when it is. */
function clauseDoubt(clause, commands, decisions) {
  if (clause.unresolved) {
    return decisions.actionable(clause.text) || decisions.unmatched.has(clause.text)
      ? { reason: CONSULTATION_REASON.UNMATCHED, kind: clause.context ? "contextual" : "unresolved" } : null;
  }
  if (clause.commandIds.length === 0) return null; // reasoning, courtesy, withheld, mentor answer: final
  const own = commands.filter((command) => clause.commandIds.includes(command.id));
  if (tokenize(clause.text).some((token) => CONFLICT_MARKER.test(token))) return { reason: CONSULTATION_REASON.HEDGE_OR_NEGATION, kind: "conflicting" };
  for (const command of own) {
    const free = freeTokens(command.sourceText).length;
    if (free > CANONICAL_FREE_TOKEN_LIMIT && !clause.structural) return { reason: CONSULTATION_REASON.NON_CANONICAL, kind: "ambiguous", freeTokens: free, commandId: command.id };
    if (free >= 1 && validateCommand(command).outcome === "CLARIFY") return { reason: CONSULTATION_REASON.INCOMPLETE, kind: "ambiguous", freeTokens: free, commandId: command.id };
  }
  return null;
}

export function decideSemanticConsultation({ deterministic, text }) {
  const decision = (consult, reason, extra = {}) => ({ consult, fastPath: !consult, reason, policyVersion: CONSULTATION_POLICY_VERSION, ...extra });
  if (deterministic.explanationRequest) return decision(false, CONSULTATION_REASON.EXPLANATION_REQUEST);
  if (CONTROL_INTENTS.has(deterministic.intent)) return decision(false, CONSULTATION_REASON.CONTROL_OR_MENTOR);
  if (deterministic.answeredClarification) return decision(false, CONSULTATION_REASON.CLARIFICATION_ANSWER);

  const clauses = deterministic.clauses ?? [];
  const commands = (deterministic.commands ?? []).filter((command) => !BOOKKEEPING.has(command.type));
  const unmatched = new Set(deterministic.unmatchedFragments ?? []);
  const actions = commands;
  const withheld = deterministic.withheldCommands ?? [];

  // The clauses whose deterministic reading is not final, each with why.
  const doubts = clauses.map((clause) => ({ clause, doubt: clauseDoubt(clause, commands, { unmatched, actionable: (value) => actions.length === 0 && ACTIONABLE_HINT.test(value) && !clause.commitment }) }))
    .filter(({ doubt }) => doubt);
  // Turns with no clause structure (a hand-built result) keep the whole-turn reading.
  if (clauses.length === 0) {
    if (unmatched.size > 0) return decision(true, CONSULTATION_REASON.UNMATCHED, { focus: { clauseIds: [], text } });
    if (actions.length === 0) {
      if (withheld.length > 0) return decision(false, CONSULTATION_REASON.ALL_UNCOMMITTED);
      return ACTIONABLE_HINT.test(text) ? decision(true, CONSULTATION_REASON.HINT_WITHOUT_COMMAND, { focus: { clauseIds: [], text } }) : decision(false, CONSULTATION_REASON.NO_ACTION_LANGUAGE);
    }
    return decision(false, CONSULTATION_REASON.CANONICAL);
  }

  if (doubts.length > 0) {
    const first = doubts[0].doubt;
    // Send only what is in doubt. A turn in which every clause is in doubt is sent exactly as the learner typed it.
    const whole = doubts.length === clauses.length;
    return decision(true, first.reason, {
      ...(first.freeTokens != null ? { freeTokens: first.freeTokens, commandId: first.commandId } : {}),
      focus: {
        clauseIds: doubts.map(({ clause }) => clause.id),
        kinds: doubts.map(({ clause, doubt }) => ({ clauseId: clause.id, kind: doubt.kind, reason: doubt.reason })),
        text: whole ? text : doubts.map(({ clause }) => clause.text).join("\n"),
        whole,
        finalClauses: clauses.length - doubts.length,
      },
    });
  }
  if (actions.length === 0) {
    if (withheld.length > 0) return decision(false, CONSULTATION_REASON.ALL_UNCOMMITTED);
    return decision(false, CONSULTATION_REASON.NO_ACTION_LANGUAGE);
  }
  return decision(false, CONSULTATION_REASON.CANONICAL, { finalClauses: clauses.length });
}
