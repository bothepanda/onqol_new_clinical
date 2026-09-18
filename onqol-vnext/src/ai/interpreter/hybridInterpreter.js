/**
 * Hybrid language interpreter (wave §4-§7, §18-§19).
 *
 *   raw learner text
 *     -> deterministic fast path (always runs, always authoritative for what it
 *        resolves)
 *     -> IF the deterministic pass left something unresolved AND a provider is
 *        configured: one semantic ACTION extraction, schema- and
 *        concept-validated, parameters rebound ONLY from the learner's verbatim
 *        evidence (splitSemanticInterpreter.interpretSemanticTask)
 *     -> MERGE the validated semantic commands in - they are ADDED, never
 *        substituted for a deterministic command, and each still goes through
 *        validateCommand / executeCommand like any other command.
 *
 * The model never mutates state and never executes. On any provider failure,
 * timeout, invalid structure, or empty result the turn falls back to the
 * deterministic reading unchanged (fail closed - §18). Replay never calls this:
 * the structured interpretation is recorded in the event log (§19).
 */
import { createCommand } from "../../core/commands/commandTypes.js";
import { interpretDeterministically } from "./deterministicInterpreter.js";
import { interpretSemanticTask } from "./splitSemanticInterpreter.js";
import { SEMANTIC_TASK } from "./semanticTaskSchemas.js";
import { INTERPRETER_BUDGET } from "../modelConfig.js";

/** Words that make a "nothing matched" turn look like an attempted action. */
const ACTIONABLE_HINT = /назнач|закаж|заказ|сделай|сделать|дай|дать|введ|вводи|бер[уи]|начина|провед|осмотр|анализ|исследов|препарат|мг|мл|в\/в|в\/м|п\/к/i;

export async function interpretHybrid({
  text,
  turnContext = {},
  bundle = null,
  idPrefix = "cmd",
  provider = null,
  locale = "ru",
  timeoutBudgetMs = INTERPRETER_BUDGET.hybridMs,
  // Injectable for tests; production always uses the real semantic task.
  runSemantic = interpretSemanticTask,
}) {
  const started = Date.now();
  const deterministic = interpretDeterministically({ text, turnContext, idPrefix, bundle });

  if (!shouldEscalate(deterministic, text) || !provider?.isConfigured) {
    return { mode: "deterministic", ...deterministic, semanticTelemetry: telemetryOf({ status: "not_called" }, {
      errorCode: !provider?.isConfigured ? "no_provider_configured" : null, added: 0, costUsd: 0, elapsedMs: Date.now() - started,
    }) };
  }

  let semantic;
  try {
    semantic = await withTimeout(
      runSemantic({ task: SEMANTIC_TASK.ACTION, provider, text, locale, turnContext, bundle, strictAction: true }),
      timeoutBudgetMs,
    );
  } catch (error) {
    return failClosed(deterministic, { errorCode: error?.message ?? "semantic_call_threw", elapsedMs: Date.now() - started });
  }

  if (!semantic || semantic.status !== "valid") {
    return failClosed(deterministic, {
      ...telemetryOf(semantic ?? {}, { added: 0 }),
      errorCode: semantic?.errorCode ?? semantic?.status ?? "semantic_unavailable",
      semanticStatus: semantic?.status ?? null,
      elapsedMs: semantic?.elapsedMs ?? null,
    });
  }

  const accepted = semantic.acceptedCommands ?? [];
  // A command whose only problem was an ungrounded identifying concept (see
  // `identifyingParamKey`) arrives here with that concept already stripped.
  // It is merged in exactly like any accepted command; `validateCommand`
  // downstream (`executeCommand.js`) then reads it as an ordinary incomplete
  // order and asks the learner which one they meant - the same CLARIFY path
  // used for any other missing required parameter, never a model guess.
  const ambiguous = semantic.ambiguousCommands ?? [];
  if (accepted.length === 0 && ambiguous.length === 0) {
    // The model resolved nothing new - keep the deterministic reading, so its
    // own unresolved fragments still surface to the learner as clarifications.
    return {
      mode: "hybrid",
      ...deterministic,
      semanticTelemetry: telemetryOf(semantic, { added: 0 }),
    };
  }

  const mergeRejected = [];
  const added = mergeSemanticCommands({ deterministic, accepted: [...accepted, ...ambiguous], idPrefix, rejected: mergeRejected });
  const commands = [...deterministic.commands, ...added];
  const covered = coveredSpans(added);
  const unmatchedFragments = (deterministic.unmatchedFragments ?? []).filter(
    (fragment) => !covered.some((span) => fragment.includes(span) || span.includes(fragment)),
  );
  const onlyReasoning = commands.length > 0 && commands.every((c) => c.type === "STATE_REASONING");

  return {
    mode: "hybrid",
    intent: commands.length === 0
      ? deterministic.intent
      : onlyReasoning
        ? "CLINICAL_REASONING"
        : "CLINICAL_ACTION",
    commands,
    unmatchedFragments,
    rawText: text.trim(),
    mentorSignal: deterministic.mentorSignal ?? null,
    answeredMentorQuestion: deterministic.answeredMentorQuestion ?? false,
    semanticTelemetry: telemetryOf(semantic, { added: added.length, addedCommands: added, ambiguousProposed: ambiguous.length,
      rejected: [...(semantic.actionValidation ?? []).filter((item) => !item.eligibleForBinding), ...mergeRejected] }),
  };
}

function shouldEscalate(deterministic, text) {
  if ((deterministic.unmatchedFragments ?? []).length > 0) return true;
  if (deterministic.commands.length === 0 && deterministic.intent === "CLINICAL_REASONING") {
    return ACTIONABLE_HINT.test(text);
  }
  return false;
}

function failClosed(deterministic, diagnostics) {
  return {
    mode: "hybrid_fallback_deterministic",
    ...deterministic,
    semanticTelemetry: { ...telemetryOf({}, { added: 0 }), ...diagnostics, status: "fallback", clinicalAuthority: "none" },
  };
}

/**
 * Semantic commands are ADDED, not substituted. A semantic command is dropped
 * when the deterministic pass already produced a command of the same type
 * carrying the same primary concept, so the model cannot silently override a
 * deterministic reading.
 */
function mergeSemanticCommands({ deterministic, accepted, idPrefix, rejected }) {
  const deterministicKeys = new Set(deterministic.commands.map(primaryKey));
  const out = [];
  accepted.forEach((candidate, index) => {
    const command = createCommand({
      id: `${idPrefix}-s${index}`,
      type: candidate.type,
      params: candidate.params ?? {},
      sourceText: candidate.evidence ?? (candidate.evidenceSpans ?? []).join(" "),
    });
    if (deterministicKeys.has(primaryKey(command)) || out.some((existing) => primaryKey(existing) === primaryKey(command))) {
      rejected.push({ index, type: candidate.type, reason: "duplicate_primary_concept" });
      return;
    }
    out.push(command);
  });
  return out;
}

function primaryKey(command) {
  const p = command.params ?? {};
  const concept = p.testId ?? p.drugId ?? p.region ?? p.role ?? p.destination ?? p.topic ?? "";
  return `${command.type}:${concept}`;
}

function coveredSpans(commands) {
  return commands
    .map((command) => command.sourceText ?? "")
    .map((span) => span.trim().toLowerCase())
    .filter(Boolean);
}

function telemetryOf(semantic, extra) {
  return {
    status: semantic.status,
    errorCode: semantic.errorCode ?? null,
    model: semantic.providerMeta?.model ?? null,
    costUsd: semantic.providerMeta?.costUsd ?? null,
    clinicalAuthority: "none",
    elapsedMs: semantic.elapsedMs ?? null,
    providerMeta: semantic.providerMeta ?? null,
    conceptErrors: semantic.conceptErrors ?? [],
    schemaErrors: semantic.schemaErrors ?? [],
    proposed: (semantic.proposedCommands ?? []).length,
    proposedCommands: semantic.proposedCommands ?? [],
    rejected: (semantic.actionValidation ?? []).filter((item) => !item.eligibleForBinding),
    ...extra,
  };
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("semantic_timeout")), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}
