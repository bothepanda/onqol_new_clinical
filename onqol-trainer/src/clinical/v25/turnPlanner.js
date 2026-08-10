import { extractLearnerActions } from "../actionExtraction.js";
import { buildAllowedActionMap } from "../schemas/caseSchema.js";
import { requestedTechnique } from "./scenarioEngine.js";
import { classifyTurn, requestsExplicitRepeat, suppressDuplicateOperations } from "./turnKind.js";

const TENTATIVE_RE =
  /\b(я\s+бы|можно\s+рассмотреть|рассмотрю|возможно|вероятно|если\s+будет|подумаю|предлагаю\s+обсудить)\b/i;

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  if (caseData.end_conditions.user_commands.some((command) => phraseHit(text, command))) {
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
  const completed = new Set(session.completedActions || []);
  return actionIds.flatMap((id) => {
    const action = buildAllowedActionMap(caseData).get(id);
    return (action?.prerequisites || [])
      .filter((prerequisite) => !completed.has(prerequisite) && !actionIds.includes(prerequisite))
      .map((prerequisite) => ({ action_id: id, missing: prerequisite }));
  });
}

function commitmentFor(action, input) {
  if (["request_history", "request_examination", "request_test"].includes(action.intent_type)) {
    return "ordered";
  }
  if (action.intent_type === "diagnosis") return "proposed";
  if (TENTATIVE_RE.test(input)) return "proposed";
  if (action.id === "open_appendectomy_here" && !requestedTechnique(input)) return "proposed";
  return "ordered";
}

function plannerPromptFor({ actions, operations, session }) {
  if (!actions.length) return "Уточни, какие данные хочешь получить или какое действие выполняешь.";
  if (operations.some((operation) => operation.needsOperationalization)) {
    return "Какой операционный доступ выбираешь и когда начинаешь?";
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
  if (caseData.end_conditions.user_commands.some((command) => phraseHit(normalize(input), command))) {
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
    return {
      input,
      parsed: { actions: [], source: "conversational_resolver", turn_kind: turnKind.kind },
      actions: [],
      actionIds: [],
      operations: [],
      suppressedOperations: [],
      turnKind,
      mode: "conversational_turn",
      learnerMove: turnKind.kind,
      responseAct: "repair_previous_question",
      patientBoundary:
        "The learner is talking about the conversation, not to the patient. Reveal nothing and change nothing.",
      // The mentor restates its previous question; it does not pick a new topic.
      plannerPrompt: "",
      prerequisiteWarnings: [],
      riskFlags: [],
    };
  }

  const { actions, parsed } = await resolveActions(input, caseData, session, options);
  const actionIds = actions.map((action) => action.id).filter((id) => id !== "end_case");
  const technique = requestedTechnique(input);
  const plannedOperations = actions
    .filter((action) => action.id !== "end_case")
    .map((action) => {
      const commitment = commitmentFor(action, input);
      return {
        action_id: action.id,
        action_kind: action.action_kind,
        intent_type: action.intent_type,
        confidence: action.confidence,
        commitment,
        technique: action.id === "open_appendectomy_here" ? technique : null,
        needsOperationalization: action.id === "open_appendectomy_here" && !technique,
        finding: findingForAction(caseData, action.id),
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
  const prerequisites = missingPrerequisites(caseData, session, actionIds);
  const mode = actions.some((action) => action.id === "end_case") ? "debrief" : "simulation_turn";

  return {
    input,
    parsed,
    actions,
    actionIds,
    operations,
    suppressedOperations: suppressed,
    turnKind,
    mode,
    learnerMove: actions.length
      ? actions.length > 1
        ? "compound_move"
        : actions[0].intent_type || "clinical_move"
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
        ? "Сформировать evidence-grounded debrief."
        : plannerPromptFor({ actions, operations, session }),
    prerequisiteWarnings: prerequisites,
    riskFlags: actions
      .filter((action) => ["unsafe", "unnecessary"].includes(action.action_kind))
      .map((action) => action.id),
  };
}
