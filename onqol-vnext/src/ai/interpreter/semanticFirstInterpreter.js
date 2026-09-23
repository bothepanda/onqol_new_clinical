import { COMMAND, createCommand } from "../../core/commands/commandTypes.js";
import { interpretDeterministically } from "./deterministicInterpreter.js";
import { interpretSemanticTask, VALIDATION_MODE } from "./splitSemanticInterpreter.js";
import { SEMANTIC_TASK } from "./semanticTaskSchemas.js";
import { DEFAULT_PROMOTION_POLICY } from "./promotionPolicy.js";
import { arbitrate } from "./candidateArbitration.js";
import { segmentClauses } from "./clauseParser.js";
import { containsNormalized, normalizeText, locateRanges, tokenize, rangesOverlap } from "./textMatch.js";
import { DISCUSSION_FRAME, INTENT_CLARIFICATION } from "./discussionFrame.js";
import { buildConversationFrame, isExpectationAnswer } from "./conversationContext.js";
import { INTERPRETER_BUDGET } from "../modelConfig.js";

export const SEMANTIC_FIRST_VERSION = "semantic-first-2026-09-21-v1";
export const SEMANTIC_FIRST_POLICY = Object.freeze({
  ...DEFAULT_PROMOTION_POLICY,
  version: SEMANTIC_FIRST_VERSION,
  semanticFirst: true,
});

// Only exact, standalone shorthand lists bypass semantic interpretation. No
// counting "unknown words", stemming, or expansion of a free sentence into an
// order. These are conveniences, not the supported clinical-concept registry.
const SHORTHAND = new Set(["оак", "бхак", "срб", "оам", "хгч", "кт обп", "узи обп", "омт"]);
const CONTROLS = new Set(["повтори", "завершить кейс"]);
const BOOKKEEPING = new Set([COMMAND.STATE_REASONING, COMMAND.ANSWER_MENTOR]);
export const SEMANTIC_UNAVAILABLE = "Не удалось разобрать сообщение. Действия не выполнены. Повтори запрос или укажи точное сокращение исследования, например «ОАК».";

export function isExactShorthand(text) {
  const parts = normalizeText(text).split(/\s*(?:[,;+]|\sи\s)\s*/u);
  return parts.length > 0 && parts.every((part) => SHORTHAND.has(part));
}

/**
 * Free language -> semantic candidates -> existing validation/binding and
 * commitment gate -> core commands. The deterministic reading is diagnostic
 * evidence and bookkeeping, NEVER an alternative execution of free language.
 * A failed/empty extraction cannot resurrect a dictionary guess.
 * No patient facts are sent to the provider; the request contains concept IDs
 * and the preceding question contract only. Replay uses recorded commands.
 */
export async function interpretSemanticFirst({
  text, turnContext = {}, bundle, provider, idPrefix = "cmd", locale = "ru",
  timeoutBudgetMs = INTERPRETER_BUDGET.hybridMs,
}) {
  const started = Date.now();
  const deterministic = interpretDeterministically({ text, turnContext, bundle, idPrefix });
  const normalized = normalizeText(text);
  const exact = CONTROLS.has(normalized) || (isExactShorthand(text) && !turnContext.openMentorQuestion && !turnContext.precedingPrompt && !turnContext.openClarification);
  // A literal answer to an existing parameter question may complete the
  // resident's own prior order. The deterministic parser records this channel;
  // no arbitrary free-form answer earns a fast path.
  const parameterReply = deterministic.answeredClarification && /^(?:в\s*\/\s*[вм]|iv|im|po|\d+(?:[.,]\d+)?\s*(?:мг|мл|г|мин|минут|час|часа|часов))$/iu.test(text.trim());
  if (exact || parameterReply) return {
    ...deterministic,
    mode: "semantic_first_fast_path",
    semanticTelemetry: {
      status: "not_called", called: false, policyVersion: SEMANTIC_FIRST_VERSION,
      reason: parameterReply ? "literal_parameter_reply" : "exact_shorthand_or_control",
      clinicalAuthority: "none", finalCommands: deterministic.commands,
    },
  };

  const base = {
    ...deterministic,
    // REQUEST_CURRENT_STATUS is an execution shortcut in submitLearnerTurn;
    // a discarded dictionary guess must not survive through that shortcut.
    intent: deterministic.intent === "REQUEST_CURRENT_STATUS" ? "UNRESOLVED" : deterministic.intent,
    commands: deterministic.commands.filter((command) => BOOKKEEPING.has(command.type)),
    commandSequence: undefined,
    // Include every clause, including ones a lexical parser mistakenly thought
    // it had resolved. Failed candidates must stay visible to the resident.
    unmatchedFragments: segmentClauses(text).map((clause) => clause.text),
  };
  const audit = {
    policyVersion: SEMANTIC_FIRST_VERSION, clinicalAuthority: "none",
    deterministicCandidates: deterministic.commands.filter((command) => !BOOKKEEPING.has(command.type)),
  };
  const unavailable = (errorCode, semantic = null) => ({
    ...base, mode: "semantic_first_unavailable", interpretationNotice: SEMANTIC_UNAVAILABLE,
    semanticTelemetry: { ...audit, status: "unavailable", called: !!semantic, errorCode,
      elapsedMs: Date.now() - started, providerEvidence: semantic?.providerEvidence ?? null,
      finalCommands: base.commands, schemaErrors: semantic?.schemaErrors ?? [] },
  });
  if (!provider?.isConfigured) return unavailable("no_provider_configured");

  let semantic;
  let timer;
  try {
    semantic = await Promise.race([
      interpretSemanticTask({ task: SEMANTIC_TASK.ACTION, provider, text, locale, turnContext, bundle,
        strictAction: true, validationMode: VALIDATION_MODE.CANDIDATE_ARBITRATED, policy: SEMANTIC_FIRST_POLICY }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("semantic_timeout")), timeoutBudgetMs); }),
    ]);
  } catch (error) {
    return unavailable(error.message, { status: "provider_error" });
  } finally {
    clearTimeout(timer);
  }
  if (semantic.status !== "valid") return unavailable(semantic.errorCode ?? semantic.status, semantic);

  // Issues never become commands, and arbitrary provider text never becomes a
  // learner-facing message. Only actual substrings of this turn may surface.
  const issues = [...semantic.output.ambiguities, ...semantic.output.unresolvedFragments]
    .map((issue) => issue.evidenceSpan).filter((span) => containsNormalized(text, span));
  const tokens = tokenize(text);
  const expectationAnswer = tokens.length <= 3 && isExpectationAnswer({ frame: buildConversationFrame(turnContext), replyText: text });
  const issueRanges = locateRanges(tokens, issues);
  const discussion = DISCUSSION_FRAME.test(text);
  const candidates = semantic.candidateResults.map((candidate) => {
    if (candidate.decision === "REJECT") return candidate;
    const ranges = locateRanges(tokens, candidate.evidenceSpans);
    const conflictingIssue = issueRanges && ranges && rangesOverlap(issueRanges, ranges);
    if (!discussion && !conflictingIssue && !expectationAnswer) return candidate;
    return { ...candidate, decision: "REJECT", validatedCommand: null,
      reasonCodes: [...candidate.reasonCodes, discussion ? "discussion_not_execution" : expectationAnswer ? "mentor_answer_not_order" : "candidate_conflicts_with_issue"] };
  });
  const arbitration = arbitrate({ deterministic: base, candidates,
    rawText: text, idPrefix, policy: SEMANTIC_FIRST_POLICY, consulted: true });
  const rejected = candidates.filter((candidate) => candidate.decision === "REJECT")
    .flatMap((candidate) => candidate.evidenceSpans).filter((span) => containsNormalized(text, span));
  const commands = mergeLiteralReassessTargets(arbitration.finalCommands, deterministic.commands ?? []);
  const clinicalCommands = commands.filter((command) => !BOOKKEEPING.has(command.type));
  return {
    ...base, commands, mode: "semantic_first",
    ...(discussion && candidates.some((candidate) => candidate.reasonCodes.includes("discussion_not_execution")) ? { interpretationNotice: INTENT_CLARIFICATION } : {}),
    intent: clinicalCommands.length === 1 && clinicalCommands[0].type === COMMAND.REQUEST_STATUS && commands.length === 1
      ? "REQUEST_CURRENT_STATUS" : clinicalCommands.length ? "CLINICAL_ACTION" : base.intent,
    commandSequence: arbitration.commandSequence,
    // A list item the deterministic clause splitter left unresolved («пульс», «диурез»
    // in «переоценю давление, пульс и диурез») is not "unrecognised" when it sits
    // inside the words of an action that WAS understood (executed or withheld).
    unmatchedFragments: withoutUnderstoodSpans([...new Set([...arbitration.unmatchedFragments, ...issues, ...rejected])], [...commands, ...arbitration.withheldCommands]),
    withheldCommands: [...(deterministic.withheldCommands ?? []), ...arbitration.withheldCommands],
    semanticTelemetry: {
      ...audit, status: "valid", called: true, elapsedMs: Date.now() - started,
      providerMeta: semantic.providerMeta, providerEvidence: semantic.providerEvidence,
      candidateDecisions: arbitration.candidateDecisions, finalCommands: commands,
      resolutions: arbitration.resolutions, schemaErrors: semantic.schemaErrors,
      conceptErrors: semantic.conceptErrors,
    },
  };
}

function withoutUnderstoodSpans(fragments, commands) {
  const understood = commands.map((command) => normalizeText(command.sourceText ?? "")).filter(Boolean);
  return fragments.filter((fragment) => {
    const words = normalizeText(fragment);
    return !understood.some((span) => span.length > words.length && span.includes(words));
  });
}

// A model sometimes lists only the FIRST thing to measure. The deterministic
// reading of the same words names targets literally («давление, пульс, диурез,
// перфузию»); an accepted REASSESS gains the targets the learner literally
// named, never any the words do not contain.
function mergeLiteralReassessTargets(commands, deterministicCommands) {
  const literal = deterministicCommands.filter((command) => command.type === COMMAND.REASSESS).flatMap((command) => command.params?.targets ?? []);
  if (!literal.length) return commands;
  return commands.map((command) => {
    if (command.type !== COMMAND.REASSESS) return command;
    const targets = [...new Set([...(command.params?.targets ?? []), ...literal])];
    return targets.length === (command.params?.targets ?? []).length ? command : createCommand({ id: command.id, type: command.type, params: { ...command.params, targets }, sourceText: command.sourceText });
  });
}
