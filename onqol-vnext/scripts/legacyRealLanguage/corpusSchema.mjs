import { COMMAND } from "../../src/core/commands/commandTypes.js";
import { COMMITMENT } from "../../src/ai/interpreter/commitmentPolicy.js";

/**
 * Schema of the legacy_real_language_development corpus (DEVELOPMENT data only).
 *
 * Every label here is DRAFT LINGUISTIC intent: "what did the learner say, in terms of
 * the commands the current simulator can represent". It is never a statement that an
 * action is clinically correct, and it is never copied from what the legacy ON QOL
 * system answered. Nothing in this corpus is holdout or generalization evidence.
 */
export const CORPUS_ID = "legacy_real_language_development";
export const CORPUS_SCHEMA = "onqol-legacy-real-language-corpus-v1";

export const CHANNELS = Object.freeze(["clinical_action", "patient_question", "clinical_reasoning", "mentor_answer", "conversation_management", "compound"]);
export const SCOPES = Object.freeze(["IN_SCOPE", "OUT_OF_CURRENT_SCOPE"]);
/** The six v3A.1 commitment statuses, plus NOT_APPLICABLE for turns that carry no action language at all. */
export const COMMITMENT_STATES = Object.freeze([...Object.values(COMMITMENT), "NOT_APPLICABLE", "MIXED"]);
export const CONFIDENCE = Object.freeze(["high", "medium", "low"]);
/**
 * How one expected command is scored (default `execute`).
 *   execute   the interpreter must commit exactly this command
 *   clarify   the learner named the action but not every required parameter: the interpreter must produce the
 *             INCOMPLETE command (so the character asks), and must not fill the `absent` parameters itself
 *   either    two safe behaviours are equally right (a complete command with these params, or the clarification)
 *   optional  defensible both ways (execute or not); never a miss, never a false execution if it matches
 * `altTypes` lists other command types that are an equally correct reading of the same words; `anyOf` lists
 * alternative parameter sets (any one matches). Both exist so a genuinely two-way reading is not scored as an error.
 */
export const EXPECT_MODES = Object.freeze(["execute", "clarify", "either", "optional"]);
/**
 * What the interpreter is expected to do with the turn.
 *   commands           execute exactly `expectedCommands`; nothing unresolved that matters
 *   commands_partial   execute exactly `expectedCommands`; `unmodeledFragments` may (and should) stay unresolved,
 *                      but must never be executed as something else
 *   clarify            ask for the missing piece; commit nothing outside `expectedCommands`
 *   no_action          execute no action command (reasoning, mentor answer, hedge, refusal, chatter)
 *   unresolved         nothing executable; the fragment stays unresolved
 */
export const DISPOSITIONS = Object.freeze(["commands", "commands_partial", "clarify", "no_action", "unresolved"]);
export const AMBIGUITY_LEVELS = Object.freeze(["none", "lexical", "underspecified", "genuine"]);

export const IN_SCOPE_REASONS = Object.freeze([
  "modeled_action",        // at least one action the current command + registry vocabulary can express
  "non_action_control",    // pure control / chatter / mentor answer whose correct handling is "do not execute"
  "non_action_reasoning",  // reasoning the current interpreter may record (STATE_REASONING) but must not execute
]);
export const OUT_OF_SCOPE_REASONS = Object.freeze([
  "unmodeled_investigation", // only investigations with no entry in the current registries (ECG, X-ray, endoscopy ...)
  "unmodeled_intervention",  // only interventions / drugs / operations the current registries do not contain
  "domain_content",          // disease-specific reasoning or oncology / staging discussion with no representation
  "unmodeled_other",
]);

const TYPES = new Set(Object.values(COMMAND));

export function validateAnnotation(turn) {
  const errors = [];
  const need = (cond, message) => { if (!cond) errors.push(message); };
  need(CHANNELS.includes(turn.channel), `channel:${turn.channel}`);
  need(SCOPES.includes(turn.scope), `scope:${turn.scope}`);
  need(COMMITMENT_STATES.includes(turn.commitmentState), `commitmentState:${turn.commitmentState}`);
  need(DISPOSITIONS.includes(turn.expectedDisposition), `expectedDisposition:${turn.expectedDisposition}`);
  need(AMBIGUITY_LEVELS.includes(turn.ambiguity?.level), `ambiguity.level:${turn.ambiguity?.level}`);
  need(Array.isArray(turn.expectedCommands), "expectedCommands_not_array");
  for (const [index, command] of (turn.expectedCommands ?? []).entries()) {
    need(TYPES.has(command.type), `expectedCommands[${index}].type:${command.type}`);
    need(command.params && typeof command.params === "object", `expectedCommands[${index}].params`);
  }
  need(CONFIDENCE.includes(turn.annotationConfidence), `annotationConfidence:${turn.annotationConfidence}`);
  need(Array.isArray(turn.unmodeledFragments), "unmodeledFragments_not_array");
  need(Array.isArray(turn.namedButNotCommitted ?? []), "namedButNotCommitted_not_array");
  for (const [index, command] of (turn.expectedCommands ?? []).entries()) {
    need(EXPECT_MODES.includes(command.expect ?? "execute"), `expectedCommands[${index}].expect:${command.expect}`);
    for (const alt of command.altTypes ?? []) need(TYPES.has(alt), `expectedCommands[${index}].altTypes:${alt}`);
  }
  need(typeof turn.scopeReason === "string" && turn.scopeReason.length > 0, "scopeReason_missing");
  need(typeof turn.annotationNote === "string" && turn.annotationNote.length > 0, "annotationNote_missing");
  if (turn.scope === "IN_SCOPE") need(IN_SCOPE_REASONS.includes(turn.scopeReason), `scopeReason_for_in_scope:${turn.scopeReason}`);
  if (turn.scope === "OUT_OF_CURRENT_SCOPE") need(OUT_OF_SCOPE_REASONS.includes(turn.scopeReason), `scopeReason_for_out_of_scope:${turn.scopeReason}`);
  if (turn.scopeReason === "modeled_action") need(turn.expectedCommands.length > 0, "modeled_action_without_commands");
  if (["non_action_control", "non_action_reasoning"].includes(turn.scopeReason)) need(turn.expectedDisposition === "no_action" || turn.expectedCommands.length > 0, "non_action_disposition");
  if (turn.expectedDisposition === "commands_partial") need(turn.unmodeledFragments.length > 0 && turn.expectedCommands.length > 0, "commands_partial_needs_both");
  if (turn.expectedDisposition === "no_action") need(turn.expectedCommands.length === 0, "no_action_with_commands");
  if (turn.channel === "compound") need(Array.isArray(turn.channelsPresent) && turn.channelsPresent.length >= 2, "compound_needs_channelsPresent");
  return errors;
}
