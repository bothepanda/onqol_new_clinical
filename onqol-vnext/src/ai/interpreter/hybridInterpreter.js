/**
 * Hybrid language interpreter (interpreter v3: semantic arbitration).
 *
 *   raw learner text
 *     -> deterministic pass (always runs): fast path, literal parameter binder
 *        and provider-failure fallback
 *     -> semanticConsultationPolicy: a narrow deterministic-only fast path for
 *        canonical forms; everything else is eligible for a semantic second
 *        opinion, even when the deterministic pass produced commands
 *     -> ONE semantic ACTION extraction, schema-validated; then every proposed
 *        item (clinicalActions AND patientQuestions) is validated on its own
 *        (actionCandidateValidation.js) - a rejected candidate never
 *        invalidates an unrelated valid one
 *     -> candidateArbitration: dedupe, keep non-overlapping commands, and
 *        resolve overlapping disagreement under the promotion policy. A
 *        validated semantic reading may CORRECT a deterministic one only in
 *        promoted classes; a protected-class disagreement becomes a
 *        clarification, never a model-selected execution.
 *
 * The model never mutates state, never executes, and never supplies a dose,
 * route, volume, rate, duration or timing: those are bound from the learner's
 * literal text only. Every command still goes through validateCommand /
 * executeCommand like any other. On any provider, transport or schema failure
 * the turn falls back to the deterministic reading unchanged (fail closed).
 * Replay never calls this: the final structured interpretation and this
 * turn's telemetry are recorded in the event log.
 */
import { COMMAND } from "../../core/commands/commandTypes.js";
import { interpretDeterministically } from "./deterministicInterpreter.js";
import { VALIDATION_MODE, interpretSemanticTask } from "./splitSemanticInterpreter.js";
import { SEMANTIC_TASK } from "./semanticTaskSchemas.js";
import { INTERPRETER_BUDGET } from "../modelConfig.js";
import { RESOLUTION, arbitrate } from "./candidateArbitration.js";
import { DEFAULT_PROMOTION_POLICY } from "./promotionPolicy.js";
import { decideSemanticConsultation } from "./semanticConsultationPolicy.js";

const BOOKKEEPING = new Set([COMMAND.STATE_REASONING, COMMAND.ANSWER_MENTOR]);

export async function interpretHybrid({
  text,
  turnContext = {},
  bundle = null,
  idPrefix = "cmd",
  provider = null,
  locale = "ru",
  timeoutBudgetMs = INTERPRETER_BUDGET.hybridMs,
  policy = DEFAULT_PROMOTION_POLICY,
  // Injectable for tests; production always uses the real semantic task.
  runSemantic = interpretSemanticTask,
}) {
  const started = Date.now();
  const deterministic = interpretDeterministically({ text, turnContext, idPrefix, bundle });
  const consultation = decideSemanticConsultation({ deterministic, text, turnContext });
  const deterministicCandidates = summarize(deterministic.commands);

  if (!consultation.consult || !provider?.isConfigured) {
    const resolutions = deterministic.commands.filter(isAction).map((command) => ({
      commandId: command.id, type: command.type, resolution: RESOLUTION.DETERMINISTIC_FAST_PATH, origins: ["deterministic"],
    }));
    return {
      mode: "deterministic",
      ...deterministic,
      semanticTelemetry: {
        ...telemetryOf({ status: "not_called" }, {
          errorCode: !provider?.isConfigured ? "no_provider_configured" : null, added: 0, costUsd: 0, elapsedMs: Date.now() - started,
        }),
        called: false,
        consultation,
        promotionPolicyVersion: policy.version,
        deterministicCandidates,
        arbitration: { policyVersion: policy.version, resolutions, conflictCount: 0, changed: false },
        finalCommands: finalSummary(deterministic.commands, resolutions),
        withheldCommands: deterministic.withheldCommands ?? [],
      },
    };
  }

  let semantic;
  try {
    semantic = await withTimeout(
      runSemantic({
        // Only the clauses whose deterministic reading is not final are sent (semanticConsultationPolicy.js). Their words are
        // verbatim substrings of the turn, so evidence still verifies; arbitration below reads the WHOLE turn.
        task: SEMANTIC_TASK.ACTION, provider, text: consultation.focus?.text ?? text, locale, turnContext, bundle, strictAction: true,
        validationMode: VALIDATION_MODE.CANDIDATE_ARBITRATED, policy,
      }),
      timeoutBudgetMs,
    );
  } catch (error) {
    return failClosed(deterministic, { errorCode: error?.message ?? "semantic_call_threw", elapsedMs: Date.now() - started }, { consultation, deterministicCandidates });
  }

  if (!semantic || semantic.status !== "valid") {
    return failClosed(deterministic, {
      ...telemetryOf(semantic ?? {}, { added: 0 }),
      errorCode: semantic?.errorCode ?? semantic?.status ?? "semantic_unavailable",
      semanticStatus: semantic?.status ?? null,
      elapsedMs: semantic?.elapsedMs ?? null,
    }, { consultation, deterministicCandidates });
  }

  const candidates = candidateResultsOf(semantic);
  const arbitration = arbitrate({ deterministic, candidates, rawText: text, idPrefix, policy, consulted: true });
  const commands = arbitration.finalCommands;
  const changed = arbitration.semanticCommands.length > 0 || arbitration.conflicts.some((conflict) => conflict.resolution !== RESOLUTION.DETERMINISTIC_PRESERVED);
  const rejected = rejectedOf(arbitration.candidateDecisions);
  const withheldCommands = [...(deterministic.withheldCommands ?? []), ...arbitration.withheldCommands];

  return {
    mode: "hybrid",
    ...deterministic,
    intent: changed ? intentOf(commands) : deterministic.intent,
    commands,
    unmatchedFragments: arbitration.unmatchedFragments,
    ...(withheldCommands.length ? { withheldCommands } : {}),
    // Arbitration saw the semantic additions too; its sequence replaces the deterministic pass's.
    commandSequence: arbitration.commandSequence ?? undefined,
    rawText: text.trim(),
    mentorSignal: deterministic.mentorSignal ?? null,
    answeredMentorQuestion: deterministic.answeredMentorQuestion ?? false,
    semanticTelemetry: {
      ...telemetryOf(semantic, {
        added: arbitration.semanticCommands.length,
        addedCommands: arbitration.semanticCommands,
        ambiguousProposed: candidates.filter((candidate) => candidate.decision === "CLARIFY").length,
        rejected,
      }),
      called: true,
      consultation,
      promotionPolicyVersion: arbitration.policyVersion,
      deterministicCandidates,
      candidateDecisions: arbitration.candidateDecisions,
      conflicts: arbitration.conflicts,
      arbitration: { policyVersion: arbitration.policyVersion, resolutions: arbitration.resolutions, conflictCount: arbitration.conflicts.length, changed },
      finalCommands: finalSummary(commands, arbitration.resolutions),
      withheldCommands,
      totalElapsedMs: Date.now() - started,
    },
  };
}

/**
 * Candidate-level results come from candidate-arbitrated validation. An injected
 * runner that predates them (returning only accepted / ambiguous commands) is
 * adapted so its commands still pass through the same arbitration.
 */
function candidateResultsOf(semantic) {
  if (Array.isArray(semantic.candidateResults)) return semantic.candidateResults;
  const adapt = (command, index, decision) => {
    const spans = command.evidenceSpans ?? (command.evidence ? [command.evidence] : []);
    return {
      index, source: "clinicalAction", candidate: { type: command.type, params: command.params ?? {}, evidenceSpans: spans },
      decision, reasonCodes: ["injected_result"], evidenceSpans: spans, grounding: "lexical",
      validatedCommand: { type: command.type, params: command.params ?? {}, evidence: command.evidence ?? spans.join(" "), evidenceSpans: spans },
    };
  };
  const accepted = (semantic.acceptedCommands ?? []).map((command, index) => adapt(command, index, "ACCEPT"));
  const offset = accepted.length;
  return [...accepted, ...(semantic.ambiguousCommands ?? []).map((command, index) => adapt(command, offset + index, "CLARIFY"))];
}

function intentOf(commands) {
  const actions = commands.filter(isAction);
  if (commands.length === 0) return "CLINICAL_REASONING";
  if (actions.length === 0) return "CLINICAL_REASONING";
  // A pure status read has no clinical effect and must not move the clock.
  if (actions.every((command) => command.type === COMMAND.REQUEST_STATUS)) return "REQUEST_CURRENT_STATUS";
  return "CLINICAL_ACTION";
}

/** Rejections and drops, in one list, for reconstruction and for older telemetry readers. */
function rejectedOf(decisions) {
  const out = [];
  for (const decision of decisions) {
    if (decision.validation === "REJECT") {
      out.push({ index: decision.index, source: decision.source, type: decision.type, reason: decision.reasonCodes[0] ?? "rejected", reasonCodes: decision.reasonCodes, stage: "validation" });
    } else if (decision.arbitration?.resolution === RESOLUTION.DEDUPLICATED) {
      out.push({ index: decision.index, source: decision.source, type: decision.type, reason: "duplicate_primary_concept", stage: "arbitration" });
    } else if (decision.arbitration?.reason) {
      out.push({ index: decision.index, source: decision.source, type: decision.type, reason: decision.arbitration.reason, stage: "arbitration" });
    }
  }
  return out;
}

function failClosed(deterministic, diagnostics, extra = {}) {
  return {
    mode: "hybrid_fallback_deterministic",
    ...deterministic,
    semanticTelemetry: {
      ...telemetryOf({}, { added: 0 }), ...diagnostics, ...extra, called: true, status: "fallback", clinicalAuthority: "none",
    },
  };
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
    conceptErrors: semantic.errors ?? semantic.conceptErrors ?? [],
    schemaErrors: semantic.schemaErrors ?? [],
    proposed: (semantic.proposedCommands ?? []).length,
    proposedCommands: semantic.proposedCommands ?? [],
    rejected: [],
    ...extra,
  };
}

function summarize(commands) {
  return (commands ?? []).filter(isAction).map((command) => ({ id: command.id, type: command.type, params: command.params, sourceText: command.sourceText }));
}

function finalSummary(commands, resolutions) {
  const byId = new Map(resolutions.map((item) => [item.commandId, item]));
  return (commands ?? []).filter(isAction).map((command) => ({
    id: command.id, type: command.type, params: command.params, resolution: byId.get(command.id)?.resolution ?? null, origins: byId.get(command.id)?.origins ?? [],
  }));
}

function isAction(command) { return !BOOKKEEPING.has(command.type); }

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("semantic_timeout")), ms);
  });
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}
