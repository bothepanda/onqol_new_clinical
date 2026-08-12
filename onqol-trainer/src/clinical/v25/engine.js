import { createUuid } from "../ids.js";
import { scrubSensitiveData, scrubSensitiveText } from "../privacy.js";
import { runClinicalSimulatorAgent } from "../simulatorAgent.js";
import { createV25Case } from "./caseFactory.js";
import { createKnowledgeBase, retrieveEvidence } from "./knowledgeBase.js";
import { buildEvidenceGroundedDebrief } from "./debrief.js";
import { scoreV25Session } from "./scoring.js";
import {
  createScenarioSeed,
  generateScenario,
  resolveActionResource,
  resolveScenarioResource,
} from "./scenarioEngine.js";
import { createEmptyReasoningState, mergeReasoningState } from "../core/reasoningState.js";
import { createInitialTemporalState, projectTemporalState } from "./temporalPatientModel.js";
import { describeEta, resolveActionEta, turnEtaMinutes } from "./resourceTiming.js";
import { planClinicalTurn } from "./turnPlanner.js";
import { buildMentorBrief, prerequisiteMeta } from "../core/mentorBrief.js";
import { runMentorAgent } from "../core/mentorAgent.js";
import { buildReasoningSnapshot, deriveV35PathState } from "../v35/runtimePath.js";

export const V25_ENGINE_VERSION = "2.5.2";
export const V25_TERMINAL_STATUSES = Object.freeze([
  "in_progress",
  "completed",
  "abandoned",
  "incomplete",
  "expired",
  "unsafe_terminated",
]);

function uniquePush(list, value) {
  return list.includes(value) ? list : [...list, value];
}

function actionKind(caseData, actionId) {
  if (caseData.expected_actions.some((action) => action.id === actionId)) return "expected";
  if (caseData.acceptable_alternatives.some((action) => action.id === actionId)) return "alternative";
  if (caseData.unnecessary_actions.some((action) => action.id === actionId)) return "unnecessary";
  if (caseData.unsafe_actions.some((action) => action.id === actionId)) return "unsafe";
  return "unknown";
}

function allowedActions(caseData) {
  return [
    ...caseData.expected_actions,
    ...caseData.acceptable_alternatives,
    ...caseData.unnecessary_actions,
    ...caseData.unsafe_actions,
  ];
}

function getAction(caseData, actionId) {
  return allowedActions(caseData).find((action) => action.id === actionId);
}

function findingText(finding) {
  return finding ? `**${finding.title}:** ${finding.text}` : "";
}

/**
 * Answers for concepts that were understood but are not actions.
 *
 * Before the typed registry every one of these produced the same non-answer,
 * because an empty mapping could not tell them apart. In the first live run
 * "пальцевое ректальное исследование" was recognised, mapped to nothing, and
 * disappeared without a word. Each kind now gets the answer it deserves, and
 * "this is not modelled here" is an answer.
 *
 * None of these performs anything, moves the clock or touches the score.
 */
function nonActionReplies(caseData, session, entries) {
  const replies = [];
  for (const entry of entries || []) {
    if (entry.kind === "reasoning_only") continue; // recorded, not answered
    if (entry.kind === "unsupported" || entry.kind === "action_not_modelled") {
      if (entry.reason_ru) replies.push(entry.reason_ru);
      continue;
    }
    if (entry.kind === "needs_specification") {
      if (entry.question_ru) replies.push(entry.question_ru);
      continue;
    }
    if (entry.kind === "resource_query") {
      // Asking what the hospital has is not ordering it: the learner is told
      // whether it is available and when the result would come, and the clock
      // does not move. Deciding with the waiting time in view is the whole point.
      const lines = ["abdominal_ultrasound", "ct_abdomen"].map((actionId) => {
        const eta = resolveActionEta(
          session.scenario,
          actionId,
          "",
          session.temporalState?.clockMinutes || 0
        );
        const label = actionId === "ct_abdomen" ? "КТ" : "УЗИ";
        return `${label}: ${describeEta(eta)}`;
      });
      replies.push(`**Доступность ресурса:** ${lines.join(" ")}`);
      continue;
    }
    if (entry.kind === "finding_slot") {
      const bundle = caseData.available_findings?.[entry.finding_bundle];
      const text = bundle?.slot_text?.[entry.slot_id];
      // A narrow question reads one slot. It never hands over the whole bundle:
      // asking whether Rovsing is positive is not the same as examining the
      // abdomen, and answering with the full examination gives away work the
      // learner did not do.
      if (text) replies.push(`**${bundle.title}:** ${text}`);
      else if (bundle) {
        replies.push(
          `**${bundle.title}:** этот признак у пациента не описан.`
        );
      }
    }
  }
  return replies;
}

function createWorkingMemory() {
  return {
    turnNumber: 0,
    workingDiagnosis: null,
    differentials: [],
    actionStates: {},
    pendingOperationalization: [],
    revealedConstraints: [],
    unresolvedFragments: [],
    lastLearnerMove: null,
    // Mentor heuristics already used this session; each speaks once.
    firedHeuristicIds: [],
    // What the learner has articulated, cumulative. Claims, not facts: nothing
    // in here may move the score. See core/reasoningState.js.
    reasoningState: createEmptyReasoningState(),
    reasoningSnapshotIds: [],
  };
}

function event(session, eventType, payload = {}) {
  return {
    event_id: createUuid(),
    session_id: session.session_id,
    institution_id: session.institution_id,
    cohort_id: session.cohort_id,
    learner_id: session.learner_id,
    case_id: session.case_id,
    case_version: session.case_version,
    rubric_version: session.scoring_rubric_version,
    scenario_seed: session.scenario.seed,
    sequence: (session.eventLog || []).length + 1,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    ...payload,
  };
}

function abandonedMessage(locale) {
  return locale === "kk"
    ? "Сессия алғашқы клиникалық қадамға дейін аяқталды. Бағалау және қалыптастырушы талдау жасалмады."
    : "Сессия завершена до первого клинического хода. Оценка и формирующий разбор не создавались.";
}

function updateActionState(memory, operation, status, turnNumber, extra = {}) {
  const previous = memory.actionStates[operation.action_id];
  const actionStates = {
    ...memory.actionStates,
    [operation.action_id]: {
      action_id: operation.action_id,
      status,
      previous_status: previous?.status || null,
      updated_turn: turnNumber,
      technique: operation.technique || previous?.technique || null,
      ...extra,
    },
  };
  let pending = memory.pendingOperationalization.filter((id) => id !== operation.action_id);
  if (status === "blocked" || (status === "proposed" && operation.intent_type === "management")) {
    pending = uniquePush(pending, operation.action_id);
  }
  return { ...memory, actionStates, pendingOperationalization: pending };
}

/**
 * Blocking prerequisites stop the action, the way an unavailable resource does.
 *
 * Without this the mentor could only comment after the fact - "стоп, нужно
 * согласие" printed underneath the operative finding. A stop that arrives after
 * the appendix is out is not a stop.
 *
 * Only "blocking" severity halts. Advisory prerequisites stay advisory.
 */
function prerequisiteBlocks(caseData, plan, actionId) {
  return (plan.prerequisiteWarnings || [])
    .filter((warning) => warning.action_id === actionId)
    .map((warning) => ({
      ...prerequisiteMeta(caseData, actionId, warning.missing),
      missing: warning.missing,
    }))
    .filter((meta) => meta.severity === "blocking");
}

function resourceChecks(session, operation, input) {
  const clockMinutes = session.temporalState?.clockMinutes || 0;
  const checks = [
    resolveActionResource(session.scenario, operation.action_id, input, clockMinutes),
  ];
  if (operation.action_id === "open_appendectomy_here" && operation.commitment !== "proposed") {
    checks.push(resolveScenarioResource(session.scenario, "anesthesia", clockMinutes));
    checks.push(resolveScenarioResource(session.scenario, "operatingRoom", clockMinutes));
  }
  return checks.filter((check) => check.resource && !check.available);
}

function pathwayBlock(session, operation) {
  if (operation.action_id === "postoperative_reassessment" && !session.temporalState.sourceControl) {
    return {
      reasonId: "postoperative_reassessment_before_source_control",
      text: "Послеоперационная переоценка доступна после завершённого контроля источника.",
    };
  }
  if (
    operation.action_id === "structured_handover"
    && session.temporalState.sourceControl
    && !session.completedActions.includes("who_sign_out")
  ) {
    return {
      reasonId: "sign_out_before_leaving_theatre",
      missing: ["who_sign_out"],
      text: "Перед выходом пациента из операционной нужно отдельно зафиксировать Sign Out.",
    };
  }
  if (operation.action_id !== "discharge_and_followup") return null;

  const missing = [];
  if (!session.temporalState.sourceControl) missing.push("source_control");
  if (!session.completedActions.includes("structured_handover")) {
    missing.push("postoperative_destination");
  }
  if (!session.completedActions.includes("postoperative_reassessment")) {
    missing.push("postoperative_reassessment");
  }
  if (!missing.length) return null;
  return {
    reasonId: "discharge_before_safe_endpoint",
    missing,
    text:
      "Выписка пока не может быть завершена: нужно зафиксировать контроль источника, место послеоперационного наблюдения и послеоперационную переоценку.",
  };
}

function runtimePathState(session, performedActionIds = []) {
  if (session.product_version === "3.5") {
    return deriveV35PathState(session, performedActionIds);
  }
  const completed = new Set(session.completedActions || []);
  if (completed.has("discharge_and_followup")) return "discharge";
  if (session.temporalState?.sourceControl) {
    if (completed.has("postoperative_reassessment")) return "ward_care";
    if (completed.has("structured_handover")) return "postop_destination";
    return "operation";
  }
  if (session.phase === "decision") return "decision";
  if (session.phase === "diagnostic_workup") return "data_gathering";
  return session.pathState || "ems_handoff";
}

function neutralStateLine(previousTemporalState, temporalState) {
  const clinicallyMeaningful =
    temporalState.lastDeltaMinutes >= 30 ||
    previousTemporalState.status !== temporalState.status ||
    previousTemporalState.sourceControl !== temporalState.sourceControl;
  if (!clinicallyMeaningful) return "";
  return `**Динамика:** прошло ${temporalState.lastDeltaMinutes} мин. ЧСС ${temporalState.heartRate}/мин, T ${temporalState.temperatureC.toFixed(
    1
  )} °C, боль ${temporalState.painScore}/10.`;
}

/**
 * The last question the trainer actually asked.
 *
 * Used to repair a turn where the learner did not understand it. Deterministic
 * and literal: it restates the question rather than rephrasing it, because
 * rephrasing is the mentor's job and the mentor may be switched off.
 */
function lastQuestionAsked(session) {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message.role !== "assistant") continue;
    const questions = String(message.content).match(/[^.!?\n]*\?/g);
    if (questions && questions.length) return questions[questions.length - 1].trim();
  }
  return null;
}

function closingPrompt(session, plan, blockedOperations) {
  if (blockedOperations.length) return "Как меняешь план с учётом этого ограничения?";
  if (session.pathState === "operation") {
    return "Контроль источника завершён. Где и с каким мониторингом пациент продолжит наблюдение?";
  }
  if (session.pathState === "postop_destination") {
    return "Место наблюдения выбрано. Как проведёшь структурированную послеоперационную переоценку?";
  }
  if (session.pathState === "ward_care") {
    return "Послеоперационная переоценка зафиксирована. Каков план выписки, наблюдения и критерии возврата?";
  }
  if (session.pathState === "discharge") {
    return "Стабильный путь доведён до безопасного endpoint. Можно завершить кейс для формирующего разбора.";
  }
  if (session.temporalState.status === "controlled") return "Контроль источника выполнен. Что нужно сделать дальше?";
  if (session.temporalState.status === "controlled_with_antibiotic_gap") {
    return "Операция завершена. Что ещё должно быть зафиксировано?";
  }
  return plan.plannerPrompt;
}

function applyPlan(caseData, session, plan, options = {}) {
  let nextSession = session;
  const previousPathState = session.pathState || "ems_handoff";
  const turnNumber = session.workingMemory.turnNumber + 1;

  // Reasoning State merges before anything else this turn, so a mentor brief
  // built afterwards sees what the learner articulated in this very message.
  // It is deliberately kept out of scoringEvents: these are learner claims, not
  // validated facts, and nothing here may move a point.
  const reasoningDelta = plan.parsed.reasoning || null;
  const { state: reasoningState, changed: reasoningChanged } = mergeReasoningState(
    session.workingMemory.reasoningState,
    reasoningDelta,
    turnNumber
  );

  let memory = {
    ...session.workingMemory,
    turnNumber,
    lastLearnerMove: plan.learnerMove,
    unresolvedFragments: plan.parsed.unresolvedFragments || [],
    reasoningState,
  };
  const replies = [];
  const scoringEvents = [];
  const actionLogEntries = [];
  const performedIds = [];
  const findingsRevealed = [];
  const revealedResources = [];
  const blockedOperations = [];

  for (const operation of plan.operations) {
    const action = getAction(caseData, operation.action_id);
    if (!action) continue;
    const kind = actionKind(caseData, operation.action_id);
    const beforeStatus = memory.actionStates[operation.action_id]?.status || null;

    if (operation.commitment === "proposed" && !operation.countsAsDecision) {
      memory = updateActionState(memory, operation, "proposed", memory.turnNumber);
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "proposed",
        applied_to_patient: false,
        confidence: operation.confidence,
      });
      continue;
    }

    const blockedByPath = pathwayBlock(nextSession, operation);
    if (blockedByPath) {
      blockedOperations.push(operation);
      replies.push(`**Граница пути:** ${blockedByPath.text}`);
      memory = updateActionState(memory, operation, "blocked", memory.turnNumber, {
        blocked_by: [blockedByPath.reasonId],
      });
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "blocked",
        applied_to_patient: false,
        pathway_block: blockedByPath.reasonId,
        missing_path_requirements: blockedByPath.missing || [],
        confidence: operation.confidence,
      });
      continue;
    }

    const missingBlocking = options.enforceBlockingPrerequisites
      ? prerequisiteBlocks(caseData, plan, operation.action_id)
      : [];
    if (missingBlocking.length) {
      blockedOperations.push(operation);
      memory = updateActionState(memory, operation, "blocked", memory.turnNumber, {
        blocked_by: missingBlocking.map((meta) => meta.reason_id),
      });
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "blocked",
        applied_to_patient: false,
        prerequisite_blocks: missingBlocking.map((meta) => meta.reason_id),
        confidence: operation.confidence,
      });
      continue;
    }

    const blockedBy = resourceChecks(nextSession, operation, plan.input);
    if (blockedBy.length) {
      blockedOperations.push(operation);
      for (const block of blockedBy) {
        if (!revealedResources.includes(block.resource)) revealedResources.push(block.resource);
        if (block.revealText) replies.push(`**Доступность ресурса:** ${block.revealText}`);
      }
      memory = updateActionState(memory, operation, "blocked", memory.turnNumber, {
        blocked_by: blockedBy.map((block) => block.reasonId),
      });
      const queueUpdates = Object.fromEntries(
        blockedBy
          .filter((block) => block.status === "delayed")
          .map((block) => [
            block.resource,
            {
              resource: block.resource,
              status: "pending",
              requested_at: nextSession.temporalState.clockMinutes,
              ready_at: block.readyAt,
              reason_id: block.reasonId,
            },
          ])
      );
      if (Object.keys(queueUpdates).length) {
        nextSession = {
          ...nextSession,
          resourceQueue: { ...(nextSession.resourceQueue || {}), ...queueUpdates },
        };
      }
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "blocked",
        applied_to_patient: false,
        resource_blocks: blockedBy.map((block) => block.reasonId),
        resource_ready_at: blockedBy.map((block) => block.readyAt ?? null),
        confidence: operation.confidence,
      });
      continue;
    }

    const afterStatus = ["request_history", "request_examination", "request_test"].includes(
      operation.intent_type
    )
      ? "resulted"
      : operation.intent_type === "diagnosis"
        ? "proposed"
        : "performed";
    memory = updateActionState(memory, operation, afterStatus, memory.turnNumber);
    if (operation.action_id === "diagnosis_acute_appendicitis") {
      memory = {
        ...memory,
        workingDiagnosis: {
          action_id: operation.action_id,
          status: "working",
          updated_turn: memory.turnNumber,
        },
      };
    }
    if (operation.action_id.startsWith("differential_")) {
      memory = { ...memory, differentials: uniquePush(memory.differentials, operation.action_id) };
    }

    nextSession = {
      ...nextSession,
      completedActions: uniquePush(nextSession.completedActions, operation.action_id),
    };
    const resolvedResource = resolveActionResource(
      nextSession.scenario,
      operation.action_id,
      plan.input,
      nextSession.temporalState.clockMinutes
    );
    if (resolvedResource.resource && nextSession.resourceQueue?.[resolvedResource.resource]) {
      nextSession = {
        ...nextSession,
        resourceQueue: {
          ...nextSession.resourceQueue,
          [resolvedResource.resource]: {
            ...nextSession.resourceQueue[resolvedResource.resource],
            status: "consumed",
            consumed_at: nextSession.temporalState.clockMinutes,
            consumed_by_action: operation.action_id,
          },
        },
      };
    }
    if (kind === "unsafe") {
      nextSession = {
        ...nextSession,
        unsafeActions: uniquePush(nextSession.unsafeActions, operation.action_id),
      };
    }
    if (kind === "unnecessary") {
      nextSession = {
        ...nextSession,
        unnecessaryActions: uniquePush(nextSession.unnecessaryActions, operation.action_id),
      };
    }

    performedIds.push(operation.action_id);
    if (operation.finding) {
      nextSession = {
        ...nextSession,
        revealedFindings: uniquePush(nextSession.revealedFindings, operation.finding.id),
      };
      findingsRevealed.push(operation.finding.id);
      replies.push(findingText(operation.finding));
    }
    scoringEvents.push({
      action_id: operation.action_id,
      action_kind: kind,
      lifecycle: afterStatus,
      eligible_for_scoring: action.eligible_for_scoring !== false,
      critical: Boolean(action.critical),
      score_weight: action.score_weight || 0,
      penalty: action.penalty || 0,
    });
    actionLogEntries.push({
      turn: memory.turnNumber,
      action_id: operation.action_id,
      intent_type: operation.intent_type,
      lifecycle_before: beforeStatus,
      lifecycle_after: afterStatus,
      technique: operation.technique,
      applied_to_patient: true,
      minute_before: nextSession.temporalState.clockMinutes,
      confidence: operation.confidence,
    });
  }

  const previousTemporalState = nextSession.temporalState;
  // The clock cost comes from the resource resolver, not from a flat table: an
  // ultrasound in a hospital that has one round the clock costs its turnaround,
  // not somebody else's night shift. Parallel orders cost the longest of them.
  const temporalState = projectTemporalState(caseData, previousTemporalState, performedIds, {
    elapsedMinutes: turnEtaMinutes(
      nextSession.scenario,
      performedIds,
      plan.input,
      previousTemporalState.clockMinutes
    ),
  });
  const pathState = runtimePathState({
    ...nextSession,
    temporalState,
    phase: temporalState.phase,
    workingMemory: memory,
  }, performedIds);
  const reasoningSnapshot = caseData.product_version === "3.5"
    ? buildReasoningSnapshot(pathState, reasoningState, memory.turnNumber)
    : null;
  const newReasoningSnapshot =
    reasoningSnapshot
    && !(memory.reasoningSnapshotIds || []).includes(reasoningSnapshot.snapshot_id)
      ? reasoningSnapshot
      : null;
  if (newReasoningSnapshot) {
    memory = {
      ...memory,
      reasoningSnapshotIds: [
        ...(memory.reasoningSnapshotIds || []),
        newReasoningSnapshot.snapshot_id,
      ],
    };
  }
  nextSession = {
    ...nextSession,
    temporalState,
    phase: temporalState.phase,
    pathState,
    workingMemory: {
      ...memory,
      revealedConstraints: [
        ...new Set([...memory.revealedConstraints, ...revealedResources]),
      ],
    },
    actionLog: [...nextSession.actionLog, ...actionLogEntries],
    prerequisiteWarnings: [
      ...nextSession.prerequisiteWarnings,
      ...plan.prerequisiteWarnings.filter((warning) => performedIds.includes(warning.action_id)),
    ],
  };

  if (temporalState.sourceControl && !nextSession.revealedFindings.includes("operative_finding")) {
    const finding = caseData.hidden_findings.operative_finding;
    if (finding) {
      nextSession = {
        ...nextSession,
        revealedFindings: uniquePush(nextSession.revealedFindings, "operative_finding"),
      };
      findingsRevealed.push("operative_finding");
      replies.push(findingText({ id: "operative_finding", ...finding }));
    }
  }

  // Understood-but-not-an-action concepts answer separately, NOT through the
  // patient simulator. "ТРУЗИ не смоделировано в этом сценарии" is a statement
  // about the model of the case, and a patient cannot say it. Voiced by the
  // simulator it came out as the generic "эти данные не заданы", which is the
  // non-answer this whole change exists to remove.
  const nonActionLines = nonActionReplies(caseData, nextSession, plan.parsed?.unresolvedByKind);

  const stateLine = neutralStateLine(previousTemporalState, temporalState);
  // A turn that asked for the question to be repeated gets the question back,
  // not a new one and not a state line about a patient who did not change.
  const repaired = plan.mode === "conversational_turn" ? lastQuestionAsked(session) : null;
  const neutralPrompt = repaired
    ? `Повторю вопрос. ${repaired}`
    : [stateLine, closingPrompt(nextSession, plan, blockedOperations)].filter(Boolean).join("\n\n");
  const reply = [...new Set(replies), ...nonActionLines, neutralPrompt]
    .filter(Boolean)
    .join("\n\n");

  const turnEvent = event(nextSession, "clinical_turn", {
    turn_number: memory.turnNumber,
    raw_text_redacted: scrubSensitiveText(plan.input),
    parsed_actions: plan.actions.map((action) => ({
      action_id: action.id,
      intent_type: action.intent_type,
      confidence: action.confidence,
    })),
    action_changes: actionLogEntries,
    findings_revealed: findingsRevealed,
    resources_revealed: revealedResources,
    elapsed_minutes: temporalState.clockMinutes - previousTemporalState.clockMinutes,
    // Two different clocks, reported separately. Workflow time is how long the
    // department took; disease time is how long the illness has been running.
    // Conflating them is how a six-hour queue became a sicker patient.
    workflow_time_minutes: temporalState.clockMinutes,
    disease_time_minutes: temporalState.timeFromOnsetMinutes,
    // Why the clock moved, per action, so a reviewer can tell a slow hospital
    // from a slow learner.
    time_cost_breakdown: performedIds.map((actionId) => {
      const eta = resolveActionEta(
        nextSession.scenario,
        actionId,
        plan.input,
        previousTemporalState.clockMinutes
      );
      return {
        action_id: actionId,
        baseline_turnaround_minutes: eta.baseline_turnaround_minutes,
        queue_delay_minutes: eta.queue_delay_minutes,
        total_eta_minutes: eta.total_eta_minutes,
        delay_source: eta.delay_source,
        resource_ready_at: eta.ready_at ?? null,
        result_ready_at: eta.result_ready_at ?? null,
      };
    }),
    resource_queue_after: nextSession.resourceQueue || {},
    path_state_before: previousPathState,
    path_state_after: pathState,
    // What kind of turn this was, and what the engine declined to run again.
    // Without these two fields a reviewer reading the log cannot tell a repeated
    // order from a repeated sentence.
    turn_kind: plan.turnKind?.kind || "unknown",
    duplicate_suppressed: plan.suppressedOperations || [],
    // Where the routing came from, and under which contract. A session routed by
    // the local dictionary matcher and a session routed by the model are not the
    // same experiment, and the log has to say which one it was.
    router_source: plan.parsed?.source || "unknown",
    router_schema_version: plan.parsed?.routerSchemaVersion || null,
    // What the learner specified, in their own words. Transcription only:
    // `eligible_for_scoring` is false on every entry.
    action_parameters: plan.parsed?.actionParameters || [],
    // Research/mentor metadata, kept out of parsed_actions and out of scoring on
    // purpose: these are learner claims awaiting separate validation. Raw text
    // stays scrubbed above; nothing here carries free text.
    reasoning_delta: reasoningChanged ? scrubSensitiveData(reasoningDelta) : null,
    reasoning_state_after: scrubSensitiveData(reasoningState),
  });

  return {
    session: {
      ...nextSession,
      eventLog: [
        ...nextSession.eventLog,
        turnEvent,
        ...(newReasoningSnapshot
          ? [
              event(
                { ...nextSession, eventLog: [...nextSession.eventLog, turnEvent] },
                "reasoning_snapshot",
                newReasoningSnapshot
              ),
            ]
          : []),
      ],
    },
    reply,
    neutralPrompt,
    nonActionLines,
    findingsRevealed,
    scoringEvents,
    blockedOperations,
  };
}

export function createV25Session(options = {}) {
  const caseData = options.caseData || createV25Case();
  const scenario =
    options.scenario ||
    generateScenario({
      mode: options.mode || "real",
      seed: options.seed || createScenarioSeed(),
      resourceProfileId: caseData.v35_composition?.effective_resource_profile_id || null,
    });
  const session = {
    session_id: options.sessionId || createUuid(),
    // From the case, not hardcoded. A V3 session used to freeze "2.5" into every
    // logged event while running a 3.0 case, which quietly contaminates any
    // analysis that groups by product version.
    product_version: caseData.product_version || "2.5",
    engine_version: V25_ENGINE_VERSION,
    // Frozen version snapshot, addendum 13. Everything needed to rebuild this
    // exact case from the log alone: content version, preset, phenotype,
    // morphology, trajectory, resource profile and both seeds. Absent for the
    // fixed V2.5/V3 card, which has no composition.
    v35_composition: caseData.v35_composition || null,
    content_version: caseData.v35_composition?.content_version || null,
    case_id: caseData.case_id,
    case_version: caseData.case_version,
    disease_card_id: caseData.disease_card_id,
    disease_card_version: caseData.disease_card_version,
    scoring_rubric_version: caseData.scoring_rubric_version,
    router_version: caseData.router_version,
    title: caseData.title,
    locale: options.locale === "kk" ? "kk" : "ru",
    institution_id: options.institutionId || "synthetic-pilot",
    cohort_id: options.cohortId || null,
    learner_id: options.learnerId || `anon:${createUuid()}`,
    scenario,
    phase: "presentation",
    pathState: "ems_handoff",
    completedActions: [],
    unsafeActions: [],
    unnecessaryActions: [],
    revealedFindings: [],
    prerequisiteWarnings: [],
    turnPlans: [],
    workingMemory: createWorkingMemory(),
    actionLog: [],
    resourceQueue: {},
    eventLog: [],
    temporalState: createInitialTemporalState(caseData),
    messages: [{ role: "assistant", content: caseData.initial_presentation.text }],
    finished: false,
    terminal_status: "in_progress",
    completion_status: "in_progress",
    started_at: options.startedAt || new Date().toISOString(),
    completed_at: null,
  };
  session.eventLog.push(
    event(session, "session_started", {
      engine_version: session.engine_version,
      product_version: session.product_version,
      content_version: session.content_version,
      mode: scenario.mode,
      facility_template_id: scenario.facility.id,
      declared_resource_profile_id: scenario.declaredResourceProfileId || null,
      effective_resource_profile_id: scenario.effectiveResourceProfileId || scenario.facility.id,
      resource_profile_version: scenario.resourceProfileVersion || null,
      shift_constraint_count: scenario.constraints.length,
      case_preset_id: session.v35_composition?.case_preset_id || null,
      selection_method: session.v35_composition?.selection_method || null,
      requested_seed: session.v35_composition?.requested_seed || scenario.seed,
      effective_seed: session.v35_composition?.effective_seed || scenario.seed,
      selection_attempts: session.v35_composition?.selection_attempts || [],
    })
  );
  return session;
}

export async function advanceV25Session({
  caseData = createV25Case(),
  session,
  input,
  knowledgeBase,
  options = {},
}) {
  if (!session || session.finished) return { session, plan: null, reply: "" };
  const plan = await planClinicalTurn({ input, caseData, session, options });
  let nextSession = {
    ...session,
    messages: [...session.messages, { role: "user", content: input }],
  };

  if (plan.mode === "debrief") {
    if ((nextSession.workingMemory?.turnNumber || 0) === 0) {
      const completedAt = new Date().toISOString();
      const reply = abandonedMessage(nextSession.locale);
      nextSession = {
        ...nextSession,
        finished: true,
        terminal_status: "abandoned",
        completion_status: "abandoned",
        scoring: null,
        report: null,
        completed_at: completedAt,
        messages: [...nextSession.messages, { role: "assistant", content: reply }],
        turnPlans: [...nextSession.turnPlans, plan],
      };
      nextSession = {
        ...nextSession,
        eventLog: [
          ...nextSession.eventLog,
          event(nextSession, "session_abandoned", {
            reason: "ended_before_first_clinical_turn",
            clinical_turn_count: 0,
            overall_score: null,
            domain_scores: null,
          }),
        ],
      };
      return {
        session: nextSession,
        plan,
        parsed: plan.parsed,
        reply,
        findingsRevealed: [],
        scoringEvents: [],
      };
    }

    const scoring = scoreV25Session(caseData, nextSession);
    const scoringEnabled = scoring.eligibleForScoring !== false;
    const stableEndpointRequired = nextSession.product_version === "3.5";
    const stableEndpointReached = nextSession.pathState === "discharge";
    const terminalStatus =
      stableEndpointRequired && !stableEndpointReached ? "incomplete" : "completed";
    const report = buildEvidenceGroundedDebrief({
      caseData,
      session: nextSession,
      scoring,
      knowledgeBase: knowledgeBase || createKnowledgeBase(),
    });
    const completedAt = new Date().toISOString();
    nextSession = {
      ...nextSession,
      finished: true,
      terminal_status: terminalStatus,
      completion_status: terminalStatus,
      pathState:
        stableEndpointRequired && terminalStatus === "completed"
          ? "complete"
          : nextSession.pathState,
      scoring,
      report,
      completed_at: completedAt,
      messages: [...nextSession.messages, { role: "assistant", content: report.markdown }],
      turnPlans: [...nextSession.turnPlans, plan],
    };
    nextSession = {
      ...nextSession,
      eventLog: [
        ...nextSession.eventLog,
        event(
          nextSession,
          scoringEnabled
            ? "session_scored"
            : terminalStatus === "completed"
              ? "session_formative_completed"
              : "session_formative_incomplete",
          scoringEnabled
            ? {
                overall_score: scoring.overallScore,
                domain_scores: scoring.domainScores,
                critical_errors: scoring.criticalErrors,
              }
            : {
                scoring_status: "disabled",
                overall_score: null,
                domain_scores: null,
                formative_domains: scoring.formativeDomains,
                pathway_status: terminalStatus,
                path_state: nextSession.pathState,
              }
        ),
      ],
    };
    return {
      session: nextSession,
      plan,
      parsed: plan.parsed,
      reply: report.markdown,
      findingsRevealed: [],
      scoringEvents: scoringEnabled
        ? [{ type: "case_scored", overall_score: scoring.overallScore }]
        : [
            {
              type:
                terminalStatus === "completed"
                  ? "formative_feedback_generated"
                  : "formative_feedback_incomplete",
              overall_score: null,
            },
          ],
    };
  }

  // V3 semantics: when the mentor is on, a blocking prerequisite stops the
  // action instead of merely docking points afterwards. Explicitly overridable.
  const enforceBlockingPrerequisites =
    options.enforceBlockingPrerequisites ?? Boolean(options.mentor);
  const deterministicUpdate = applyPlan(caseData, nextSession, plan, {
    ...options,
    enforceBlockingPrerequisites,
  });
  let simulator = null;
  let reply = deterministicUpdate.reply;
  let additionalFindingIds = [];
  const activeKnowledgeBase = knowledgeBase || createKnowledgeBase();

  // The patient says nothing when the learner is talking to the trainer about
  // the conversation. Left unguarded, the simulator answered "не понимаю
  // вопроса" by reciting the handoff again.
  // Nothing happened to the patient this turn, and the engine has already said
  // what did happen. Left unguarded the simulator added its generic "эти данные
  // не заданы в карте пациента" underneath a specific answer, which reads as a
  // contradiction of it.
  const turnTouchedThePatient =
    plan.operations.length > 0 || !(deterministicUpdate.nonActionLines || []).length;
  if (options.simulatorLLM && plan.mode !== "conversational_turn" && turnTouchedThePatient) {
    const evidencePacket = retrieveEvidence(activeKnowledgeBase, input, { limit: 5 });
    simulator = await runClinicalSimulatorAgent(
      {
        input,
        caseData,
        diseaseCard: options.diseaseCard || "V2.5 structured appendicitis card",
        retrievalCorpus: evidencePacket,
        sessionBefore: session,
        deterministicUpdate: {
          session: deterministicUpdate.session,
          parsed: plan.parsed,
          findingsRevealed: deterministicUpdate.findingsRevealed,
          neutralPrompt: deterministicUpdate.neutralPrompt,
          reply: deterministicUpdate.reply,
        },
        locale: options.locale || session.locale,
      },
      {
        llm: options.simulatorLLM,
        provider: options.provider,
        model: options.model,
        simulatorVersion: "2.5.1",
      }
    );
    reply = simulator.reply;
    additionalFindingIds = simulator.additionalFindingIds || [];
    // Re-attached after the simulator has spoken: it is not allowed to
    // paraphrase these away, and it is not the one saying them.
    const missing = (deterministicUpdate.nonActionLines || []).filter(
      (line) => !reply.includes(line)
    );
    if (missing.length) reply = [...missing, reply].join("\n\n");
  }

  // Mentor channel. Off by default so V2.5 behaviour is unchanged; V3 turns it
  // on. The patient/environment channel above stays exactly as it was - facts
  // still come only from the Case Card. The mentor replaces the three
  // hard-coded closing prompts with a pedagogical reply built from a brief that
  // contains no patient facts at all.
  let mentor = null;
  let mentorBrief = null;
  // On a repair turn the mentor stays out of it: the learner did not understand
  // the previous question, so answering with a different question is the one
  // thing that cannot help. The deterministic repair restates it instead.
  if (options.mentor && plan.mode !== "conversational_turn") {
    const brief = buildMentorBrief({
      caseData,
      session: deterministicUpdate.session,
      plan,
      deterministicUpdate,
    });
    mentor = await runMentorAgent(
      {
        brief,
        learnerText: input,
        caseData,
        revealedFindingIds: deterministicUpdate.session.revealedFindings || [],
      },
      { llm: options.mentorLLM, locale: options.locale || session.locale }
    );
    mentorBrief = brief;

    // A silent mentor keeps its mouth shut but does not blank the screen: the
    // deterministic layer's own operational prompt stays, so the turn still ends
    // with something to answer. Only a mentor with something to say takes the
    // closing prompt's place.
    const facts = deterministicUpdate.neutralPrompt
      ? reply.split(deterministicUpdate.neutralPrompt).join("").trim()
      : reply;
    const closing = brief.silent ? deterministicUpdate.neutralPrompt : mentor.text;
    reply = [facts, closing].filter(Boolean).join("\n\n").trim();
  }

  nextSession = {
    ...deterministicUpdate.session,
    revealedFindings: [
      ...new Set([...deterministicUpdate.session.revealedFindings, ...additionalFindingIds]),
    ],
    messages: [...deterministicUpdate.session.messages, { role: "assistant", content: reply }],
    turnPlans: [...deterministicUpdate.session.turnPlans, plan],
    workingMemory: {
      ...deterministicUpdate.session.workingMemory,
      firedHeuristicIds: [
        ...(deterministicUpdate.session.workingMemory?.firedHeuristicIds || []),
        ...(mentorBrief?.firedHeuristicKeys || []),
      ],
    },
  };
  const routerExecution = plan.parsed?.source === "semantic_router" ? "model" : "local";
  const simulatorExecution = simulator
    ? simulator.provider === "deterministic_fallback" ? "fallback" : "model"
    : "not_invoked";
  const mentorExecution = mentor
    ? mentor.source === "llm" ? "model" : "fallback"
    : "not_invoked";
  const executionGroup = [routerExecution, simulatorExecution, mentorExecution].includes("model")
    ? "model_backed"
    : "local_fallback";
  nextSession = {
    ...nextSession,
    eventLog: [
      ...nextSession.eventLog,
      event(nextSession, "execution_profile", {
        turn_number: nextSession.workingMemory?.turnNumber || null,
        evaluation_group: executionGroup,
        router_execution: routerExecution,
        simulator_execution: simulatorExecution,
        mentor_execution: mentorExecution,
        provider: executionGroup === "model_backed" ? options.provider || "configured_provider" : "local",
        gateway_version: options.gatewayVersion || null,
        router_model: routerExecution === "model" ? options.routerModel || null : null,
        simulator_model: simulatorExecution === "model" ? simulator?.model || options.model || null : null,
        mentor_model: mentorExecution === "model" ? options.mentorModel || null : null,
        schema_versions: options.schemaVersions || null,
      }),
    ],
  };

  return {
    ...deterministicUpdate,
    session: nextSession,
    plan,
    parsed: plan.parsed,
    reply,
    simulator,
    mentor,
  };
}

export { createV25Case as createDefaultV25Case };
