import { createUuid } from "../ids.js";
import { scrubSensitiveText } from "../privacy.js";
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
import { planClinicalTurn } from "./turnPlanner.js";
import { buildMentorBrief, prerequisiteMeta } from "../core/mentorBrief.js";
import { runMentorAgent } from "../core/mentorAgent.js";

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
  const checks = [resolveActionResource(session.scenario, operation.action_id, input)];
  if (operation.action_id === "open_appendectomy_here" && operation.commitment !== "proposed") {
    checks.push(resolveScenarioResource(session.scenario, "anesthesia"));
    checks.push(resolveScenarioResource(session.scenario, "operatingRoom"));
  }
  return checks.filter((check) => check.resource && !check.available);
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
  if (session.temporalState.status === "controlled") return "Контроль источника выполнен. Что нужно сделать дальше?";
  if (session.temporalState.status === "controlled_with_antibiotic_gap") {
    return "Операция завершена. Что ещё должно быть зафиксировано?";
  }
  return plan.plannerPrompt;
}

function applyPlan(caseData, session, plan, options = {}) {
  let nextSession = session;
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
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "blocked",
        applied_to_patient: false,
        resource_blocks: blockedBy.map((block) => block.reasonId),
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
  const temporalState = projectTemporalState(caseData, previousTemporalState, performedIds);
  nextSession = {
    ...nextSession,
    temporalState,
    phase: temporalState.phase,
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

  const stateLine = neutralStateLine(previousTemporalState, temporalState);
  // A turn that asked for the question to be repeated gets the question back,
  // not a new one and not a state line about a patient who did not change.
  const repaired = plan.mode === "conversational_turn" ? lastQuestionAsked(session) : null;
  const neutralPrompt = repaired
    ? `Повторю вопрос. ${repaired}`
    : [stateLine, closingPrompt(nextSession, plan, blockedOperations)].filter(Boolean).join("\n\n");
  const reply = [...new Set(replies), neutralPrompt].filter(Boolean).join("\n\n");

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
    reasoning_delta: reasoningChanged ? reasoningDelta : null,
    reasoning_state_after: reasoningState,
  });

  return {
    session: { ...nextSession, eventLog: [...nextSession.eventLog, turnEvent] },
    reply,
    neutralPrompt,
    findingsRevealed,
    scoringEvents,
    blockedOperations,
  };
}

export function createV25Session(options = {}) {
  const caseData = options.caseData || createV25Case();
  const scenario =
    options.scenario ||
    generateScenario({ mode: options.mode || "real", seed: options.seed || createScenarioSeed() });
  const session = {
    session_id: options.sessionId || createUuid(),
    // From the case, not hardcoded. A V3 session used to freeze "2.5" into every
    // logged event while running a 3.0 case, which quietly contaminates any
    // analysis that groups by product version.
    product_version: caseData.product_version || "2.5",
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
    scoring_rubric_version: `${caseData.scoring_rubric_version}-v25.1`,
    router_version: caseData.router_version,
    title: caseData.title,
    locale: options.locale === "kk" ? "kk" : "ru",
    institution_id: options.institutionId || "synthetic-pilot",
    cohort_id: options.cohortId || null,
    learner_id: options.learnerId || `anon:${createUuid()}`,
    scenario,
    phase: "presentation",
    completedActions: [],
    unsafeActions: [],
    unnecessaryActions: [],
    revealedFindings: [],
    prerequisiteWarnings: [],
    turnPlans: [],
    workingMemory: createWorkingMemory(),
    actionLog: [],
    eventLog: [],
    temporalState: createInitialTemporalState(caseData),
    messages: [{ role: "assistant", content: caseData.initial_presentation.text }],
    finished: false,
    started_at: options.startedAt || new Date().toISOString(),
    completed_at: null,
  };
  session.eventLog.push(
    event(session, "session_started", {
      mode: scenario.mode,
      facility_template_id: scenario.facility.id,
      shift_constraint_count: scenario.constraints.length,
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
    const scoring = scoreV25Session(caseData, nextSession);
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
        event(nextSession, "session_scored", {
          overall_score: scoring.overallScore,
          domain_scores: scoring.domainScores,
          critical_errors: scoring.criticalErrors,
        }),
      ],
    };
    return {
      session: nextSession,
      plan,
      parsed: plan.parsed,
      reply: report.markdown,
      findingsRevealed: [],
      scoringEvents: [{ type: "case_scored", overall_score: scoring.overallScore }],
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
  if (options.simulatorLLM && plan.mode !== "conversational_turn") {
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
