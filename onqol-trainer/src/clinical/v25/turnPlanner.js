import { extractLearnerActions } from "../actionExtraction.js";
import { buildAllowedActionMap } from "../schemas/caseSchema.js";
import { requestedTechnique } from "./scenarioEngine.js";
import {
  classifyTurn,
  interpretStandaloneReasoning,
  interpretPendingMentorAnswer,
  requestsExplicitRepeat,
  resolveTurnSemantics,
  suppressDuplicateOperations,
} from "./turnKind.js";
import { mergeTurnReasoningDeltas } from "../core/reasoningState.js";
import { reviewActionParameters } from "../core/parameterSafety.js";
import { classifyLearnerAdequacy } from "../core/mentorPolicy.js";
import { prerequisiteSatisfied } from "../core/prerequisiteClosure.js";
import {
  isRepairMove,
  operationalizationFor,
  operationalizationQuestion,
  readOrderSlots,
} from "../core/operationalization.js";

const TENTATIVE_RE =
  /(?:^|\s)(я\s+бы|можно(?:\s+подготовить|\s+рассмотреть)?|рассмотрю|возможно|вероятно|потенциальн[а-я]*|если\s+(?:будет|подтвердится)|подумаю|думаю\s+об|предлагаю\s+обсудить)(?:\s|$)/i;

const OPERATIVE_MENTION_RE = /операци[а-я]*|аппендэктоми[а-я]*/i;
const PROCEDURE_START_RE =
  /(?:(?:начина(?:ю|ем)|приступа(?:ю|ем)|выполня(?:ю|ем))(?:\s+[а-я-]+){0,3}\s*(?:операци|аппендэктоми)|дела(?:ю|ем)\s+разрез|(?:начина(?:ю|ем)\s+)?индукци[а-я]*|(?:первый\s+)?разрез)/i;
const SOURCE_CONTROL_COMPLETE_RE =
  /(?:аппендэктоми[а-я]*\s+(?:выполн|заверш)|операци[а-я]*\s+заверш|контрол[ья]\s+источник[а-я]*\s+заверш)/i;
const COMMITTED_APPENDECTOMY_RE =
  /(готовим|подготов(?:ить|ка))\s+(?:пациент\w*\s+)?к\s+аппендэктоми|решение\s*:?\s*аппендэктоми|принято\s+решение\s+об\s+аппендэктоми|бер[её]м\s+(?:пациент\w*\s+)?на\s+аппендэктоми/i;

export function classifyOperativeLanguage(input) {
  const text = normalize(input);
  if (!OPERATIVE_MENTION_RE.test(text)) return "none";
  if (SOURCE_CONTROL_COMPLETE_RE.test(text)) return "source_control_completed";
  if (PROCEDURE_START_RE.test(text)) return "procedure_start";
  if (TENTATIVE_RE.test(text)) return "tentative_intent";
  if (requestedTechnique(input)) return "committed_approach";
  if (COMMITTED_APPENDECTOMY_RE.test(text)) return "committed_decision";
  return "generic_mention";
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEndCaseCommand(input, commands = []) {
  const text = normalize(input);
  return commands.some((command) => text === normalize(command));
}

function actionBuckets(caseData) {
  return [
    ...caseData.expected_actions.map((action) => ({ ...action, action_kind: "expected" })),
    ...caseData.acceptable_alternatives.map((action) => ({ ...action, action_kind: "alternative" })),
    ...caseData.unnecessary_actions.map((action) => ({ ...action, action_kind: "unnecessary" })),
    ...caseData.unsafe_actions.map((action) => ({ ...action, action_kind: "unsafe" })),
  ];
}

function actionKind(caseData, actionId) {
  const action = actionBuckets(caseData).find((item) => item.id === actionId);
  return action?.action_kind || "unknown";
}

function phraseHit(text, phrase) {
  const normalized = normalize(phrase);
  if (!normalized) return false;
  const textTokens = text.split(" ");
  const phraseTokens = normalized.split(" ");
  const equivalent = (left, right) => {
    if (left === right) return true;
    if (Math.min(left.length, right.length) < 6) return false;
    const shorter = left.length <= right.length ? left : right;
    const longer = left.length > right.length ? left : right;
    return longer.startsWith(shorter.slice(0, -2));
  };
  return textTokens.some((_, start) =>
    phraseTokens.every((token, offset) => equivalent(textTokens[start + offset] || "", token))
  );
}

export function extractV25Actions(input, caseData) {
  const text = normalize(input);
  if (isEndCaseCommand(text, caseData.end_conditions.user_commands)) {
    return [{ id: "end_case", confidence: 1, source: "command", action_kind: "system" }];
  }

  const hits = [];
  for (const action of actionBuckets(caseData)) {
    const phrases = [
      action.id.replaceAll("_", " "),
      action.concept,
      action.router_description,
      ...(action.accepted_phrasings || []),
    ];
    const matched = phrases.find((phrase) => phraseHit(text, phrase));
    if (!matched) continue;
    hits.push({
      id: action.id,
      intent_type: action.intent_type,
      confidence: matched === action.id.replaceAll("_", " ") ? 0.8 : 0.92,
      source: "v25_local_matcher",
      action_kind: action.action_kind,
      matched_phrase: matched,
    });
  }

  return hits.filter((hit, index, allHits) => allHits.findIndex((item) => item.id === hit.id) === index);
}

function findingForAction(caseData, actionId) {
  const action = buildAllowedActionMap(caseData).get(actionId);
  const findingId = action?.effects_on_case?.reveal || action?.maps_to;
  if (!findingId) return null;
  const finding = caseData.available_findings[findingId] || caseData.hidden_findings[findingId] || null;
  return finding ? { id: findingId, ...finding } : null;
}

function missingPrerequisites(caseData, session, actionIds) {
  // Transcript-wide, not turn-local: "согласие пациента" said two turns ago
  // closes the consent prerequisite. See core/prerequisiteClosure.js for what
  // this deliberately does not do to the WHO checkpoints.
  return actionIds.flatMap((id) => {
    const action = buildAllowedActionMap(caseData).get(id);
    return (action?.prerequisites || [])
      .filter((prerequisite) => !prerequisiteSatisfied(session, prerequisite, actionIds))
      .map((prerequisite) => ({ action_id: id, missing: prerequisite }));
  });
}

function commitmentFor(action, input) {
  if (["request_history", "request_examination", "request_test"].includes(action.intent_type)) {
    return "ordered";
  }
  if (action.intent_type === "diagnosis") return "proposed";
  if (TENTATIVE_RE.test(input)) return "proposed";
  if (["appendectomy_here", "appendectomy_procedure_start"].includes(action.id)) return "ordered";
  return "ordered";
}

const CLARIFY_PROMPT = "Уточни, какие данные хочешь получить или какое действие выполняешь.";
const OPERATIVE_APPROACH_PROMPT = "Какой операционный доступ выбираешь и когда начинаешь?";

function lastAssistantText(session) {
  const messages = session.messages || [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return String(messages[index].content || "");
  }
  return "";
}

function plannerPromptFor({
  actions,
  operations,
  session,
  answeredNonAction,
  operationalizationStates = [],
  completedResumedOrders = false,
  managementDecisions = [],
  answeredMentorQuestion = false,
}) {
  // An incomplete order outranks every other prompt: the team cannot carry out
  // what has not been specified, and asking anything else implies it can.
  const orderQuestion = operationalizationQuestion(operationalizationStates);
  if (orderQuestion) return orderQuestion;

  // The turn produced a real answer - "не смоделировано", "уточни какой
  // антибиотик", the one sign that was asked about. Following it with "уточни,
  // какое действие выполняешь" reads as if nothing had been understood.
  if (answeredNonAction) return "Как это меняет твой план?";
  // The turn answered an outstanding order rather than naming a new action;
  // "уточни, какое действие выполняешь" would read as if it went unheard.
  if (completedResumedOrders) return "Назначение зафиксировано. Что дальше?";
  if (!actions.length) {
    // The learner said something the router understood and the engine recorded -
    // "в операционную", "катим в оперблок" - which maps to no executable action
    // because the decision is already committed and what is actually missing is
    // the approach. Asking "уточни, какое действие выполняешь" there hides state
    // the engine is holding: it knows the appendectomy is decided and the
    // approach is not. Ask for the missing piece by name instead.
    const operative = session.workingMemory?.operativeState || {};
    // The decision may be one the session already holds or one this very turn
    // committed: "оперируем" carries no action, so without the second half the
    // turn that decides the operation is answered with "уточни, какое действие
    // выполняешь" - the turn the engine itself recorded as the decision.
    const decided =
      operative.appendectomy_decided ||
      managementDecisions.some(
        (decision) => decision.decision_id === "appendectomy" && decision.commitment === "ordered"
      );
    const approachSelected =
      operative.operative_approach_selected ||
      managementDecisions.some((decision) => decision.decision_id === "operative_approach");
    if (decided && !approachSelected && !operative.procedure_started) {
      return OPERATIVE_APPROACH_PROMPT;
    }
    // The answer was recognised and recorded. Following it with "уточни, какое
    // действие выполняешь" would ask the learner to repeat what the engine just
    // took in - the exact failure of replay fe92b8b5, one step later.
    if (answeredMentorQuestion) return "Ответ зафиксирован. Что делаешь дальше?";
    // The mentor asked something and the learner said something back that the
    // engine could not turn into an action or into recognised reasoning. Whatever
    // else is true, it is not true that nothing was said, and "уточни, какое
    // действие выполняешь" tells the learner their answer was not read at all.
    if (session.workingMemory?.pendingMentorQuestion && !answeredMentorQuestion) {
      return "Ответь на вопрос выше или назови следующее действие.";
    }
    // Repeating one sentence verbatim carries no new information, and a learner
    // who reads it twice reasonably concludes the trainer is stuck. The replay
    // that prompted this had it three times in a row, after which the resident
    // ended the case. Name what the engine can accept instead.
    return lastAssistantText(session).includes(CLARIFY_PROMPT)
      ? "Пока не понимаю, что выполнить. Назови конкретно: осмотр, исследование, назначение или решение по тактике."
      : CLARIFY_PROMPT;
  }
  if (operations.some((operation) => operation.needsOperationalization)) {
    return OPERATIVE_APPROACH_PROMPT;
  }
  if (operations.some((operation) => operation.commitment === "proposed" && operation.intent_type === "management")) {
    return "Это вариант или принятое решение? Как именно его реализуешь?";
  }
  if (actions.some((action) => action.intent_type === "request_test")) {
    return "Как интерпретируешь полученные данные и что делаешь дальше?";
  }
  const diagnosisIds = new Set(
    actions.filter((action) => action.intent_type === "diagnosis").map((action) => action.id)
  );
  if (
    diagnosisIds.has("diagnosis_acute_appendicitis") &&
    diagnosisIds.has("differential_ectopic")
  ) {
    return "Как будешь различать острый аппендицит и внематочную беременность?";
  }
  if (diagnosisIds.has("diagnosis_acute_appendicitis")) {
    return "Рабочий диагноз зафиксирован. Какой следующий клинический шаг?";
  }
  if (diagnosisIds.size > 0) {
    return "Дифференциальная гипотеза зафиксирована. Что поможет её проверить?";
  }
  if (session.temporalState?.status === "delayed_source_control") {
    return "Состояние изменилось. Как это меняет приоритеты?";
  }
  if (actions.some((action) => action.intent_type === "management")) {
    return "Что контролируешь после этого решения?";
  }
  if (
    actions.every((action) =>
      ["request_history", "request_examination"].includes(action.intent_type)
    )
  ) {
    return "";
  }
  return "Что дальше?";
}

async function resolveActions(input, caseData, session, options) {
  if (isEndCaseCommand(input, caseData.end_conditions.user_commands)) {
    return {
      actions: [{ id: "end_case", confidence: 1, source: "command", action_kind: "system" }],
      parsed: { actions: [{ id: "end_case", confidence: 1, source: "command" }], source: "command" },
    };
  }

  if (options.actionExtractorLLM) {
    try {
      const parsed = await extractLearnerActions(input, caseData, session, {
        actionExtractorLLM: options.actionExtractorLLM,
        locale: options.locale || session.locale || "ru",
        conceptMap: options.conceptMap || {},
        // Typed lookup: tells a hypothesis from a resource question from an
        // investigation nobody modelled. See router/conceptRegistry.js.
        conceptRegistry: options.conceptRegistry,
        routerVersion: options.routerVersion,
      });
      return {
        parsed,
        actions: parsed.actions.map((action) => ({
          ...action,
          action_kind: actionKind(caseData, action.id),
        })),
      };
    } catch (error) {
      if (options.requireSemanticRouter) throw error;
    }
  }

  const actions = extractV25Actions(input, caseData);
  return {
    actions,
    parsed: {
      actions,
      source: "v25_local_matcher",
      parserConfidence: actions.length
        ? actions.reduce((sum, action) => sum + action.confidence, 0) / actions.length
        : 0,
    },
  };
}

export async function planClinicalTurn({ input, caseData, session, options = {} }) {
  // Conversation management is decided before routing. A learner asking for the
  // question to be repeated must not be able to reach the clinical engine at
  // all - see turnKind.js for what this cost in the first live run.
  const turnKind = classifyTurn(input);
  if (turnKind.blocks_clinical_turn) {
    const conversationalKind = resolveTurnSemantics({ base: turnKind });
    return {
      input,
      parsed: { actions: [], source: "conversational_resolver", turn_kind: conversationalKind.kind },
      actions: [],
      actionIds: [],
      operations: [],
      suppressedOperations: [],
      turnKind: conversationalKind,
      mode: "conversational_turn",
      learnerMove: conversationalKind.kind,
      responseAct:
        turnKind.reason_code === "memory_dispute"
          ? "explain_recorded_and_missing_actions"
          : "repair_previous_question",
      patientBoundary:
        "The learner is talking about the conversation, not to the patient. Reveal nothing and change nothing.",
      // The mentor restates its previous question; it does not pick a new topic.
      plannerPrompt: "",
      prerequisiteWarnings: [],
      riskFlags: [],
    };
  }

  let { actions, parsed } = await resolveActions(input, caseData, session, options);
  // After source control, a request to monitor the operated patient is a
  // postoperative reassessment, not a fresh preoperative observation order.
  // The language model may choose the broader concept; the deterministic path
  // owns the phase and narrows it before anything reaches the patient.
  if (
    session.temporalState?.sourceControl &&
    ["operation", "postop_destination", "ward_care"].includes(session.pathState)
  ) {
    actions = actions.map((action) =>
      action.id === "active_observation"
        ? {
            ...action,
            id: "postoperative_reassessment",
            intent_type: "request_examination",
            routed_concept_id: action.routed_concept_id || "active_observation",
            source: `${action.source || "router"}:postop_phase_narrowing`,
          }
        : action
    );
    parsed.actions = (parsed.actions || []).map((action) =>
      action.id === "active_observation"
        ? { ...action, id: "postoperative_reassessment", intent_type: "request_examination" }
        : action
    );
  }
  const operativeLanguage = classifyOperativeLanguage(input);
  if (["tentative_intent", "committed_decision", "committed_approach"].includes(operativeLanguage)) {
    actions = actions.filter(
      (action) => !["appendectomy_here", "appendectomy_procedure_start"].includes(action.id)
    );
    parsed.actions = (parsed.actions || []).filter(
      (action) => !["appendectomy_here", "appendectomy_procedure_start"].includes(action.id)
    );
  }
  if (operativeLanguage === "committed_decision") {
    parsed.managementDecisions = [
      ...(parsed.managementDecisions || []).filter(
        (decision) => decision.decision_id !== "appendectomy"
      ),
      {
        concept_id: "decision_for_appendectomy",
        decision_id: "appendectomy",
        commitment: "ordered",
      },
    ];
    parsed.reasoning = mergeTurnReasoningDeltas(parsed.reasoning || null, {
      management: { plan_stated: true, urgency_stated: false, rationale_stated: false },
    });
  }
  const selectedApproach = requestedTechnique(input);
  if (operativeLanguage === "committed_approach" && selectedApproach) {
    parsed.managementDecisions = [
      ...(parsed.managementDecisions || []).filter(
        (decision) => decision.decision_id !== "operative_approach"
      ),
      {
        concept_id: `operative_approach_${selectedApproach}`,
        decision_id: "operative_approach",
        approach: selectedApproach,
        commitment: "selected",
        requested_fragment: String(input).trim(),
      },
    ];
  }
  const mentorAnswer = interpretPendingMentorAnswer(
    input,
    session.workingMemory?.pendingMentorQuestion,
    {
      hasClinicalAction: actions.length > 0 || (parsed.managementDecisions || []).length > 0,
      hasPatientQuestion: (parsed.intents || []).some((intent) => intent.type === "question"),
      hasReasoning: Boolean(parsed.reasoning),
      workingDiagnosisConceptId:
        session.workingMemory?.reasoningState?.working_diagnosis?.concept_id || null,
    }
  );
  const standaloneReasoning = mentorAnswer ? null : interpretStandaloneReasoning(input);
  parsed.reasoning = mergeTurnReasoningDeltas(
    mergeTurnReasoningDeltas(parsed.reasoning || null, mentorAnswer?.reasoning),
    standaloneReasoning
  );
  if (mentorAnswer && actions.length === 0) {
    parsed.unresolvedFragments = [];
    parsed.unknownText = "";
  }
  const actionIds = actions.map((action) => action.id).filter((id) => id !== "end_case");
  const parameterReview = reviewActionParameters(
    parsed.actionParameters || [],
    input,
    actionIds,
    {
      clinicalRules: options.clinicalRules,
      sourceRegistry: options.sourceRegistry,
    }
  );
  parsed.actionParameters = parameterReview.parameters;
  parsed.parameterSafety = parameterReview.reviews;
  const technique = requestedTechnique(input);
  const plannedOperations = actions
    .filter((action) => action.id !== "end_case")
    .map((action) => {
      const commitment = commitmentFor(action, input);
      const actionDefinition = buildAllowedActionMap(caseData).get(action.id);
      // "Обезболю пациента" names an intention; the team still has to be told
      // what and how. See core/operationalization.js.
      const orderSlots = readOrderSlots({
        actionId: action.id,
        text: input,
        parameters: parsed.actionParameters,
        previouslyFilled: session.workingMemory?.orderRecords?.[action.id]?.slots,
      });
      return {
        action_id: action.id,
        action_kind: action.action_kind,
        intent_type: action.intent_type,
        confidence: action.confidence,
        commitment,
        technique: ["appendectomy_here", "appendectomy_procedure_start"].includes(action.id)
          ? technique || session.workingMemory?.operativeApproach?.approach || null
          : null,
        needsOperationalization:
          (["appendectomy_here", "appendectomy_procedure_start"].includes(action.id) &&
            !(technique || session.workingMemory?.operativeApproach?.approach)) ||
          Boolean(orderSlots && !orderSlots.complete),
        operationalization: orderSlots,
        finding: findingForAction(caseData, action.id),
        findingStatus: actionDefinition?.finding_status || null,
        unavailableReason: actionDefinition?.unavailable_reason_ru || null,
        requestedFragment: action.requested_fragment || action.matched_phrase || null,
        availableToOrder: actionDefinition?.available_to_order !== false,
        expectedForThisPatient: actionDefinition?.expected_for_this_patient !== false,
        countsAsDecision: action.intent_type === "diagnosis",
      };
    });
  // Idempotency. A message that mentions an order the patient already had does
  // not repeat it, unless the learner asked for a repeat in words.
  const { operations, suppressed } = suppressDuplicateOperations(
    plannedOperations,
    session.workingMemory?.actionStates,
    requestsExplicitRepeat(input)
  );
  // An answer to "чем и как?" usually names no action at all: «кеторолак 30 мг
  // в/в» is a parameter, not an order. Without this the answer is routed as
  // unrecognised text and the same question is asked again.
  const resumedOperationalization = (session.workingMemory?.pendingOperationalization || [])
    .filter(
      (actionId) =>
        operationalizationFor(actionId) &&
        !operations.some((operation) => operation.action_id === actionId)
    )
    .map((actionId) =>
      readOrderSlots({
        actionId,
        text: input,
        parameters: parsed.actionParameters,
        previouslyFilled: session.workingMemory?.orderRecords?.[actionId]?.slots,
      })
    )
    // A turn counts as an answer for an action only when it fills a slot that
    // action was actually waiting for. Otherwise «5 мл на кг», written about an
    // infusion, is filed as the dose of the analgesic nobody asked about.
    .filter((state) => {
      const contract = operationalizationFor(state.action_id);
      const previous = session.workingMemory?.orderRecords?.[state.action_id]?.slots || {};
      const before = contract.required.filter((slot) => previous[slot]).length;
      const after = contract.required.filter((slot) => state.filled[slot]).length;
      return after > before;
    });

  const operationalizationStates = [
    ...operations.map((operation) => operation.operationalization).filter(Boolean),
    ...resumedOperationalization,
  ];

  const prerequisites = missingPrerequisites(caseData, session, actionIds);
  const mode = actions.some((action) => action.id === "end_case") ? "debrief" : "simulation_turn";
  const resolvedTurnKind = resolveTurnSemantics({
    base: turnKind,
    actions,
    parsed,
    mentorAnswer,
  });
  const managementDecisions = parsed.managementDecisions || [];
  const patientInteraction =
    operations.some((operation) => operation.commitment !== "proposed") ||
    resolvedTurnKind.semantic_kind === "patient_question";
  const policyInput = {
    pendingMentorQuestionBeforeTurn: session.workingMemory?.pendingMentorQuestion || null,
    mentorAnswer,
    parameterSafetySignals: parameterReview.reviews,
    operations,
    operationalizationStates,
    repairMove: isRepairMove(input),
    managementDecisions,
    parsed,
    turnKind: resolvedTurnKind,
  };
  const adequacyAssessment = classifyLearnerAdequacy({
    learnerText: input,
    plan: policyInput,
    session,
  });

  return {
    input,
    parsed,
    actions,
    actionIds,
    operations,
    suppressedOperations: suppressed,
    turnKind: resolvedTurnKind,
    mentorAnswer,
    pendingMentorQuestionBeforeTurn: session.workingMemory?.pendingMentorQuestion || null,
    managementDecisions,
    parameterSafetySignals: parameterReview.reviews,
    operationalizationStates,
    resumedOperationalization,
    repairMove: isRepairMove(input),
    operativeLanguage,
    patientInteraction,
    adequacyAssessment,
    reasoningSufficientToAdvance: adequacyAssessment.adequacy === "SUFFICIENT",
    mode,
    learnerMove: actions.length
      ? actions.length > 1
        ? "compound_move"
        : actions[0].intent_type || "clinical_move"
      : mentorAnswer
        ? "mentor_answer"
        : parsed.reasoning
          ? "clinical_reasoning"
          : "unresolved_or_conversational",
    responseAct: operations.some((operation) => operation.needsOperationalization)
      ? "request_operationalization"
      : operations.some((operation) => operation.finding)
        ? "reveal_authored_fact"
        : "advance_dialogue",
    patientBoundary:
      "Use only Case Blueprint facts, revealed scenario constraints and deterministic temporal changes. Never teach or score during simulation.",
    plannerPrompt:
      mode === "debrief"
        ? "Сформировать разбор по данным завершённой сессии."
        : plannerPromptFor({
            actions,
            operations,
            session,
            operationalizationStates,
            completedResumedOrders: resumedOperationalization.some((state) => state.complete),
            answeredNonAction: (parsed.unresolvedByKind || []).some(
              (entry) => entry.kind !== "reasoning_only"
            ),
            managementDecisions: parsed.managementDecisions || [],
            answeredMentorQuestion: Boolean(mentorAnswer),
          }),
    prerequisiteWarnings: prerequisites,
    riskFlags: actions
      .filter((action) => ["unsafe", "unnecessary"].includes(action.action_kind))
      .map((action) => action.id),
  };
}
