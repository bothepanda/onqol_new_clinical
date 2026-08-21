import { coreActionsById, operativePrerequisites } from "./coreActions.js";
import { firedKey, selectHeuristics } from "./mentorHeuristics.js";
import { resolveScenarioResource } from "../v25/scenarioEngine.js";
import {
  ADEQUACY,
  MENTOR_MODE,
  parameterStopKey,
  selectMentorPolicy,
} from "./mentorPolicy.js";
import { operationalizationQuestion } from "./operationalization.js";
import {
  isGovernanceGapParameter,
  isReviewedUnsafeParameter,
} from "./parameterSafety.js";
import { resolveLearnerAddressForm } from "./learnerAddress.js";
import { detectLegacyPractices, legacyPracticeBriefEntry } from "./legacyPractices.js";
import {
  CLINICAL_RULE_REGISTRY,
  CLINICAL_RUNTIME_EFFECT,
  approvedDosingRules,
  ruleAllowsRuntimeEffect,
} from "../governance/clinicalGovernance.js";

/**
 * The mentor brief: a deterministic description of what is pedagogically true
 * on this turn.
 *
 * BASE RULES V2 CHANGED WHAT THIS IS. Until v3.5 the brief was a starvation
 * diet: action ids, verdicts, authored templates and an allowlist of facts the
 * learner could already see, and nothing else, because a mentor that cannot see
 * the case cannot leak it. The cost was a mentor that could not teach - it did
 * not know what the case models, so "УЗИ малого таза здесь не смоделировано"
 * came out as "эти данные не заданы в карте пациента".
 *
 * The internal brief still carries the case card (see buildMentorCaseCard), the
 * whole transcript, approved rules and accumulated reasoning state for
 * deterministic policy and post-generation checks. Since prompt contract v4.1,
 * mentorAgent serializes only revealed facts, six recent messages, bounded
 * candidate issues, approved rules and a deterministic policy shadow. The full
 * card and transcript never reach the live model.
 *
 * Unrevealed findings remain marked `unrevealed: true, do_not_mention: true`
 * inside the brief, and `leaksUnrevealedFinding` in mentorAgent.js still checks
 * generated output against caseData as defence in depth.
 *
 * It does carry `learnerReasoning`: sentences the learner wrote themselves,
 * quoted exactly and checked against their message before they got here (see
 * core/reasoningState.js). Those are claims the learner has already made out
 * loud, so repeating one back cannot tell them anything they did not know, and
 * being able to quote a learner's own formulation is most of what supervision
 * is. The mentor prompt is told to question them and never to endorse them.
 *
 * Compare with the patient/environment channel (`simulatorAgent.js`), which
 * does see the Case Card and is therefore restricted to copying locked text.
 * Two channels, two different locks, for two different jobs.
 */

export const MENTOR_MOVE = {
  PREREQUISITE_STOP: "prerequisite_stop",
  ESCALATION_APPROPRIATE: "escalation_appropriate",
  ESCALATION_PREMATURE: "escalation_premature",
  UNCERTAINTY_DECLARED: "uncertainty_declared",
  OUT_OF_SCOPE_RECOGNIZED: "out_of_scope_recognized",
  RESOURCE_BLOCKED: "resource_blocked",
  NEUTRAL_PROMPT: "neutral_prompt",
  // Proactive moves. Everything above waits for the learner to do something;
  // these three notice what is not happening. See mentorHeuristics.js.
  SEQUENCE_INVERTED: "sequence_inverted",
  OUTSTANDING_PRIORITY: "outstanding_priority",
  CLOCK: "clock",
  // A question asked because reasoning should be made visible at this point in
  // the case, not because anything is wrong. See mentorHeuristics.js.
  CHECKPOINT: "checkpoint",
  PARAMETER_SAFETY: "parameter_safety",
  // "Хорошо, а чем и как?" — the order is named but not specified enough to be
  // carried out. See core/operationalization.js.
  OPERATIONALIZATION: "operationalization",
  // The router could not map the words. Base rules v2: the mentor answers it,
  // the engine still refuses to execute it. See core/prerequisiteClosure.js's
  // sibling reasoning in engine.js nonActionReplies.
  UNRECOGNIZED_FRAGMENT: "unrecognized_fragment",
  // A common regional practice with no approved rule behind it yet.
  LEGACY_PRACTICE: "legacy_practice",
};

const ESCALATION_ACTION_IDS = ["call_senior_surgeon", "call_intensive_care"];

const PREREQUISITE_TEMPLATES = {
  consent_not_obtained:
    "Стоп. До операции нужно информированное согласие: пациент должен услышать, что предлагается, какие риски и какие альтернативы.",
  anaesthesia_not_notified:
    "Стоп. Анестезиолог ещё не оповещён. Проверка анестезиологической безопасности входит в Sign In и требует времени до индукции.",
  risk_not_assessed:
    "Операционный риск и сопутствующая патология пока не оценены.",
  theatre_not_notified: "Операционная бригада ещё не оповещена.",
  prophylaxis_not_given:
    "Стоп. Антибиотикопрофилактика до разреза не введена. Это шаг перед операцией, а не после неё.",
};

const PREREQUISITE_FALLBACK = "Перед этим шагом остаётся незакрытое условие.";

export function prerequisiteMeta(caseData, actionId, missingId) {
  const action = [...(caseData.expected_actions || []), ...(caseData.acceptable_alternatives || [])].find(
    (candidate) => candidate.id === actionId
  );
  const declared = (action?.core_prerequisites || operativePrerequisites).find(
    (prerequisite) => prerequisite.action_id === missingId
  );
  return {
    severity: declared?.severity || "advisory",
    reason_id: declared?.reason_id || null,
  };
}

/**
 * Minimum assessment for escalation appropriateness.
 *
 * Calling for help after doing the available minimum is maturity. Calling
 * instead of doing it is avoidance. The difference is what the learner has
 * already completed - so the bar has to be declared, not inferred.
 *
 * Inferring it from the case (say, "every expected initial-assessment action")
 * silently sweeps in things like serial re-examination, which happens over
 * hours. A learner who escalates promptly would then be told off for it. That
 * is a clinical judgement, and it belongs to a reviewer.
 *
 * Returns null when no reviewed bar exists for this case.
 */
export function minimumAssessmentIds(caseData, override = null) {
  if (Array.isArray(override)) return override;
  const declared = caseData.core_library?.minimum_assessment_action_ids;
  return Array.isArray(declared) ? declared : null;
}

function escalationVerdict(caseData, session, actionId, override) {
  const action = coreActionsById.get(actionId);
  const policy = action?.escalation_policy;
  if (!policy) return null;

  if (!policy.requires_minimum_assessment) {
    return { appropriate: true, missing: [], policy, barDeclared: true };
  }

  const minimum = minimumAssessmentIds(caseData, override);
  // Fail open. Without a reviewed bar we do not scold the learner on a guess.
  if (minimum === null || minimum.length === 0) {
    return { appropriate: true, missing: [], policy, barDeclared: false };
  }

  const completed = new Set(session.completedActions || []);
  const missing = minimum.filter((id) => !completed.has(id));
  return { appropriate: missing.length === 0, missing, policy, barDeclared: true };
}

function getCaseAction(caseData, actionId) {
  return [
    ...(caseData.expected_actions || []),
    ...(caseData.acceptable_alternatives || []),
    ...(caseData.unnecessary_actions || []),
    ...(caseData.unsafe_actions || []),
  ].find((candidate) => candidate.id === actionId);
}

function evidenceFor(caseData, actionId) {
  const action = getCaseAction(caseData, actionId);
  const ids = action?.evidence_reference_ids || [];
  return (caseData.references || [])
    .filter((reference) => ids.includes(reference.id))
    .map((reference) => ({
      id: reference.id,
      name: reference.name,
      section: reference.section,
      recommendation: reference.recommendation,
      provenance: reference.provenance,
    }));
}

function visibleFinding(caseData, findingId) {
  const finding = caseData.available_findings?.[findingId] || caseData.hidden_findings?.[findingId];
  if (!finding?.text) return null;
  return {
    source_id: `finding.${findingId}`,
    kind: "result",
    text: `${finding.title}: ${finding.text}`,
  };
}

function visibleResource(session, resource) {
  if (!session.scenario) return null;
  const resolution = resolveScenarioResource(
    session.scenario,
    resource,
    session.temporalState?.clockMinutes || 0
  );
  const text = resolution.revealText || `${resource}: доступен`;
  return { source_id: `resource.${resource}`, kind: "resource", text };
}

function currentStateFacts(session) {
  const state = session.temporalState;
  if (!state) return [];
  const minutes = Number.isFinite(state.clockMinutes) ? state.clockMinutes : 0;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const facts = [
    {
      source_id: "time.current",
      kind: "time",
      text: `Клиническое время: ${hours} ч ${rest} мин от начала симуляции.`,
    },
  ];
  const hasVisibleVitals = [state.heartRate, state.temperatureC, state.painScore].every(Number.isFinite);
  if (hasVisibleVitals) {
    facts.push({
      source_id: "vitals.current",
      kind: "vitals",
      text: `ЧСС ${state.heartRate}/мин, температура ${Number(state.temperatureC).toFixed(1)} °C, боль ${state.painScore}/10.`,
    });
  }
  if (hasVisibleVitals && minutes > 0 && Number.isFinite(state.lastDeltaMinutes)) {
    facts.push({
      source_id: "trend.current",
      kind: "trend",
      text: `С последнего действия прошло ${state.lastDeltaMinutes} мин; сейчас ЧСС ${state.heartRate}/мин, температура ${Number(state.temperatureC).toFixed(1)} °C, боль ${state.painScore}/10.`,
    });
  }
  return facts;
}

/**
 * Facts the learner can already see. Source ids are the authorization boundary:
 * a fact absent from this array cannot be voiced by the mentor agent.
 */
/**
 * The case card as the mentor may see it: the world, never the answer key.
 *
 * INCLUDED - what exists in this simulation. Revealed findings in full,
 * unrevealed findings marked do_not_mention (so the mentor knows what the case
 * models and can say honestly what it does not), and the action inventory by id
 * and concept.
 *
 * EXCLUDED - what would make the mentor an answer sheet: diagnosis_truth, which
 * actions are expected, critical or scored, their weights, and the authored
 * feedback strings. Rule 3 of the base rules survives on the mentor not knowing
 * the verdict, not merely on being told to keep quiet about it.
 */
export function buildMentorCaseCard(caseData, session) {
  const revealed = new Set(session.revealedFindings || []);
  const findingEntries = [
    ...Object.entries(caseData.available_findings || {}),
    ...Object.entries(caseData.hidden_findings || {}),
  ];
  const patient = caseData.patient_state || {};
  const notModelled = new Set(caseData.v35_removed_action_ids || []);

  return {
    case_id: caseData.case_id,
    title: caseData.title,
    resource_setting: caseData.resource_setting || patient.resource_level || null,
    patient: {
      age: patient.age ?? null,
      sex: patient.sex ?? null,
      time_from_onset_hours: patient.time_from_onset_hours ?? null,
      pregnancy_possible: patient.pregnancy_possible ?? null,
      opening_vitals: patient.opening_vitals || null,
    },
    revealed_findings: findingEntries
      .filter(([findingId]) => revealed.has(findingId))
      .map(([findingId, finding]) => ({
        finding_id: findingId,
        title: finding.title,
        text: finding.text,
      })),
    unrevealed_findings: findingEntries
      .filter(([findingId]) => !revealed.has(findingId))
      .map(([findingId, finding]) => ({
        finding_id: findingId,
        title: finding.title,
        text: finding.text,
        unrevealed: true,
        do_not_mention: true,
      })),
    // What the learner can ask for, so "this case does not model that" is an
    // answer the mentor can actually give instead of a generic non-answer.
    modelled_actions: [
      ...(caseData.expected_actions || []),
      ...(caseData.acceptable_alternatives || []),
      ...(caseData.unnecessary_actions || []),
    ].map((action) => ({
      action_id: action.id,
      concept: action.concept,
      intent_type: action.intent_type,
    })),
    not_modelled_action_ids: [...notModelled],
    completed_actions: session.completedActions || [],
    clock_minutes: session.temporalState?.clockMinutes ?? null,
    // Prose, deliberately: naming the withheld fields by their field names put
    // the answer key's vocabulary into the prompt a test then had to allow for.
    answer_key_withheld:
      "the true diagnosis, which actions are expected or critical, their weights, and the authored feedback",
  };
}

export function buildRevealedMentorFacts(caseData, session, justPerformed = []) {
  const facts = [];
  if (caseData.initial_presentation?.text) {
    facts.push({
      source_id: "initial_presentation",
      kind: "handoff",
      text: caseData.initial_presentation.text,
    });
  }
  facts.push(...currentStateFacts(session));
  facts.push(
    ...(session.revealedFindings || [])
      .map((findingId) => visibleFinding(caseData, findingId))
      .filter(Boolean)
  );
  facts.push(
    ...(session.workingMemory?.revealedConstraints || [])
      .map((resource) => visibleResource(session, resource))
      .filter(Boolean)
  );
  facts.push(
    ...justPerformed.map((action) => ({
      source_id: `intervention.${action.action_id}`,
      kind: "intervention",
      text: `Выполнено в текущем ходе: ${action.concept}.`,
    }))
  );
  return facts;
}

/**
 * The learner's own sentences, pulled out of Reasoning State for the mentor.
 *
 * Every string here was checked against the learner's message before it was
 * stored, so this function only reads. Empty sections are dropped rather than
 * sent as empty arrays: a mentor handed `{evidence_against: []}` tends to
 * remark on the emptiness, which is the heuristics' job, not the prompt's.
 */
function learnerReasoning(state) {
  if (!state) return null;
  const summary = state.problem_representation?.verbatim || null;
  // A hypothesis is worth showing when the learner said anything about it at
  // all: argued it, ordered it, or flagged it as the one not to miss. Dropping
  // "внематочную исключить нельзя" because it came without an argument would
  // hide the single most useful thing the learner said - and a diagnosis name
  // is a concept id, not a patient fact.
  const hypotheses = (state.differential?.items || [])
    .filter(
      (item) =>
        (item.evidence_for || []).length ||
        (item.evidence_against || []).length ||
        item.dangerous ||
        item.rank !== null
    )
    .map((item) => ({
      concept_id: item.concept_id,
      rank: item.rank,
      dangerous: item.dangerous,
      said_for: item.evidence_for || [],
      said_against: item.evidence_against || [],
    }));
  const investigations = (state.investigations?.items || [])
    .filter((item) => item.justification)
    .map((item) => ({ action_id: item.action_id, said_why: item.justification }));
  const changesThePlan = state.contingency?.trigger_verbatim || [];

  if (!summary && !hypotheses.length && !investigations.length && !changesThePlan.length) {
    return null;
  }
  return {
    note:
      "Quoted from the learner's own messages. These are their claims, not verified facts about the patient.",
    ...(summary ? { patient_summary: summary } : {}),
    ...(hypotheses.length ? { hypotheses } : {}),
    ...(investigations.length ? { investigations } : {}),
    ...(changesThePlan.length ? { would_change_the_plan: changesThePlan } : {}),
  };
}

/**
 * @param {object} params
 * @param {object} params.caseData
 * @param {object} params.session  session state AFTER the deterministic update.
 *        Escalation is judged against everything the learner has done including
 *        this turn, so "осмотрел живот, зову старшего" in one message counts as
 *        assessment first, not as avoidance.
 * @param {object} params.plan             turn plan (parsed actions, warnings)
 * @param {object} [params.deterministicUpdate]  result of applyPlan
 * @param {string[]} [params.minimumAssessment]  override for the escalation bar
 * @returns {{moves: object[], containsPatientFacts: boolean, turnNumber: number}}
 */
export function buildMentorBrief({
  caseData,
  session,
  plan,
  deterministicUpdate = {},
  minimumAssessment = null,
  simulatorProducedResults = false,
  // Verbatim text the engine is printing above the mentor's reply on this turn.
  // The mentor is given it so it can be refused for restating it - see
  // paraphrasesEngine in core/mentorAgent.js.
  engineReplyText = "",
}) {
  const moves = [];
  const performed = new Set(
    (deterministicUpdate.scoringEvents || []).map((event) => event.action_id).filter(Boolean)
  );
  const blocked = new Set(
    (deterministicUpdate.blockedOperations || []).map((operation) => operation.action_id)
  );
  const heldAtMentorGate = new Set(
    (deterministicUpdate.mentorGateOperations || []).map((operation) => operation.action_id)
  );
  // The learner "went for it" whether the engine let the action through or
  // stopped it. Both deserve a mentor reply.
  const attempted = new Set([...performed, ...blocked, ...heldAtMentorGate]);

  const currentReasoning = plan.parsed?.reasoning;
  if (
    currentReasoning?.differential?.has_dangerous_alternative &&
    (currentReasoning.differential?.items || []).length >= 2
  ) {
    moves.push({
      type: "reasoning_reinforcement",
      issue_id: "dangerous_alternative_retained",
      severity: 2,
      hint_level: 1,
      safety_critical: false,
      why_now: "reasoning_changed_this_turn",
      reasoning_gap: null,
      relevant_to_current_turn: true,
      template:
        "Опасная альтернатива остаётся в поле зрения — это полезная часть текущего рассуждения.",
      evidence: [],
    });
  }

  if (plan.mentorAnswer?.answered_contract) {
    const specificity = plan.parsed?.reasoning?.contingency?.specificity;
    if (specificity === "partial") {
      moves.push({
        type: "contingency_partial",
        issue_id: "contingency_threshold",
        severity: 1,
        hint_level: 2,
        safety_critical: false,
        why_now: "answer_to_previous_mentor_question",
        reasoning_gap: "contingency_specificity",
        relevant_to_current_turn: true,
        template:
          "Признаки наблюдения названы. Какое изменение станет триггером смены плана?",
        evidence: [],
      });
    } else if (specificity === "vague") {
      moves.push({
        type: "contingency_acknowledged",
        issue_id: "contingency_vague_acknowledgement",
        severity: 0,
        hint_level: 1,
        safety_critical: false,
        why_now: "answer_to_previous_mentor_question",
        reasoning_gap: "contingency_specificity",
        relevant_to_current_turn: true,
        template: "Условие пересмотра названо, но пока остаётся общим.",
        evidence: [],
      });
    }
  }

  // An order that has not been specified cannot be carried out, and that comes
  // before every teaching move: the team is standing there waiting. One move
  // covers every incomplete order in the turn, so a compound move gets one
  // question rather than one question and a silent half.
  //
  // An order the parameter review has already blocked is not among them. Its own
  // move below asks for the missing slot when there is a point in asking, and
  // for an order the pilot holds no rule for there is none - the slot changes
  // nothing and the order will not be applied either way. Two moves asking the
  // same thing is how "Медсестра ждёт назначения: с какой скоростью?" came back
  // verbatim three turns later in the live run of 20.08.2026.
  const parameterBlockedActionIds = new Set(
    (plan.parameterSafetySignals || [])
      .filter((signal) => signal.blocks_application)
      .map((signal) => signal.concept_id)
  );
  const incompleteOrders = (plan.operationalizationStates || []).filter(
    (state) =>
      state &&
      !state.complete &&
      state.missing?.length &&
      !parameterBlockedActionIds.has(state.action_id)
  );
  if (incompleteOrders.length) {
    moves.push({
      type: MENTOR_MOVE.OPERATIONALIZATION,
      issue_id: `operationalization:${incompleteOrders
        .map((state) => state.action_id)
        .join("+")}`,
      severity: 3,
      hint_level: 1,
      safety_critical: false,
      why_now: "order_named_but_not_specified",
      reasoning_gap: null,
      relevant_to_current_turn: true,
      action_ids: incompleteOrders.map((state) => state.action_id),
      missing_slots: incompleteOrders.map((state) => ({
        action_id: state.action_id,
        missing: state.missing,
      })),
      template: operationalizationQuestion(incompleteOrders),
      evidence: [],
    });
  }

  // A fragment the router could not map is a conversation problem, not a
  // clinical one. The engine no longer answers it with "Не распознано"; the
  // mentor does, in words. This move exists so the mentor has something named to
  // answer and so the deterministic fallback is not silent when the model is off.
  const unrecognizedFragments = [
    ...new Set(
      [
        ...(plan.parsed?.unresolvedFragments || []),
        ...(plan.parsed?.unresolvedByKind || [])
          .filter((entry) => entry.kind === "unrecognized_fragment")
          .map((entry) => entry.requested_fragment),
      ].filter(Boolean)
    ),
  ];
  if (unrecognizedFragments.length) {
    moves.push({
      type: MENTOR_MOVE.UNRECOGNIZED_FRAGMENT,
      issue_id: `unrecognized:${unrecognizedFragments.join("+")}`,
      severity: 2,
      hint_level: 1,
      safety_critical: false,
      why_now: "fragment_not_mapped_to_a_concept",
      reasoning_gap: null,
      relevant_to_current_turn: true,
      fragments: unrecognizedFragments,
      template: `${unrecognizedFragments
        .map((fragment) => `«${fragment}»`)
        .join(", ")} — не получается сопоставить с действием в этом кейсе. Скажи другими словами, что назначаешь.`,
      evidence: [],
    });
  }

  // A practice the region uses and the evidence base does not endorse. There is
  // no approved teaching rule for it yet, so the move carries no clinical claim
  // - it tells the mentor the practice was named and that nothing may be
  // asserted about it. See core/legacyPractices.js.
  const namedLegacyPractices = detectLegacyPractices(plan.input || "");
  if (namedLegacyPractices.length) {
    moves.push({
      type: MENTOR_MOVE.LEGACY_PRACTICE,
      issue_id: `legacy_practice:${namedLegacyPractices
        .map((practice) => practice.practice_id)
        .join("+")}`,
      severity: 2,
      hint_level: 1,
      safety_critical: false,
      why_now: "legacy_practice_named_by_learner",
      reasoning_gap: null,
      relevant_to_current_turn: true,
      legacy_practice_ids: namedLegacyPractices.map((practice) => practice.practice_id),
      template: `${namedLegacyPractices
        .map((practice) => practice.label_ru)
        .join(", ")}: назначение записано, но как одобренное действие не выполняется — отрецензированного правила по нему в тренажёре пока нет. Чем обосновываешь этот выбор?`,
      evidence: [],
    });
  }

  // Parameter review precedes ordinary pedagogy. This says only that the pilot
  // cannot validate/apply the order; it does not invent a correction.
  const stopsAlreadyDelivered = new Set(session.workingMemory?.firedHeuristicIds || []);
  const parameterStopKeys = [];
  for (const signal of plan.parameterSafetySignals || []) {
    if (!signal.blocks_application) continue;
    // Said once per order. A reviewed-unsafe verdict is exempt: that one is a
    // clinical stop and repeats for as long as the learner insists on it.
    const stopKey = parameterStopKey(signal);
    const reviewedUnsafe = isReviewedUnsafeParameter(signal);
    // Case 3 only: a parameter the pilot holds nothing about. The enumerated
    // high-risk classes keep stopping. See parameterSafety.js.
    const noReviewedContent = isGovernanceGapParameter(signal);
    if (!reviewedUnsafe && stopsAlreadyDelivered.has(stopKey)) {
      continue;
    }
    // Already answered in full: the engine records it and states why it is not
    // applied. Repeating the request here is the loop this replaced.
    if (
      (plan.operationalizationStates || []).some(
        (state) => state.action_id === signal.concept_id && state.complete
      )
    ) {
      continue;
    }
    moves.push({
      type: MENTOR_MOVE.PARAMETER_SAFETY,
      issue_id: signal.source_rule_id || signal.governance_policy_id,
      severity: noReviewedContent ? 2 : 4,
      hint_level: 4,
      // An empty shelf is not danger. A missing rule keeps the order off the
      // patient just the same, but it must not be spoken in the register of
      // danger - unless the parameter belongs to a class the pilot enumerates as
      // high risk, which fails safe and still stops.
      safety_critical: !noReviewedContent,
      why_now: noReviewedContent
        ? "current_parameter_has_no_reviewed_rule"
        : "current_parameter_requires_review",
      reasoning_gap: null,
      relevant_to_current_turn: true,
      // When the order is still half-stated, the note asks for the missing part
      // rather than for something the learner was never asked for.
      template: (() => {
        const incomplete = (plan.operationalizationStates || []).find(
          (state) => state.action_id === signal.concept_id && !state.complete
        );
        const question = incomplete && !noReviewedContent
          ? operationalizationQuestion([incomplete])
          : "";
        if (!noReviewedContent) {
          if (question) {
            return `Стоп. Это назначение пока нельзя выполнить: оно названо не полностью. ${question}`;
          }
          return reviewedUnsafe
            ? "Стоп. Этот параметр отклонён отрецензированным правилом безопасности и не применён. Как пересмотришь его?"
            : "Стоп. Это назначение требует клинической проверки и пока не применено. Что станет условием немедленного пересмотра плана?";
        }
        return "Это назначение записано. Отрецензированного правила под него в пилоте нет, поэтому эффект не моделируется. Что делаешь дальше по плану?";
      })(),
      parameter_safety: signal,
      clinical_rule_ids: signal.source_rule_id ? [signal.source_rule_id] : [],
      fired_key: stopKey,
      evidence: [],
    });
    parameterStopKeys.push(stopKey);
  }

  // 1. Prerequisite stops. This is the "система говорила стоп" behaviour.
  const stops = [];
  for (const warning of plan.prerequisiteWarnings || []) {
    if (!attempted.has(warning.action_id)) continue;
    const meta = prerequisiteMeta(caseData, warning.action_id, warning.missing);
    stops.push({
      type: MENTOR_MOVE.PREREQUISITE_STOP,
      action_id: warning.action_id,
      missing_action_id: warning.missing,
      severity: meta.severity,
      safety_critical: meta.severity === "blocking",
      why_now: "current_prerequisite_block",
      relevant_to_current_turn: true,
      issue_id: meta.reason_id || `prerequisite:${warning.missing}`,
      reason_id: meta.reason_id,
      template: PREREQUISITE_TEMPLATES[meta.reason_id] || PREREQUISITE_FALLBACK,
      evidence: evidenceFor(caseData, warning.missing),
    });
  }

  // A supervisor names the highest-priority block, not a checklist all at once.
  const blockingStops = stops.filter((stop) => stop.severity === "blocking");
  const shownStops = blockingStops.length > 0 ? blockingStops.slice(0, 1) : stops.slice(0, 1);
  moves.push(...shownStops);
  const stoppedActionIds = new Set(shownStops.map((stop) => stop.action_id));

  // 2. Escalation, judged in context rather than rewarded flatly.
  for (const actionId of ESCALATION_ACTION_IDS) {
    if (!performed.has(actionId)) continue;
    const verdict = escalationVerdict(caseData, session, actionId, minimumAssessment);
    if (!verdict) continue;
    moves.push({
      type: verdict.appropriate
        ? MENTOR_MOVE.ESCALATION_APPROPRIATE
        : MENTOR_MOVE.ESCALATION_PREMATURE,
      action_id: actionId,
      missing_before_escalation: verdict.missing,
      minimum_assessment_declared: verdict.barDeclared,
      template: verdict.appropriate
        ? verdict.policy.appropriate_feedback
        : verdict.policy.premature_feedback,
      evidence: evidenceFor(caseData, actionId),
    });
  }

  // 3. Declared uncertainty is recorded as learner reasoning, not automatically
  // reinforced. Likewise, a library content gap belongs to the addressed
  // patient/environment reply and audit log, never to the mentor praise queue.

  // 4. Resource wall. The deterministic layer already printed what is
  //    unavailable; the mentor turns it into a decision, not a dead end.
  for (const operation of deterministicUpdate.blockedOperations || []) {
    // Already covered by a prerequisite stop for the same action: one reason is
    // enough, and the prerequisite is the more specific one.
    if (stoppedActionIds.has(operation.action_id)) continue;
    moves.push({
      type: MENTOR_MOVE.RESOURCE_BLOCKED,
      action_id: operation.action_id,
      template: "Ресурс недоступен. Что меняешь в плане, исходя из того, что есть?",
      evidence: [],
    });
  }

  // 5. What is NOT happening. See mentorHeuristics.js.
  //
  // Yields to a blocking stop: when the operation is being attempted without
  // consent, that is the only thing worth saying this turn.
  const firedHeuristicKeys = [];
  if (blockingStops.length === 0) {
    const selected = selectHeuristics({
      caseData,
      session,
      attempted,
      alreadyFired: session.workingMemory?.firedHeuristicIds || [],
      currentTurn: plan.turnKind
        ? {
            previousIssueId: session.workingMemory?.pendingMentorQuestion?.issue_id || null,
            pathState: session.pathState,
            topic: (plan.actions || []).some((action) => action.intent_type === "request_test")
              ? "investigations"
              : (plan.actions || []).some((action) => action.intent_type === "management") ||
                  (plan.managementDecisions || []).length
                ? "management"
                : plan.parsed?.reasoning
                  ? "reasoning"
                  : "unknown",
          }
        : null,
      limit: 5,
    });
    const status = session.temporalState?.status || "stable";
    for (const heuristic of selected) {
      const heuristicFiredKey = heuristic.fired_key || firedKey(heuristic, { status });
      firedHeuristicKeys.push(heuristicFiredKey);
      moves.push({
        type: MENTOR_MOVE[heuristic.type.toUpperCase()] || heuristic.type,
        heuristic_id: heuristic.id,
        issue_id: heuristic.id,
        severity: heuristic.severity,
        hint_level: heuristic.hint_level,
        lifecycle: heuristic.lifecycle || null,
        standing_risk_stage: heuristic.standing_risk_stage || null,
        spec_section: heuristic.spec_section,
        template:
          plan.mentorAnswer?.answered_contract && heuristic.lifecycle === "standing_risk"
            ? `Ответ зафиксирован. ${heuristic.mentor_line}`
            : heuristic.mentor_line,
        provenance: heuristic.provenance,
        why_now: heuristic.why_now,
        reasoning_gap: heuristic.id,
        // What an answer to this rule's question looks like. Declared on the
        // rule so the interpreter that has to recognise the answer and the
        // question that provokes it cannot drift apart.
        expected_answer_domains: heuristic.expected_answer_domains || [],
        safety_critical: heuristic.severity === 4,
        relevant_to_current_turn: true,
        evidence: [],
        fired_key: heuristicFiredKey,
      });
    }
  }

  // Silence when there is nothing to say.
  //
  // Asked whether "Что делаешь дальше?" every turn beats saying nothing, the
  // author's answer was "пусть молчит лучше когда нечего сказать" - and
  // SURGICAL_MENTOR_LOGIC.md section 19 says the same: do not stop the learner
  // for every imperfect phrase. So the mentor produces no text at all, and the
  // engine keeps its own operational prompt instead of having it replaced.
  moves.sort((left, right) => {
    if (Boolean(left.safety_critical) !== Boolean(right.safety_critical)) {
      return left.safety_critical ? -1 : 1;
    }
    if (left.standing_risk_stage !== right.standing_risk_stage) {
      if (left.standing_risk_stage === "irreversible_gate") return -1;
      if (right.standing_risk_stage === "irreversible_gate") return 1;
    }
    // A result of the learner's current action (including a well-timed call
    // for help) is answered before an older open risk. Otherwise a persistent
    // risk can crowd the actual conversation out of the five-item menu. The
    // irreversible gate above remains the deliberate exception.
    const leftCurrentEvent = left.heuristic_id ? 0 : 1;
    const rightCurrentEvent = right.heuristic_id ? 0 : 1;
    if (leftCurrentEvent !== rightCurrentEvent) return rightCurrentEvent - leftCurrentEvent;
    const severityDifference = Number(right.severity || 0) - Number(left.severity || 0);
    if (severityDifference) return severityDifference;
    return 0;
  });
  let candidateIssues = moves.slice(0, 5).map((move) => ({
    issue_id: move.issue_id || move.heuristic_id || move.type,
    type: move.type,
    severity: move.severity || null,
    hint_level: move.hint_level || null,
    lifecycle: move.lifecycle || null,
    standing_risk_stage: move.standing_risk_stage || null,
    why_now: move.why_now || "current_turn_event",
    reasoning_gap: move.reasoning_gap || null,
    safety_critical: Boolean(move.safety_critical),
    relevant_to_current_turn: move.relevant_to_current_turn !== false,
    evidence: move.evidence || [],
    expected_answer_domains: move.expected_answer_domains || [],
    fallback_text: move.template || null,
    parameter_safety: move.parameter_safety || null,
    clinical_rule_ids: move.clinical_rule_ids || [],
    fired_key: move.fired_key || null,
  }));
  const positiveTypes = new Set([
    MENTOR_MOVE.ESCALATION_APPROPRIATE,
    "reasoning_reinforcement",
    "contingency_acknowledged",
  ]);
  const adequacyAssessment = plan.adequacyAssessment || {
    adequacy:
      moves.length === 0 || moves.every((move) => positiveTypes.has(move.type))
        ? ADEQUACY.SUFFICIENT
        : ADEQUACY.PARTIAL,
    reason: moves.length ? "legacy_candidate_issue" : "no_current_issue",
    expected_answer_domains: [],
    safety_critical: moves.some((move) => move.safety_critical),
    governance_stop: false,
    consultation_preserved: false,
  };
  const rememberedScaffold = session.workingMemory?.mentorScaffoldingState;
  const previousTeachingExchange =
    plan.pendingMentorQuestionBeforeTurn ||
    session.workingMemory?.pendingMentorQuestion ||
    (rememberedScaffold?.issue_id
      ? {
          issue_id: rememberedScaffold.issue_id,
          expects: rememberedScaffold.expected_answer_domains || [],
          scaffolding_level: rememberedScaffold.scaffolding_level || 0,
        }
      : null);
  const mentorPolicy = selectMentorPolicy({
    assessment: adequacyAssessment,
    candidateIssues,
    previousQuestion: previousTeachingExchange,
  });
  if (
    mentorPolicy.issue_id &&
    !candidateIssues.some((issue) => issue.issue_id === mentorPolicy.issue_id)
  ) {
    const issue = mentorPolicy.selected_issue || {};
    candidateIssues = [
      {
        issue_id: mentorPolicy.issue_id,
        type: issue.type || "current_decision",
        severity: issue.severity || null,
        hint_level: mentorPolicy.scaffolding_level,
        lifecycle: issue.lifecycle || null,
        standing_risk_stage: issue.standing_risk_stage || null,
        why_now: mentorPolicy.why_now,
        reasoning_gap: null,
        safety_critical: mentorPolicy.safety_critical,
        relevant_to_current_turn: true,
        evidence: [],
        fallback_text: mentorPolicy.fallback_text,
        parameter_safety: null,
        clinical_rule_ids: mentorPolicy.allowed_clinical_rule_ids,
        fired_key: null,
      },
      ...candidateIssues,
    ].slice(0, 5);
  }
  candidateIssues = candidateIssues.map((issue) =>
    issue.issue_id === mentorPolicy.issue_id
      ? {
          ...issue,
          fallback_text: mentorPolicy.fallback_text,
          hint_level: mentorPolicy.scaffolding_level,
        }
      : issue
  );
  const selectedMove = mentorPolicy.issue_id
    ? moves.find(
        (move) =>
          (move.issue_id || move.heuristic_id || move.type) === mentorPolicy.issue_id
      )
    : null;
  const focusedMoves = mentorPolicy.mode === MENTOR_MODE.CONTINUE
    ? []
    : [
        {
          ...(selectedMove || mentorPolicy.selected_issue || {}),
          issue_id: mentorPolicy.issue_id,
          type: selectedMove?.type || mentorPolicy.selected_issue?.type || "current_decision",
          template: mentorPolicy.fallback_text,
        },
      ];
  const silent = mentorPolicy.mode === MENTOR_MODE.CONTINUE;

  // Live suppression must not erase educational information. Re-evaluate the
  // accumulated state without the live-turn relevance gate and carry those
  // gaps to the debrief archive only.
  const debriefOnlyIssues = selectHeuristics({
    caseData,
    session,
    attempted,
    alreadyFired: [],
    currentTurn: null,
    limit: 100,
  })
    .filter(
      (heuristic) =>
        heuristic.severity !== 4 && heuristic.id !== mentorPolicy.issue_id
    )
    .map((heuristic) => ({
      issue_id: heuristic.id,
      type: heuristic.type,
      why_deferred: "not_selected_for_live_teaching",
      first_observed_turn: session.workingMemory?.turnNumber || 0,
    }));

  // What the deterministic layer already did this turn, by name only.
  //
  // Without this the mentor sees the learner's message and a bare "что дальше?"
  // and reconstructs the rest: asked for an examination, so it answers "начинай
  // с осмотра" - telling the learner to do the very thing whose results are
  // printed directly above the mentor's own reply.
  //
  // Concept labels are action metadata, not patient data, so naming them here
  // does not weaken the no-facts invariant.
  const justPerformed = [...performed]
    .map((actionId) => {
      const action = getCaseAction(caseData, actionId);
      return action ? { action_id: actionId, concept: action.concept || actionId } : null;
    })
    .filter(Boolean);
  const revealedFacts = buildRevealedMentorFacts(caseData, session, justPerformed);
  const learnerTurns = (session.messages || [])
    .filter((message) => message.role === "user")
    .map((message) => String(message.content || ""));
  // The model may choose among current candidate issues, but it does not need
  // the entire clinical registry to do that. Only rules explicitly attached to
  // one of those candidates enter the turn; this bounds clinical content while
  // leaving the wording free.
  const candidateRuleIds = new Set(
    candidateIssues.flatMap((issue) => issue.clinical_rule_ids || [])
  );
  const candidateApprovedTeachingRules = CLINICAL_RULE_REGISTRY.filter(
    (rule) =>
      candidateRuleIds.has(rule.rule_id) &&
      ruleAllowsRuntimeEffect(rule, CLINICAL_RUNTIME_EFFECT.MENTOR_TEACHING)
  );
  const candidateApprovedDosingRules = approvedDosingRules().filter((rule) =>
    candidateRuleIds.has(rule.rule_id)
  );
  const legacyPracticesNamed = detectLegacyPractices(plan.input || "").map(
    legacyPracticeBriefEntry
  );

  return {
    moves: focusedMoves,
    candidateIssues,
    mentorPolicy: {
      policy_version: mentorPolicy.policy_version,
      mode: mentorPolicy.mode,
      adequacy: mentorPolicy.adequacy,
      priority: mentorPolicy.priority,
      issue_id: mentorPolicy.issue_id,
      why_now: mentorPolicy.why_now,
      scaffolding_level: mentorPolicy.scaffolding_level,
      expected_answer_domains: mentorPolicy.expected_answer_domains,
      question_domain: mentorPolicy.question_domain,
      allowed_clinical_rule_ids: mentorPolicy.allowed_clinical_rule_ids,
      safety_critical: mentorPolicy.safety_critical,
      governance_stop: mentorPolicy.governance_stop,
      consultation_preserved: mentorPolicy.consultation_preserved,
      reasoning_sufficient_to_advance: mentorPolicy.reasoning_sufficient_to_advance,
    },
    approvedTeachingRules: candidateApprovedTeachingRules,
    // Named by the selected issue. Kept separate so the debrief and the
    // telemetry can still say which rule the deterministic policy pointed at.
    issueScopedTeachingRules: mentorPolicy.approved_teaching_rules || [],
    // Signed dosing rules, projected to what the mentor is allowed to know.
    //
    // The full registry row also carries governance metadata - score_weight,
    // review signatures - and the Kazakhstan formulary divergence. None of that
    // belongs in the mentor's context. Scoring fields are the answer key, which
    // this brief withholds by contract; the KNF regimen is debrief material, and
    // a mentor holding both regimens at once is a mentor one step from telling a
    // resident which of the two is wrong (see MENTOR_JURISDICTION_RULE).
    approvedDosingRules: candidateApprovedDosingRules.map((rule) => ({
      rule_id: rule.rule_id,
      agent: rule.agent,
      indication: rule.indication,
      dose: rule.dose,
      route: rule.route,
      timing: rule.timing,
      adjustments: rule.adjustments || [],
      source_ids: rule.source_ids,
      review_status: rule.review_status,
    })),
    legacyPracticesNamed,
    deferredIssues: debriefOnlyIssues,
    justPerformed,
    engineReplyText: String(engineReplyText || ""),
    learnerReasoning: learnerReasoning(session.workingMemory?.reasoningState),
    reasoningDeltaThisTurn: plan.parsed?.reasoning || null,
    accumulatedReasoningState: session.workingMemory?.reasoningState || null,
    recentDialogue: (session.messages || []).slice(-6),
    // The whole session, not a window on it. Closing a prerequisite with what
    // the learner already said requires having read what they said.
    transcript: (session.messages || []).map((message) => ({
      role: message.role,
      content: message.content,
    })),
    learnerTurns,
    caseCard: buildMentorCaseCard(caseData, session),
    learnerAddressForm: resolveLearnerAddressForm({
      sessionSetting: session.learnerAddressForm || null,
      learnerTurns,
    }).form,
    // Fragments the router could not map. The mentor answers them in words; the
    // engine still refuses to execute them. See engine.js.
    unrecognizedFragments: [
      ...new Set([
        ...(plan.parsed?.unresolvedFragments || []),
        ...(plan.parsed?.unresolvedByKind || [])
          .filter((entry) => entry.kind === "unrecognized_fragment")
          .map((entry) => entry.requested_fragment),
      ].filter(Boolean)),
    ],
    previousMentorIntervention: session.workingMemory?.lastMentorIntervention || null,
    previousMentorQuestionContract:
      plan.pendingMentorQuestionBeforeTurn || session.workingMemory?.pendingMentorQuestion || null,
    // How many turns the mentor's outstanding question has gone unanswered.
    // The contract survives in working memory until the learner answers it, so
    // this counts persistence, not curiosity. Live run 21.08.2026: the same
    // question - why the operative access changed - was put four turns running,
    // never answered, and the case never moved. Three good questions in a row
    // are worse than one good question and then teaching the answer.
    recentMentorQuestions: session.workingMemory?.recentMentorQuestions || [],
    probingStreak: session.workingMemory?.probingStreak || 0,
    unansweredQuestionTurns: (() => {
      const asked = (
        plan.pendingMentorQuestionBeforeTurn || session.workingMemory?.pendingMentorQuestion || null
      )?.asked_turn;
      const now = session.workingMemory?.turnNumber || 0;
      return asked ? Math.max(0, now - asked) : 0;
    })(),
    safetyFlags: plan.parameterSafetySignals || [],
    simulatorProducedResults: Boolean(simulatorProducedResults),
    silent,
    // The engine folds these into working memory so a heuristic speaks once per
    // session. A supervisor who repeats the same remark every turn stops being
    // heard after the second time. Deterioration re-arms; see firedKey.
    firedHeuristicKeys: focusedMoves
      .map((move) => move.fired_key)
      .filter(
        (key) => key && (firedHeuristicKeys.includes(key) || parameterStopKeys.includes(key))
      ),
    resultsAlreadyDelivered: (deterministicUpdate.findingsRevealed || []).length > 0,
    factsContract: "revealed_only",
    revealedFacts,
    allowedFactSourceIds: revealedFacts.map((fact) => fact.source_id),
    turnNumber: session.workingMemory?.turnNumber || 0,
    phase: session.phase,
    pathState: session.pathState || null,
    locale: session.locale || "ru",
  };
}

/**
 * Deterministic rendering. This is the fallback when no mentor LLM is
 * configured, and the reference text the LLM is asked to rephrase rather than
 * replace. The trainer is never mute, with or without a model.
 */
export function renderMentorBrief(brief) {
  return brief.moves
    .map((move) => move.template)
    .filter(Boolean)
    .join("\n\n");
}
