import { createSessionCode, createUuid } from "../ids.js";
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
import { selectHeuristics } from "../core/mentorHeuristics.js";
import { prerequisiteSatisfied } from "../core/prerequisiteClosure.js";
import { isGovernanceGapParameter } from "../core/parameterSafety.js";
import { LEARNER_ADDRESS_FORM } from "../core/learnerAddress.js";
import { runMentorAgent } from "../core/mentorAgent.js";
import { MENTOR_MODE, MENTOR_POLICY_VERSION } from "../core/mentorPolicy.js";
import {
  operationalizationQuestion,
  orderLabel,
  orderRecord,
} from "../core/operationalization.js";
import { buildReasoningSnapshot, deriveV35PathState } from "../v35/runtimePath.js";
import {
  CLINICAL_GOVERNANCE_VERSION,
  CLINICAL_RULE_REGISTRY_VERSION,
  SOURCE_REGISTRY_VERSION,
} from "../governance/clinicalGovernance.js";

export const V25_ENGINE_VERSION = "2.5.3";
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
function nonActionReplies(caseData, session, entries, options = {}) {
  const replies = [];
  for (const entry of entries || []) {
    if (entry.kind === "reasoning_only") continue; // recorded, not answered
    if (entry.kind === "unsupported" || entry.kind === "action_not_modelled") {
      if (entry.reason_ru) replies.push(entry.reason_ru);
      continue;
    }
    if (entry.kind === "action_not_available_for_patient") {
      const fragment = entry.requested_fragment || entry.concept_id || "запрошенное действие";
      replies.push(`«${fragment}»: действие распознано, но результат не авторизован для этого варианта пациента.`);
      continue;
    }
    if (entry.kind === "unrecognized_fragment") {
      // Base rules v2: "Не распознано" is not an answer to a colleague. With the
      // mentor on, the fragment travels to it in the brief and comes back as a
      // human reply. The router stays the gate on EXECUTION - nothing
      // unrecognised is ever applied to the patient - it stops being the gate on
      // SPEECH. Without a mentor the honest deterministic line remains.
      if (entry.requested_fragment && !options.mentorAnswersUnrecognized) {
        replies.push(`Не распознано: «${entry.requested_fragment}». Уточни, что именно назначаешь.`);
      }
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
    // What the learner actually ordered, transcribed slot by slot. Held so a
    // learner who answers across two turns is never asked the same thing twice.
    // See core/operationalization.js.
    orderRecords: {},
    revealedConstraints: [],
    unresolvedFragments: [],
    lastLearnerMove: null,
    // Mentor heuristics already used this session; each speaks once.
    firedHeuristicIds: [],
    // Governance notes the engine has already said, keyed by order and wording.
    // "Записано, правила нет, к пациенту не применено" is a fact about the pilot's
    // content; repeating it every turn the learner restates the plan is what put
    // the same wall of text on turns 4 and 7 of the live run of 20.08.2026. A
    // CHANGED order is a new key and is noted again.
    governanceNotesDelivered: [],
    // What the learner has articulated, cumulative. Claims, not facts: nothing
    // in here may move the score. See core/reasoningState.js.
    reasoningState: createEmptyReasoningState(),
    reasoningSnapshotIds: [],
    // A focused mentor question is a small routing contract for the next turn,
    // not just text in the transcript.
    pendingMentorQuestion: null,
    lastMentorIntervention: null,
    mentorScaffoldingState: {
      issue_id: null,
      scaffolding_level: 0,
      expected_answer_domains: [],
    },
    deferredMentorIssues: [],
    operativeDecision: null,
    operativeApproach: null,
    operativeState: {
      appendectomy_decided: false,
      operative_approach_selected: false,
      preop_ready: false,
      procedure_started: false,
      source_control_completed: false,
    },
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

/**
 * Keep what the learner has specified so far, without judging any of it.
 *
 * Slots accumulate across turns: a learner who names the solution now and the
 * rate two turns later has named both, and the team stops asking.
 */
function capitalize(text) {
  const value = String(text || "");
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function recordOrder(memory, state, verbatim) {
  if (!state) return memory;
  const previous = memory.orderRecords?.[state.action_id];
  const record = orderRecord(state, verbatim || previous?.verbatim || null);
  return {
    ...memory,
    orderRecords: { ...(memory.orderRecords || {}), [state.action_id]: record },
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
  const clockMinutes = session.temporalState?.clockMinutes || 0;
  const operativeAction = ["appendectomy_procedure_start", "appendectomy_here"].includes(
    operation.action_id
  );
  const approach =
    operation.technique || session.workingMemory?.operativeApproach?.approach || null;
  const checks = [operativeAction && approach
    ? resolveScenarioResource(
        session.scenario,
        approach === "laparoscopic" ? "laparoscopy" : "operatingRoom",
        clockMinutes
      )
    : resolveActionResource(session.scenario, operation.action_id, input, clockMinutes)];
  if (operativeAction && operation.commitment !== "proposed") {
    checks.push(resolveScenarioResource(session.scenario, "anesthesia", clockMinutes));
    checks.push(resolveScenarioResource(session.scenario, "operatingRoom", clockMinutes));
  }
  return checks.filter((check) => check.resource && !check.available);
}

function pathwayBlock(session, operation) {
  // Transcript-wide: an action expressed on any earlier turn counts, so the
  // learner is never asked for something they have already done. See
  // core/prerequisiteClosure.js.
  const completed = {
    has: (actionId) => prerequisiteSatisfied(session, actionId),
  };
  const approach = session.workingMemory?.operativeApproach?.approach || operation.technique || null;
  if (operation.action_id === "appendectomy_procedure_start") {
    if (!approach) {
      return {
        reasonId: "operative_approach_not_selected",
        text: "До начала вмешательства отдельно выбери операционный доступ.",
      };
    }
    // What Sign In was actually protecting: a patient who is about to be
    // anaesthetised without having consented, and an anaesthetist nobody told.
    // Since CDR-18 that is checked here, on the substance, at the moment it
    // matters - before induction - instead of on whether the learner named the
    // checkpoint. Either counts from ANY earlier turn.
    const missingBeforeInduction = [
      ["informed_consent", "информированное согласие"],
      ["notify_anesthesia", "оповещение анестезиолога"],
    ].filter(([actionId]) => !completed.has(actionId));
    if (missingBeforeInduction.length) {
      return {
        reasonId: "consent_or_anaesthesia_before_induction",
        missing: missingBeforeInduction.map(([actionId]) => actionId),
        text: `До индукции не хватает: ${missingBeforeInduction
          .map(([, label]) => label)
          .join(", ")}.`,
      };
    }
  }
  if (
    operation.action_id === "appendectomy_here" &&
    !completed.has("appendectomy_procedure_start")
  ) {
    return {
      reasonId: "source_control_before_procedure_start",
      missing: ["appendectomy_procedure_start"],
      text: "Контроль источника нельзя отметить завершённым до явного начала вмешательства.",
    };
  }
  if (operation.action_id === "postoperative_reassessment" && !session.temporalState.sourceControl) {
    return {
      reasonId: "postoperative_reassessment_before_source_control",
      text: "Послеоперационная переоценка доступна после завершённого контроля источника.",
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
  const temperature = temporalState.temperatureC.toFixed(1).replace(".", ",");
  return `**Динамика:** прошло ${temporalState.lastDeltaMinutes} мин. ЧСС ${temporalState.heartRate}/мин, температура ${temperature} °C, боль ${temporalState.painScore}/10.`;
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

/**
 * "Я же сделала все это выше!"
 *
 * Answered from everything the learner has expressed in the session, not only
 * from what the engine could execute - and it answers with what IS on record,
 * not with a list of ritual words still missing. Since CDR-18 the WHO
 * checkpoints are not on that list at all.
 */
function recordedActionDisputeReply(session) {
  const preop = [
    ["informed_consent", "согласие"],
    ["notify_anesthesia", "уведомление анестезиолога"],
    ["notify_operating_team", "готовность операционной"],
    ["preop_risk_assessment", "оценка операционного риска"],
  ];
  const recorded = preop
    .filter(([id]) => prerequisiteSatisfied(session, id))
    .map(([, label]) => label);
  const missing = preop
    .filter(([id]) => !prerequisiteSatisfied(session, id))
    .map(([, label]) => label);

  if (!recorded.length) {
    return "Из подготовки к операции выше пока ничего не зафиксировано: ни согласия, ни уведомления анестезиолога, ни готовности операционной.";
  }
  const head = `Зафиксировано с твоих слов: ${recorded.join(", ")}.`;
  return missing.length ? `${head} Не зафиксировано: ${missing.join(", ")}.` : head;
}

function closingPrompt(session, plan, blockedOperations, governanceGapActionIds = new Set()) {
  // An order the team is waiting on outranks every generic closing line: the
  // learner has to be able to finish stating it. An order the pilot holds no
  // reviewed rule for is the exception: the missing slot changes nothing, the
  // order will not be applied either way, and asking for it again three turns
  // later is the same question twice - which is what turns 4 and 7 of the live
  // run of 20.08.2026 both ended on.
  const awaiting = operationalizationQuestion(
    (plan.operationalizationStates || []).filter(
      (state) => !state.complete && !governanceGapActionIds.has(state.action_id)
    )
  );
  if (awaiting) return awaiting;
  // Only a REAL block asks the learner to change the plan.
  //
  // blockedOperations mixes three different things: a resource that is not
  // available, a prerequisite that is missing, a safety rule that refused a
  // parameter - and, quite separately, an order the pilot holds no reviewed
  // rule for, or a result this case variant does not model. The last two are
  // gaps in the training content. Hard bound 6 forbids the MENTOR from calling
  // them a constraint, and until 21.08.2026 the engine's own closing line did
  // it anyway, one paragraph above the mentor.
  //
  // Live run of that day, turn 4: the resident chose laparoscopy, the access
  // was granted, her drug orders had no reviewed rule, and the engine asked
  // "как меняешь план с учётом этого ограничения". She duly downgraded to an
  // open appendectomy - and the mentor then spent turns 5 to 7 interrogating
  // her about a decision the engine had talked her into.
  const realBlocks = blockedOperations.filter(
    (operation) =>
      !governanceGapActionIds.has(operation.action_id) &&
      !operation.content_gap &&
      !(operation.parameter_safety && isGovernanceGapParameter(operation.parameter_safety))
  );
  if (realBlocks.length) return "Как меняешь план с учётом этого ограничения?";
  if (session.workingMemory?.operativeState?.procedure_started && !session.temporalState.sourceControl) {
    return "Вмешательство начато. Когда контроль источника будет завершён, зафиксируй это отдельно.";
  }
  if (
    session.workingMemory?.operativeApproach?.status === "selected" &&
    !session.workingMemory?.operativeState?.procedure_started
  ) {
    return "Доступ выбран. Какой следующий операционный шаг?";
  }
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
    return "Стабильный путь завершён. Можно завершить кейс и перейти к формирующему разбору.";
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
    pendingMentorQuestion: plan.mentorAnswer
      ? null
      : session.workingMemory.pendingMentorQuestion || null,
  };
  if ((plan.managementDecisions || []).some((decision) => decision.decision_id === "appendectomy")) {
    const diagnosisSupportsDecision =
      session.completedActions.includes("diagnosis_acute_appendicitis") ||
      reasoningState.working_diagnosis?.stated;
    memory = {
      ...memory,
      operativeDecision: {
        decision_id: "appendectomy",
        status: diagnosisSupportsDecision ? "committed" : "proposed",
        updated_turn: turnNumber,
      },
      operativeState: {
        ...memory.operativeState,
        appendectomy_decided: diagnosisSupportsDecision,
      },
    };
  }
  const replies = [];
  // Collected across the turn and said once, together. Two orders the pilot has
  // no rule for are one sentence, not one paragraph each.
  const governanceGapNotes = [];
  const scoringEvents = [];
  const actionLogEntries = [];
  const performedIds = [];
  const findingsRevealed = [];
  const revealedResources = [];
  const blockedOperations = [];
  // A conversational gate is neither a safety block nor an executed action.
  // It holds the first attempt at an authored irreversible step long enough for
  // the mentor to return one decision to the learner. The next explicit attempt
  // may proceed because the gate intervention has then been recorded as fired.
  const mentorGateOperations = [];

  const approachDecision = (plan.managementDecisions || []).find(
    (decision) => decision.decision_id === "operative_approach"
  );
  if (approachDecision?.approach) {
    const resource = approachDecision.approach === "laparoscopic" ? "laparoscopy" : "operatingRoom";
    const resolution = resolveScenarioResource(
      nextSession.scenario,
      resource,
      nextSession.temporalState?.clockMinutes || 0
    );
    if (resolution.available) {
      memory = {
        ...memory,
        operativeApproach: {
          approach: approachDecision.approach,
          status: "selected",
          updated_turn: turnNumber,
        },
        operativeState: {
          ...memory.operativeState,
          operative_approach_selected: true,
        },
      };
      // Only when it CHANGES. Restating the same access prints the same block
      // again - turns 5 and 7 of the live runs of 21.08.2026 both ended on the
      // identical line, which is the last thing the A/B harness still counted
      // as a verbatim engine repeat. The same rule already applies to orders.
      if (session.workingMemory?.operativeApproach?.approach !== approachDecision.approach) {
        replies.push(
          `**Операционный доступ:** ${
            approachDecision.approach === "laparoscopic" ? "лапароскопический" : "открытый"
          } доступ выбран; ресурс доступен.`
        );
      }
      actionLogEntries.push({
        turn: turnNumber,
        action_id: "operative_approach",
        approach: approachDecision.approach,
        action_decision: "selected",
        lifecycle_before: session.workingMemory?.operativeApproach?.status || null,
        lifecycle_after: "selected",
        applied_to_patient: false,
      });
    } else {
      memory = {
        ...memory,
        operativeApproach: {
          approach: approachDecision.approach,
          status: "blocked",
          blocked_by: resolution.reasonId,
          updated_turn: turnNumber,
        },
      };
      blockedOperations.push({
        action_id: "operative_approach",
        technique: approachDecision.approach,
        resource_block: resolution.reasonId,
      });
      if (resolution.revealText) replies.push(`**Доступность ресурса:** ${resolution.revealText}`);
      if (!revealedResources.includes(resource)) revealedResources.push(resource);
      actionLogEntries.push({
        turn: turnNumber,
        action_id: "operative_approach",
        approach: approachDecision.approach,
        action_decision: "blocked",
        lifecycle_before: session.workingMemory?.operativeApproach?.status || null,
        lifecycle_after: "blocked",
        resource_blocks: [resolution.reasonId],
        applied_to_patient: false,
      });
    }
  }

  for (const operation of plan.operations) {
    const action = getAction(caseData, operation.action_id);
    if (!action) continue;
    const kind = actionKind(caseData, operation.action_id);
    const beforeStatus = memory.actionStates[operation.action_id]?.status || null;

    if (
      ["request_history", "request_examination", "request_test"].includes(operation.intent_type) &&
      !operation.finding &&
      operation.findingStatus
    ) {
      const fragment = operation.requestedFragment || operation.action_id;
      blockedOperations.push({
        ...operation,
        content_gap: operation.findingStatus,
      });
      replies.push(
        `«${fragment}»: ${operation.unavailableReason || "результат пока не смоделирован для этого варианта кейса."}`
      );
      memory = updateActionState(memory, operation, "blocked", memory.turnNumber, {
        blocked_by: [operation.findingStatus],
      });
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        requested_fragment: fragment,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "blocked",
        action_decision: "blocked",
        applied_to_patient: false,
        content_gap: operation.findingStatus,
        confidence: operation.confidence,
      });
      continue;
    }

    // Slots are transcribed whatever happens next: an order the pilot cannot
    // apply is still an order the learner stated, and the record must show it.
    const orderState = operation.operationalization;
    if (orderState) {
      memory = recordOrder(memory, orderState, operation.requestedFragment || plan.input);
    }

    const parameterSafety = (plan.parameterSafetySignals || []).find(
      (signal) => signal.concept_id === operation.action_id
    );
    if (parameterSafety?.blocks_application) {
      blockedOperations.push({ ...operation, parameter_safety: parameterSafety });
      const verbatim =
        parameterSafety.verbatim || operation.requestedFragment || operation.action_id;
      // A complete order gets a terminal answer, not the question again. Asking
      // a learner who has already answered to answer once more is what ended
      // replay b9d7a831 after three turns on the same sentence.
      if (isGovernanceGapParameter(parameterSafety)) {
        governanceGapNotes.push({
          action_id: operation.action_id,
          key: governanceNoteKey(operation.action_id, verbatim),
          verbatim,
          complete: Boolean(orderState?.complete),
        });
      } else {
        replies.push(
          orderState?.complete
            ? blockedParameterNote(verbatim)
            : `**Проверка параметра:** «${verbatim}» требует клинической проверки: параметр не валидирован учебным контентом и не применён к пациенту.`
        );
      }
      memory = updateActionState(memory, operation, "blocked", memory.turnNumber, {
        blocked_by: [
          parameterSafety.source_rule_id ||
          parameterSafety.governance_policy_id ||
          parameterSafety.blocking_reason,
        ],
      });
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "blocked",
        applied_to_patient: false,
        action_decision: "blocked",
        recognized_drug: parameterSafety.recognized_drug ?? null,
        parameter_validation_status: parameterSafety.parameter_validation_status,
        blocking_reason: parameterSafety.blocking_reason,
        parameter_safety: parameterSafety,
        confidence: operation.confidence,
      });
      continue;
    }

    // An intention is not an order. The safety gate above runs first — a
    // dangerous number must be caught even in a half-stated order — and only a
    // parameter nobody objected to waits here for "чем и как".
    if (orderState && !orderState.complete) {
      memory = updateActionState(memory, operation, "proposed", memory.turnNumber, {
        awaiting_slots: orderState.missing,
      });
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "proposed",
        action_decision: "awaiting_operationalization",
        applied_to_patient: false,
        missing_slots: orderState.missing,
        recorded_slots: Object.keys(orderState.filled),
        requested_fragment: operation.requestedFragment,
        confidence: operation.confidence,
      });
      continue;
    }

    if (operation.commitment === "proposed" && !operation.countsAsDecision) {
      memory = updateActionState(memory, operation, "proposed", memory.turnNumber);
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "proposed",
        action_decision: "selected",
        applied_to_patient: false,
        confidence: operation.confidence,
      });
      continue;
    }

    if (operation.action_id === "appendectomy_here") {
      memory = {
        ...memory,
        operativeDecision: {
          decision_id: "appendectomy",
          status: "committed",
          updated_turn: memory.turnNumber,
        },
      };
    }

    const blockedByPath = options.enforcePathwayBlocks === false
      ? null
      : pathwayBlock(
          { ...nextSession, workingMemory: memory },
          operation
        );
    if (blockedByPath) {
      blockedOperations.push(operation);
      replies.push(`**Действие пока недоступно:** ${blockedByPath.text}`);
      memory = updateActionState(memory, operation, "blocked", memory.turnNumber, {
        blocked_by: [blockedByPath.reasonId],
      });
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "blocked",
        action_decision: "blocked",
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
        action_decision: "blocked",
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
        action_decision: "blocked",
        applied_to_patient: false,
        resource_blocks: blockedBy.map((block) => block.reasonId),
        resource_ready_at: blockedBy.map((block) => block.readyAt ?? null),
        confidence: operation.confidence,
      });
      continue;
    }

    // Standing risks must be raised before an irreversible action mutates the
    // session. Doing this in the mentor pass below is too late: at that point
    // procedure_started is already true. All real execution blocks above keep
    // their priority; this soft conversational gate is considered only when the
    // action would otherwise execute.
    const mentorGateKey = `mentor_gate:${operation.action_id}`;
    const mentorGateIssue = options.enforceMentorGates &&
      !(memory.firedHeuristicIds || []).includes(mentorGateKey)
      ? selectHeuristics({
          caseData,
          session: {
            ...nextSession,
            workingMemory: memory,
          },
          attempted: new Set([operation.action_id]),
          alreadyFired: memory.firedHeuristicIds || [],
          currentTurn: {
            previousIssueId: memory.pendingMentorQuestion?.issue_id || null,
            pathState: nextSession.pathState,
            topic: "management",
          },
          limit: 100,
        }).find((heuristic) => heuristic.standing_risk_stage === "irreversible_gate")
      : null;
    if (mentorGateIssue) {
      mentorGateOperations.push({
        ...operation,
        mentor_gate_issue_id: mentorGateIssue.id,
      });
      memory = updateActionState(memory, operation, "proposed", memory.turnNumber, {
        held_by: [`mentor_gate:${mentorGateIssue.id}`],
      });
      actionLogEntries.push({
        turn: memory.turnNumber,
        action_id: operation.action_id,
        intent_type: operation.intent_type,
        lifecycle_before: beforeStatus,
        lifecycle_after: "proposed",
        action_decision: "mentor_gate_held",
        applied_to_patient: false,
        mentor_gate_issue_id: mentorGateIssue.id,
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
    if (operation.action_id === "appendectomy_procedure_start") {
      memory = {
        ...memory,
        operativeState: {
          ...memory.operativeState,
          preop_ready: true,
          procedure_started: true,
        },
      };
    }
    if (operation.action_id === "appendectomy_here") {
      memory = {
        ...memory,
        operativeState: {
          ...memory.operativeState,
          source_control_completed: true,
        },
      };
    }
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
      action_decision: "performed",
      technique: operation.technique,
      applied_to_patient: true,
      clinical_test_bypass: parameterSafety?.clinical_test_bypass || null,
      parameter_safety: parameterSafety || null,
      minute_before: nextSession.temporalState.clockMinutes,
      confidence: operation.confidence,
    });
  }

  // «Кеторолак 30 мг в/в» names no action — it answers the question asked about
  // an action already on the table. Resolve it against that action instead of
  // treating it as unrecognised text.
  for (const state of plan.resumedOperationalization || []) {
    memory = recordOrder(memory, state, plan.input);
    const action = getAction(caseData, state.action_id);
    const beforeStatus = memory.actionStates[state.action_id]?.status || null;
    if (!state.complete || !action) {
      memory = updateActionState(
        memory,
        { action_id: state.action_id, intent_type: "management" },
        "proposed",
        memory.turnNumber,
        { awaiting_slots: state.missing }
      );
      continue;
    }

    const blockedByParameter = (plan.parameterSafetySignals || []).find(
      (signal) => signal.concept_id === state.action_id && signal.blocks_application
    );
    if (blockedByParameter) {
      if (isGovernanceGapParameter(blockedByParameter)) {
        governanceGapNotes.push({
          action_id: state.action_id,
          key: governanceNoteKey(state.action_id, plan.input),
          verbatim: plan.input,
          complete: true,
        });
      } else {
        replies.push(blockedParameterNote(plan.input));
      }
      continue;
    }

    memory = updateActionState(
      memory,
      { action_id: state.action_id, intent_type: "management" },
      "performed",
      memory.turnNumber
    );
    nextSession = {
      ...nextSession,
      completedActions: uniquePush(nextSession.completedActions, state.action_id),
    };
    performedIds.push(state.action_id);
    replies.push(
      `**${capitalize(orderLabel(state.action_id))} — выполнено:** ${Object.values(state.filled).join(", ")}.`
    );
    scoringEvents.push({
      action_id: state.action_id,
      action_kind: actionKind(caseData, state.action_id),
      lifecycle: "performed",
      eligible_for_scoring: action.eligible_for_scoring !== false,
      critical: Boolean(action.critical),
      score_weight: action.score_weight || 0,
      penalty: action.penalty || 0,
    });
    actionLogEntries.push({
      turn: memory.turnNumber,
      action_id: state.action_id,
      intent_type: "management",
      lifecycle_before: beforeStatus,
      lifecycle_after: "performed",
      action_decision: "performed_after_operationalization",
      applied_to_patient: true,
      recorded_slots: Object.keys(state.filled),
      requested_fragment: plan.input,
      minute_before: nextSession.temporalState.clockMinutes,
      confidence: 1,
    });
  }

  // Said once, and said together. Every order the pilot has no reviewed rule for
  // shares one explanation; an order already noted is not noted again, because
  // nothing about it changed and the learner has already read why.
  const deliveredGovernanceKeys = new Set(memory.governanceNotesDelivered || []);
  const freshGovernanceNotes = [];
  for (const note of governanceGapNotes) {
    if (deliveredGovernanceKeys.has(note.key)) continue;
    deliveredGovernanceKeys.add(note.key);
    freshGovernanceNotes.push(note);
  }
  if (freshGovernanceNotes.length) {
    replies.push(orderRecordedNote(freshGovernanceNotes));
    memory = { ...memory, governanceNotesDelivered: [...deliveredGovernanceKeys] };
  }
  // Every order blocked this turn for want of a rule, noted now or noted earlier.
  const governanceGapActionIds = new Set(
    governanceGapNotes.map((note) => note.action_id).filter(Boolean)
  );

  // "я же написала!" is a repair move. Replay what is on record instead of
  // answering it with "не распознано".
  if (plan.repairMove && !(plan.operations || []).length) {
    const recorded = Object.values(memory.orderRecords || {}).filter(
      (record) => Object.keys(record.slots || {}).length
    );
    if (recorded.length) {
      replies.push(
        `**Записано с твоих слов:** ${recorded
          .map((record) => `${orderLabel(record.action_id)} — ${Object.values(record.slots).join(", ")}`)
          .join("; ")}.`
      );
    }
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
  const loggedActionEntries = actionLogEntries.map((entry) => {
    const operation = plan.operations.find((candidate) => candidate.action_id === entry.action_id);
    return {
      ...entry,
      requested_fragment: entry.requested_fragment || operation?.requestedFragment || null,
      action_decision:
        entry.action_decision ||
        (entry.lifecycle_after === "blocked"
          ? "blocked"
          : entry.lifecycle_after === "proposed"
            ? "selected"
            : "performed"),
    };
  });
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
    actionLog: [...nextSession.actionLog, ...loggedActionEntries],
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
  const addressedFragments = new Set(
    (plan.parsed?.unresolvedByKind || [])
      .map((entry) => entry.requested_fragment)
      .filter(Boolean)
  );
  const unresolvedFragmentEntries = (plan.parsed?.unresolvedFragments || [])
    .filter((fragment) => !addressedFragments.has(fragment))
    .map((fragment) => ({
      kind: "unrecognized_fragment",
      requested_fragment: fragment,
      reason_code: "router_unresolved_fragment",
    }));
  const nonActionLines = nonActionReplies(
    caseData,
    nextSession,
    [...(plan.parsed?.unresolvedByKind || []), ...unresolvedFragmentEntries],
    { mentorAnswersUnrecognized: Boolean(options.mentor) }
  );

  const stateLine = neutralStateLine(previousTemporalState, temporalState);
  // A turn that asked for the question to be repeated gets the question back,
  // not a new one and not a state line about a patient who did not change.
  const repaired = plan.mode === "conversational_turn"
    ? plan.responseAct === "explain_recorded_and_missing_actions"
      ? recordedActionDisputeReply(session)
      : lastQuestionAsked(session)
    : null;
  const neutralPrompt = repaired
    ? plan.responseAct === "explain_recorded_and_missing_actions"
      ? repaired
      : `Повторю вопрос. ${repaired}`
    : [
        stateLine,
        closingPrompt(nextSession, plan, blockedOperations, governanceGapActionIds),
      ]
        .filter(Boolean)
        .join("\n\n");
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
      requested_fragment: action.requested_fragment || null,
    })),
    router_intents_before_mapping: plan.parsed?.intents || [],
    unresolved_by_kind: plan.parsed?.unresolvedByKind || [],
    unresolved_fragments: plan.parsed?.unresolvedFragments || [],
    recognized_but_undefined: plan.parsed?.recognizedButUndefined || [],
    action_changes: loggedActionEntries,
    operative_state_after: memory.operativeState,
    operative_approach_after: memory.operativeApproach,
    management_decisions: plan.managementDecisions || [],
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
    turn_legacy_kind: plan.turnKind?.legacy_kind || null,
    turn_semantic_kind: plan.turnKind?.semantic_kind || plan.turnKind?.kind || "unknown",
    turn_components: plan.turnKind?.components || [],
    duplicate_suppressed: plan.suppressedOperations || [],
    // Where the routing came from, and under which contract. A session routed by
    // the local dictionary matcher and a session routed by the model are not the
    // same experiment, and the log has to say which one it was.
    router_source: plan.parsed?.source || "unknown",
    router_schema_version: plan.parsed?.routerSchemaVersion || null,
    // What the learner specified, in their own words. Transcription only:
    // `eligible_for_scoring` is false on every entry.
    action_parameters: plan.parsed?.actionParameters || [],
    parameter_safety: plan.parameterSafetySignals || [],
    adequacy: plan.adequacyAssessment || null,
    reasoning_sufficient_to_advance: Boolean(plan.reasoningSufficientToAdvance),
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
    mentorGateOperations,
    performedIds,
  };
}

/**
 * What the resident hears when the pilot holds no reviewed rule for what they
 * ordered.
 *
 * THE SENTENCE THIS MUST NOT BE. "Your dose is wrong." It isn't a verdict on the
 * number: the pilot has no approved rule to measure it against, and inventing one
 * is precisely what the governance layer exists to prevent. So the note says three
 * things and stops - the order was recorded, no reviewed rule covers it, it was
 * not applied to the patient - and it never asks again.
 *
 * Said once per order (CDR-19, owner decision 20.08.2026) and once per TURN for
 * all of them together. The live run of 20.08.2026 turned one line of orders into
 * four blocks of engine text, two of them near-identical, and then repeated the
 * whole wall three turns later. The wording for a single fully-stated order is the
 * one the owner signed and is reproduced here unchanged.
 *
 * @param {Array<{verbatim: string, complete: boolean}>|string} notes
 */
export function orderRecordedNote(notes) {
  const list = (Array.isArray(notes) ? notes : [{ verbatim: notes, complete: true }]).filter(
    (note) => note && note.verbatim
  );
  if (!list.length) return "";
  if (list.length === 1 && list[0].complete) {
    return (
      `**Назначение записано:** «${list[0].verbatim}». ` +
      "Отрецензированного правила по этому препарату в пилоте пока нет, поэтому параметры " +
      "не проверяются, к пациенту назначение не применено и эффект не моделируется. " +
      "Это не замечание к твоему выбору. Повторять назначение не нужно."
    );
  }
  if (list.length === 1) {
    return (
      `**Назначение записано:** «${list[0].verbatim}». ` +
      "Отрецензированного правила под этот параметр в пилоте пока нет, поэтому он " +
      "не проверяется, к пациенту назначение не применено и эффект не моделируется. " +
      "Это не замечание к твоему выбору."
    );
  }
  const quoted = list.map((note) => `«${note.verbatim}»`).join(", ");
  const allComplete = list.every((note) => note.complete);
  return (
    `**Назначения записаны:** ${quoted}. ` +
    "Отрецензированных правил под них в пилоте пока нет, поэтому параметры не проверяются, " +
    "к пациенту назначения не применены и эффект не моделируется. " +
    "Это не замечание к твоему выбору." +
    (allComplete ? " Повторять назначения не нужно." : "")
  );
}

/**
 * The other side of the split: a parameter that stops. Either a reviewed rule
 * rejected it, or it belongs to a class the pilot enumerates as high risk and
 * cannot yet measure - "20 ml/kg or 200" is not a distinction it can make, so it
 * fails safe. Danger keeps the register of danger, and it repeats for as long as
 * the learner insists. See core/parameterSafety.js.
 */
export function blockedParameterNote(verbatim) {
  return (
    `**Проверка параметра:** «${verbatim}» требует клинической проверки: ` +
    "параметр не валидирован учебным контентом и не применён к пациенту."
  );
}

/**
 * One order, one wording. A learner who restates the same order gets no second
 * note; a learner who CHANGES it has stated something new and gets one.
 */
export function governanceNoteKey(conceptId, verbatim) {
  return `${conceptId || "unknown"}:${String(verbatim || "").trim().toLowerCase()}`;
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
  const startedAt = options.startedAt || new Date().toISOString();
  const participantConsent = options.participantConsent?.accepted === true
    ? {
        accepted: true,
        policy_version: String(options.participantConsent.policy_version || ""),
        accepted_at: options.participantConsent.accepted_at || startedAt,
        provider_processing_disclosed:
          options.participantConsent.provider_processing_disclosed === true,
        provider_default_abuse_log_retention_days:
          Number(options.participantConsent.provider_default_abuse_log_retention_days) || null,
        local_retention_days: Number(options.participantConsent.local_retention_days) || null,
      }
    : null;
  const session = {
    session_id: options.sessionId || createUuid(),
    // The handle a participant reads off the screen and types into the feedback
    // form. `session_id` stays the key everything joins on; this is the copy a
    // human can transcribe without error. See clinical/ids.js.
    session_code: options.sessionCode || createSessionCode(startedAt),
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
    clinical_test: caseData.clinical_test || null,
    router_version: caseData.router_version,
    mentor_policy_version: MENTOR_POLICY_VERSION,
    clinical_governance_version: CLINICAL_GOVERNANCE_VERSION,
    source_registry_version: SOURCE_REGISTRY_VERSION,
    clinical_rule_registry_version: CLINICAL_RULE_REGISTRY_VERSION,
    title: caseData.title,
    locale: options.locale === "kk" ? "kk" : "ru",
    // How the mentor addresses this learner, when the cohort declares it. Left
    // unset the mentor stays neutral until the learner's own past-tense forms
    // say otherwise - it never guesses, and never infers from a name. See
    // core/learnerAddress.js.
    learnerAddressForm: Object.values(LEARNER_ADDRESS_FORM).includes(options.learnerAddressForm)
      ? options.learnerAddressForm
      : null,
    institution_id: options.institutionId || "synthetic-pilot",
    cohort_id: options.cohortId || null,
    learner_id: options.learnerId || `anon:${createUuid()}`,
    participant_consent: participantConsent,
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
    started_at: startedAt,
    completed_at: null,
  };
  session.eventLog.push(
    event(session, "session_started", {
      engine_version: session.engine_version,
      product_version: session.product_version,
      content_version: session.content_version,
      mentor_policy_version: session.mentor_policy_version,
      clinical_governance_version: session.clinical_governance_version,
      source_registry_version: session.source_registry_version,
      clinical_rule_registry_version: session.clinical_rule_registry_version,
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
      clinical_test: session.clinical_test,
      participant_consent: participantConsent,
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
  const fullClinicalTest = Boolean(
    caseData.clinical_test?.enabled && options.fullClinicalTest === true
  );
  const rawPlan = await planClinicalTurn({ input, caseData, session, options });
  const plan = fullClinicalTest
    ? {
        ...rawPlan,
        parameterSafetySignals: (rawPlan.parameterSafetySignals || []).map((signal) => ({
          ...signal,
          blocks_application: false,
          applied_to_patient: true,
          clinical_test_bypass: "unvalidated_parameter_applied_in_internal_test",
        })),
        // The internal test drives the whole path from a script, so it also
        // waives the "чем и как" question — there is no learner to answer it.
        operations: (rawPlan.operations || []).map((operation) => ({
          ...operation,
          needsOperationalization: false,
          operationalization: operation.operationalization
            ? { ...operation.operationalization, complete: true, missing: [] }
            : null,
        })),
        operationalizationStates: (rawPlan.operationalizationStates || []).map((state) => ({
          ...state,
          complete: true,
          missing: [],
        })),
      }
    : rawPlan;
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
  const enforceBlockingPrerequisites = fullClinicalTest
    ? false
    : options.enforceBlockingPrerequisites ?? Boolean(options.mentor);
  const deterministicUpdate = applyPlan(caseData, nextSession, plan, {
    ...options,
    enforceBlockingPrerequisites,
    enforcePathwayBlocks: !fullClinicalTest,
    enforceMentorGates: !fullClinicalTest && Boolean(options.mentor),
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
  const turnTouchedThePatient = Boolean(plan.patientInteraction);
  const blockedOnly =
    deterministicUpdate.blockedOperations.length > 0 && deterministicUpdate.performedIds.length === 0;
  const addressedWithoutSimulator =
    deterministicUpdate.nonActionLines.length > 0 || deterministicUpdate.blockedOperations.length > 0;
  const shouldInvokeSimulator =
    turnTouchedThePatient && !blockedOnly && !addressedWithoutSimulator && (
      deterministicUpdate.findingsRevealed.length > 0 ||
      plan.turnKind?.semantic_kind === "patient_question"
    );
  if (options.simulatorLLM && plan.mode !== "conversational_turn" && shouldInvokeSimulator) {
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
          rawUserText: input,
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
  // Base rules v2, 2.1: the router is the gate on EXECUTION, not on SPEECH. A
  // turn the router could not map, and a turn about the conversation itself,
  // both still reach the mentor - which now holds the whole transcript and the
  // pending question contract and can restate it in context instead of leaving
  // the learner with "Уточни, какие данные хочешь получить". Nothing about what
  // may be applied to the patient changes: that is still decided above, by the
  // recognised concepts and the Case Card.
  if (options.mentor) {
    const brief = buildMentorBrief({
      caseData,
      session: deterministicUpdate.session,
      plan,
      deterministicUpdate,
      simulatorProducedResults: Boolean(simulator?.informationUsed?.length),
      // Whatever the patient/environment channel settled on for this turn. The
      // mentor speaks underneath it and may not say it a second time.
      engineReplyText: reply,
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
    if (plan.mode === "conversational_turn") {
      // The deterministic answer here is a statement of record ("это уже
      // зафиксировано") or a restatement of the last question. A silent mentor
      // leaves it as it is. A speaking mentor keeps the record - it is a fact
      // the learner disputed - and replaces the mechanical restatement, because
      // restating a question the learner did not understand a second time
      // verbatim is what the mentor is for.
      reply = mentor.mode === MENTOR_MODE.CONTINUE
        ? reply
        : plan.responseAct === "explain_recorded_and_missing_actions"
          ? [reply, mentor.text].filter(Boolean).join("\n\n").trim()
          : mentor.text;
    } else {
      const facts = deterministicUpdate.neutralPrompt
        ? reply.split(deterministicUpdate.neutralPrompt).join("").trim()
        : reply;
      const closing = mentor.mode === MENTOR_MODE.CONTINUE
        ? deterministicUpdate.neutralPrompt
        : mentor.text;
      reply = [facts, closing].filter(Boolean).join("\n\n").trim();
    }
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
        ...new Set([
          ...(deterministicUpdate.session.workingMemory?.firedHeuristicIds || []),
          ...(mentor?.firedHeuristicKeys || mentorBrief?.firedHeuristicKeys || []),
          ...(mentor && mentor.mode !== MENTOR_MODE.CONTINUE
            ? (deterministicUpdate.mentorGateOperations || []).map(
                (operation) => `mentor_gate:${operation.action_id}`
              )
            : []),
        ]),
      ],
      pendingMentorQuestion: mentor?.pendingQuestion || (
        mentor?.mode === MENTOR_MODE.CONTINUE && !plan.mentorAnswer
          ? deterministicUpdate.session.workingMemory?.pendingMentorQuestion || null
          : null
      ),
      // How many turns running the mentor has been probing - CLARIFY or
      // CHALLENGE, with a question in it. A learner who answers moves the
      // mentor to REINFORCE, TEACH or silence, so a streak IS the signal that
      // the question is not landing. Wording comparison alone missed it: the
      // run of 21.08.2026 asked the same thing four ways and only two of the
      // four were lexically close enough to catch.
      // Counted on the MODE alone since 21.08.2026. Tying it to a question mark
      // let an imperative re-ask through - "Сейчас назови следующий контрольный
      // этап" is the same demand as asking for it, and CLARIFY and CHALLENGE
      // both demand an answer by definition. REINFORCE, TEACH, silence and a
      // safety stop all reset it, because each of them releases the pressure.
      probingStreak:
        mentor && [MENTOR_MODE.CLARIFY, MENTOR_MODE.CHALLENGE].includes(mentor.mode)
          ? (deterministicUpdate.session.workingMemory?.probingStreak || 0) + 1
          : 0,
      // The last three probes the mentor actually made, verbatim. A CLARIFY or
      // CHALLENGE imperative ("Назови следующий шаг") demands the same answer
      // as a sentence ending in "?", so it must also participate in repeat
      // detection and the next-turn answer contract.
      recentMentorQuestions: [
        ...(mentor && mentor.mode !== MENTOR_MODE.CONTINUE
          ? (() => {
              const sentences = String(mentor.text || "")
                .split(/(?<=[.!?…])\s+|\n+/u)
                .map((sentence) => sentence.trim())
                .filter(Boolean);
              const explicitQuestions = sentences.filter((sentence) => sentence.includes("?"));
              if (explicitQuestions.length) return explicitQuestions;
              return [MENTOR_MODE.CLARIFY, MENTOR_MODE.CHALLENGE].includes(mentor.mode)
                ? [String(mentor.text || "").trim()].filter(Boolean)
                : [];
            })()
          : []),
        ...(deterministicUpdate.session.workingMemory?.recentMentorQuestions || []),
      ].slice(0, 3),
      lastMentorIntervention: mentor && mentor.mode !== MENTOR_MODE.CONTINUE
        ? {
            mode: mentor.mode,
            issue_id: mentor.issueId || null,
            asked_turn: deterministicUpdate.session.workingMemory?.turnNumber || null,
            source: mentor.source,
            adequacy: mentorBrief?.mentorPolicy?.adequacy || null,
            scaffolding_level: mentorBrief?.mentorPolicy?.scaffolding_level || 0,
          }
        : deterministicUpdate.session.workingMemory?.lastMentorIntervention || null,
      mentorScaffoldingState: mentorBrief?.mentorPolicy?.reasoning_sufficient_to_advance
        ? { issue_id: null, scaffolding_level: 0, expected_answer_domains: [] }
        : {
            issue_id: mentorBrief?.mentorPolicy?.issue_id || null,
            scaffolding_level: mentorBrief?.mentorPolicy?.scaffolding_level || 0,
            expected_answer_domains:
              mentorBrief?.mentorPolicy?.expected_answer_domains || [],
          },
      deferredMentorIssues: [
        ...(deterministicUpdate.session.workingMemory?.deferredMentorIssues || []),
        ...(mentorBrief?.deferredIssues || []),
      ].filter(
        (issue, index, all) =>
          all.findIndex((candidate) => candidate.issue_id === issue.issue_id) === index
      ),
    },
  };
  const turnNumber = nextSession.workingMemory?.turnNumber || null;
  nextSession = {
    ...nextSession,
    eventLog: nextSession.eventLog.map((entry) =>
      entry.event_type === "clinical_turn" && entry.turn_number === turnNumber
        ? {
            ...entry,
            simulator_response_parts: simulator?.responseParts || [],
            simulator_suppressed_response_parts: simulator?.suppressedResponseParts || [],
            simulator_invocation_suppressed_reason: simulator
              ? null
              : plan.mode === "conversational_turn"
                ? "conversation_management"
                : blockedOnly
                  ? "blocked_only_turn"
                  : addressedWithoutSimulator
                    ? "deterministic_environment_answer"
                    : !turnTouchedThePatient
                      ? "no_patient_interaction"
                      : "no_patient_fact_requested",
          }
        : entry
    ),
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
        request_telemetry: {
          router: options.actionExtractorLLM?.telemetry || [],
          simulator: options.simulatorLLM?.telemetry || [],
          mentor: options.mentorLLM?.telemetry || [],
        },
        mentor_mode: mentor?.mode || null,
        mentor_issue_id: mentor?.issueId || null,
        mentor_adequacy: mentorBrief?.mentorPolicy?.adequacy || null,
        mentor_scaffolding_level: mentorBrief?.mentorPolicy?.scaffolding_level || 0,
        reasoning_sufficient_to_advance: Boolean(
          mentorBrief?.mentorPolicy?.reasoning_sufficient_to_advance
        ),
        allowed_clinical_rule_ids:
          mentorBrief?.mentorPolicy?.allowed_clinical_rule_ids || [],
        mentor_rejection_reason: mentor?.rejectionReason || null,
        // Base rules v2 telemetry, additive. `regex_policy_shadow` is what the
        // pre-v2 deterministic policy WOULD have dictated this turn; the mentor
        // is no longer bound by it, and the pair is what makes the two decision
        // procedures comparable on a replay instead of only arguable.
        mentor_source: mentor?.source || "not_invoked",
        mentor_rejection_reasons: mentor?.rejectionReasons || [],
        repair_attempted: Boolean(mentor?.repairAttempted),
        mentor_telemetry_flags: mentor?.telemetry || [],
        regex_policy_shadow: mentorBrief?.mentorPolicy
          ? {
              policy_version: mentorBrief.mentorPolicy.policy_version,
              mode: mentorBrief.mentorPolicy.mode,
              adequacy: mentorBrief.mentorPolicy.adequacy,
              issue_id: mentorBrief.mentorPolicy.issue_id,
              scaffolding_level: mentorBrief.mentorPolicy.scaffolding_level,
              question_domain: mentorBrief.mentorPolicy.question_domain,
              agreed_with_mentor:
                mentor?.mode === mentorBrief.mentorPolicy.mode &&
                (mentor?.issueId || null) === (mentorBrief.mentorPolicy.issue_id || null),
            }
          : null,
        learner_address_form: mentorBrief?.learnerAddressForm || null,
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
    mentorPolicy: mentorBrief?.mentorPolicy || null,
  };
}

export { createV25Case as createDefaultV25Case };
