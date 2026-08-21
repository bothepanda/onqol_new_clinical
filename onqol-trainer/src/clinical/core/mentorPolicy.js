import {
  CLINICAL_RUNTIME_EFFECT,
  approvedRulesForEffect,
} from "../governance/clinicalGovernance.js";
import {
  isGovernanceGapParameter,
  isReviewedUnsafeParameter,
} from "./parameterSafety.js";

export const MENTOR_POLICY_VERSION = "mentor-policy-v3.0";

export const ADEQUACY = Object.freeze({
  SUFFICIENT: "SUFFICIENT",
  PARTIAL: "PARTIAL",
  VAGUE: "VAGUE",
  STUCK: "STUCK",
  EVASIVE: "EVASIVE",
  UNSAFE: "UNSAFE",
});

export const MENTOR_MODE = Object.freeze({
  CONTINUE: "CONTINUE",
  REINFORCE: "REINFORCE",
  CLARIFY: "CLARIFY",
  CHALLENGE: "CHALLENGE",
  TEACH: "TEACH",
  SAFETY_STOP: "SAFETY_STOP",
});

/**
 * The severity from which a gap is worth interrupting a learner who is otherwise
 * moving forward. Mirrors SEVERITY.IMPORTANT_OMISSION in mentorHeuristics.js;
 * it is a number here because the policy receives issues as brief data, not as
 * heuristic objects.
 */
const TEACHABLE_SEVERITY = 3;

export const SCAFFOLDING_LEVEL = Object.freeze({
  NONE: 0,
  PROMPT: 1,
  CUE: 2,
  OPTIONS: 3,
  EXPLANATION: 4,
});

const GENUINE_UNCERTAINTY_RE =
  /(?:^|[^а-яё])(не\s+знаю|не\s+помню|не\s+уверен(?:а)?|затрудняюсь|не\s+могу\s+решить)(?:$|[^а-яё])/iu;
const EVASION_RE =
  /(утром\s+старш|старш(?:ие|ий|ая)\s+(?:пусть\s+)?(?:разбер|реш)|это\s+(?:реаниматолог|анестезиолог|друг(?:ой|ие)\s+врач)|пусть\s+(?:друг|реаниматолог|старш)|не\s+моя\s+задача|не\s+мне\s+решать)/iu;
const VAGUE_MOVE_RE =
  /^(?:я\s+)?(?:смотрю|осматриваю|наблюдаю|готовим|проверяю)(?:\s+(?:пациент(?:а|ку)|живот))?[.!]?$/iu;
const OPERATIVE_SEQUENCE_RE =
  /лапаротом\w*.*(?:ревизи\w*|санaци\w*|санаци\w*)|ревизи\w*.*санаци\w*/iu;

function words(text) {
  return String(text || "").trim().split(/\s+/u).filter(Boolean);
}

function expectedDomainsFromPending(pending) {
  return Array.isArray(pending?.expects)
    ? [...new Set(pending.expects.filter((item) => typeof item === "string"))]
    : [];
}

/**
 * Identity of a parameter stop, for "say it once".
 *
 * A governance stop - "the pilot has no reviewed rule for this parameter" -
 * carries no answer the learner can give. Delivering it a second time for the
 * same order is the loop that ended replay 91ba7206 on turn 7, where the
 * learner pasted her preparation again and got the same sentence back. The key
 * includes the verbatim, so a CHANGED order is a new stop and re-arms.
 */
export function parameterStopKey(signal) {
  return [
    "parameter_safety",
    signal?.concept_id || "unknown",
    signal?.source_rule_id || signal?.governance_policy_id || "unknown",
    (signal?.verbatim || "").trim().toLowerCase(),
  ].join(":");
}

function blockedParameterAssessment(signals, plan, session) {
  const alreadyDelivered = new Set(session?.workingMemory?.firedHeuristicIds || []);
  const blocked = (signals || []).find(
    (signal) =>
      signal.blocks_application &&
      // A reviewed-unsafe verdict repeats for as long as the learner insists.
      // A governance stop is stated once; see parameterStopKey.
      (isReviewedUnsafeParameter(signal) || !alreadyDelivered.has(parameterStopKey(signal)))
  );
  if (!blocked) return null;
  // The order is fully stated and the pilot still cannot validate it. The engine
  // says so once; the mentor must not ask for the same parameters again, which
  // is what turned replay b9d7a831 into a loop the learner walked out of.
  const stated = (plan?.operationalizationStates || []).find(
    (state) => state.action_id === blocked.concept_id
  );
  if (stated?.complete) return null;
  const reviewedUnsafe = isReviewedUnsafeParameter(blocked);
  // A parameter the pilot holds NO content for is not danger, and a mentor put
  // into SAFETY_STOP for it says "Стоп" and "не прошли проверку" about an order
  // nobody objected to. An enumerated high-risk parameter still stops even
  // unreviewed: the pilot cannot tell 20 ml/kg from 200, so it fails safe. See
  // parameterSafety.js for the three classes. Application to the patient is
  // decided by blocks_application in the engine and is unchanged either way.
  const noReviewedContent = isGovernanceGapParameter(blocked);
  return {
    adequacy: reviewedUnsafe ? ADEQUACY.UNSAFE : ADEQUACY.PARTIAL,
    reason: reviewedUnsafe
      ? "approved_safety_rule_rejected_parameter"
      : "high_risk_parameter_not_yet_reviewed",
    expected_answer_domains: ["treatment_parameter"],
    safety_critical: !noReviewedContent,
    governance_stop: !reviewedUnsafe,
    consultation_preserved: false,
  };
}

/**
 * Classify only whether the current response is adequate for the current
 * decision. It records no patient fact and validates no medical claim.
 */
export function classifyLearnerAdequacy({ learnerText, plan, session }) {
  const text = String(learnerText || "").trim();
  const pending = plan.pendingMentorQuestionBeforeTurn || session?.workingMemory?.pendingMentorQuestion;
  const parameterAssessment = blockedParameterAssessment(plan.parameterSafetySignals, plan, session);
  if (parameterAssessment) return parameterAssessment;
  // A REVIEWED safety verdict re-arms until it is answered. A governance stop -
  // "the pilot has no reviewed rule for this parameter" - does not: it is stated
  // once and the case moves on. Re-arming it is what turned replay 91ba7206
  // into a loop demanding the learner revise a parameter against a rule that
  // does not exist, and there is no answer that can satisfy it.
  if (
    pending?.safety_critical &&
    !pending?.governance_stop &&
    !plan.mentorAnswer?.answered_contract
  ) {
    return {
      adequacy: ADEQUACY.PARTIAL,
      reason: "unresolved_safety_stop",
      expected_answer_domains: expectedDomainsFromPending(pending),
      safety_critical: true,
      governance_stop: Boolean(pending.governance_stop),
      consultation_preserved: false,
    };
  }

  if (EVASION_RE.test(text)) {
    return {
      adequacy: ADEQUACY.EVASIVE,
      reason: "ownership_deferred_to_other_team",
      expected_answer_domains: ["immediate_actions", "ownership"],
      safety_critical: false,
      governance_stop: false,
      consultation_preserved: true,
    };
  }

  if (GENUINE_UNCERTAINTY_RE.test(text)) {
    return {
      adequacy: ADEQUACY.STUCK,
      reason: "explicit_genuine_uncertainty",
      expected_answer_domains: expectedDomainsFromPending(pending).length
        ? expectedDomainsFromPending(pending)
        : ["current_decision"],
      safety_critical: false,
      governance_stop: false,
      consultation_preserved: false,
    };
  }

  if (VAGUE_MOVE_RE.test(text)) {
    return {
      adequacy: ADEQUACY.VAGUE,
      reason: "move_not_operationalized",
      expected_answer_domains: ["action_scope"],
      safety_critical: false,
      governance_stop: false,
      consultation_preserved: false,
    };
  }

  if (
    OPERATIVE_SEQUENCE_RE.test(text) &&
    ["decision", "preop", "operation", "management"].includes(
      session?.pathState || session?.phase
    )
  ) {
    return {
      adequacy: ADEQUACY.PARTIAL,
      reason: "operative_plan_needs_one_current_detail",
      expected_answer_domains: ["operative_objective"],
      safety_critical: false,
      governance_stop: false,
      consultation_preserved: false,
    };
  }

  // An unspecified order is asked about, not held against the learner: the
  // question is operational, and the reasoning behind the plan may be perfectly
  // adequate. Only the operative approach, where the choice itself is the
  // reasoning, still degrades adequacy.
  if (
    (plan.operations || []).some(
      (operation) =>
        operation.needsOperationalization &&
        ["appendectomy_here", "appendectomy_procedure_start"].includes(operation.action_id)
    )
  ) {
    // The domains name the slots the team is actually waiting for, so the next
    // turn is routed as an answer to them rather than as fresh unrecognised text.
    const missingSlots = [
      ...new Set(
        (plan.operationalizationStates || [])
          .filter((state) => state && !state.complete)
          .flatMap((state) => state.missing || [])
      ),
    ];
    return {
      adequacy: ADEQUACY.PARTIAL,
      reason: "action_needs_operationalization",
      expected_answer_domains: missingSlots.length ? missingSlots : ["operative_approach"],
      safety_critical: false,
      governance_stop: false,
      consultation_preserved: false,
    };
  }

  if (plan.mentorAnswer?.answered_contract) {
    const specificity = plan.parsed?.reasoning?.contingency?.specificity;
    if (["vague", "partial"].includes(specificity)) {
      return {
        adequacy: ADEQUACY.PARTIAL,
        reason: `mentor_answer_${specificity}`,
        expected_answer_domains: expectedDomainsFromPending(pending),
        safety_critical: false,
        governance_stop: false,
        consultation_preserved: false,
      };
    }
    return {
      adequacy: ADEQUACY.SUFFICIENT,
      reason: "mentor_question_fulfilled",
      expected_answer_domains: expectedDomainsFromPending(pending),
      safety_critical: false,
      governance_stop: false,
      consultation_preserved: false,
    };
  }

  const hasSafeAction = (plan.operations || []).some(
    (operation) => operation.commitment !== "proposed"
  );
  const hasDecision = (plan.managementDecisions || []).length > 0;
  const hasReasoning = Boolean(plan.parsed?.reasoning);
  const isPatientQuestion = plan.turnKind?.semantic_kind === "patient_question";
  if (hasSafeAction || hasDecision || hasReasoning || isPatientQuestion) {
    return {
      adequacy: ADEQUACY.SUFFICIENT,
      reason: hasSafeAction
        ? "safe_current_action_is_executable"
        : hasDecision
          ? "current_management_decision_is_expressed"
          : hasReasoning
            ? "current_reasoning_is_expressed"
            : "patient_question_is_interpretable",
      expected_answer_domains: [],
      safety_critical: false,
      governance_stop: false,
      consultation_preserved: false,
    };
  }

  return {
    adequacy: ADEQUACY.VAGUE,
    reason: words(text).length <= 5 ? "low_information_current_move" : "unresolved_current_move",
    expected_answer_domains: ["current_decision"],
    safety_critical: false,
    governance_stop: false,
    consultation_preserved: false,
  };
}

function defaultIssueForAssessment(assessment, previousQuestion) {
  const previousIssueId = previousQuestion?.issue_id || null;
  switch (assessment.adequacy) {
    case ADEQUACY.STUCK:
      return {
        issue_id: previousIssueId || "learner_stuck_current_decision",
        type: "knowledge_gap",
        severity: 2,
        why_now: "explicit_uncertainty_this_turn",
        safety_critical: false,
        expected_answer_domains: assessment.expected_answer_domains,
      };
    case ADEQUACY.EVASIVE:
      return {
        issue_id: "restore_immediate_ownership",
        type: "ownership_deflection",
        severity: 3,
        why_now: "ownership_deferred_this_turn",
        safety_critical: false,
        expected_answer_domains: assessment.expected_answer_domains,
      };
    case ADEQUACY.VAGUE:
      return {
        issue_id: previousIssueId || "operationalize_current_move",
        type: "vague_current_move",
        severity: 2,
        why_now: "current_move_not_interpretable",
        safety_critical: false,
        expected_answer_domains: assessment.expected_answer_domains,
      };
    case ADEQUACY.PARTIAL:
      return {
        issue_id: previousIssueId || "complete_current_decision",
        type: "partial_current_move",
        severity: 2,
        why_now: "one_current_detail_missing",
        safety_critical: Boolean(assessment.safety_critical),
        expected_answer_domains: assessment.expected_answer_domains,
      };
    default:
      return null;
  }
}

function sameConcept(previousQuestion, issue) {
  return Boolean(previousQuestion?.issue_id && previousQuestion.issue_id === issue?.issue_id);
}

function scaffoldingFor(adequacy, previousQuestion, issue) {
  const previousLevel = Number(previousQuestion?.scaffolding_level || 0);
  const same = sameConcept(previousQuestion, issue);
  if (adequacy === ADEQUACY.SUFFICIENT) return Number(issue?.hint_level || 0);
  if (adequacy === ADEQUACY.UNSAFE) return 0;
  if (adequacy === ADEQUACY.EVASIVE) return SCAFFOLDING_LEVEL.PROMPT;
  if (adequacy === ADEQUACY.STUCK) {
    return Math.min(
      SCAFFOLDING_LEVEL.EXPLANATION,
      Math.max(SCAFFOLDING_LEVEL.CUE, same ? previousLevel + 1 : previousLevel || 2)
    );
  }
  if ([ADEQUACY.PARTIAL, ADEQUACY.VAGUE].includes(adequacy)) {
    return Math.min(
      SCAFFOLDING_LEVEL.OPTIONS,
      same ? Math.max(SCAFFOLDING_LEVEL.PROMPT, previousLevel + 1) : SCAFFOLDING_LEVEL.PROMPT
    );
  }
  return 0;
}

function modeFor(assessment, issue) {
  if (assessment.safety_critical || issue?.safety_critical) return MENTOR_MODE.SAFETY_STOP;
  if (assessment.adequacy === ADEQUACY.EVASIVE) return MENTOR_MODE.CHALLENGE;
  if (assessment.adequacy === ADEQUACY.STUCK) return MENTOR_MODE.TEACH;
  if ([ADEQUACY.PARTIAL, ADEQUACY.VAGUE].includes(assessment.adequacy)) {
    return MENTOR_MODE.CLARIFY;
  }
  if (assessment.adequacy === ADEQUACY.SUFFICIENT) {
    if (
      [
        "reasoning_reinforcement",
        "escalation_appropriate",
        "contingency_acknowledged",
      ].includes(issue?.type)
    ) {
      return MENTOR_MODE.REINFORCE;
    }
    // The same severity ladder the two branches below already use: an important
    // omission is pushed back on even when the turn itself was adequate, a
    // minor gap is not. Silence on a severity-3 gap is not neutral - the
    // learner reads an unanswered claim as an accepted one.
    return issue?.lifecycle === "standing_risk" || Number(issue?.severity || 0) >= TEACHABLE_SEVERITY
      ? MENTOR_MODE.CHALLENGE
      : MENTOR_MODE.CONTINUE;
  }
  return Number(issue?.severity || 0) >= TEACHABLE_SEVERITY
    ? MENTOR_MODE.CHALLENGE
    : MENTOR_MODE.CLARIFY;
}

function fallbackFor({ mode, assessment, issue, scaffoldingLevel, approvedTeachingRules }) {
  if (mode === MENTOR_MODE.CONTINUE) return "";
  if (mode === MENTOR_MODE.REINFORCE) {
    return issue?.fallback_text || "Текущий ход достаточно обоснован — продолжай вести пациента.";
  }
  if (mode === MENTOR_MODE.SAFETY_STOP) {
    if (assessment.governance_stop) {
      return "Стоп. Этот параметр не валидирован учебным контентом и не применён. Как пересмотришь параметр?";
    }
    return issue?.fallback_text || "Стоп. Этот элемент плана нужно пересмотреть до выполнения.";
  }
  // A gap in the content, in the register it belongs to. Not "стоп", not "не
  // прошло проверку": the order is recorded, the pilot has no reviewed rule to
  // model it against, and that is a statement about the content, not about the
  // learner. Reached only when the parameter is not one of the high-risk classes
  // that fail safe above.
  if (assessment.governance_stop) {
    return (
      issue?.fallback_text ||
      "Это назначение записано, но в пилоте нет отрецензированного правила под него, поэтому его эффект не моделируется. Что делаешь дальше по плану?"
    );
  }
  if (assessment.adequacy === ADEQUACY.EVASIVE) {
    return "Помощь команды уместна. Что необходимо сделать тебе до её прихода?";
  }
  if (assessment.adequacy === ADEQUACY.VAGUE) {
    return "Что именно хочешь оценить или выполнить сейчас?";
  }
  if (assessment.adequacy === ADEQUACY.PARTIAL) {
    if (assessment.reason === "operative_plan_needs_one_current_detail") {
      return "Какова конкретная цель этого оперативного шага?";
    }
    return issue?.fallback_text || "Какого одного элемента не хватает, чтобы этот план можно было выполнить?";
  }
  if (assessment.adequacy === ADEQUACY.STUCK) {
    if (scaffoldingLevel >= SCAFFOLDING_LEVEL.EXPLANATION && approvedTeachingRules.length) {
      return approvedTeachingRules[0].claim;
    }
    if (scaffoldingLevel >= SCAFFOLDING_LEVEL.OPTIONS) {
      return "Выбери направление: сначала безопасность, уточнение проблемы или немедленное действие. Что приоритетнее сейчас?";
    }
    return "Раздели задачу на три части: что опасно сейчас, чего не хватает для решения и что можно сделать немедленно. С чего начнёшь?";
  }
  return issue?.fallback_text || "Уточни текущую логику решения.";
}

/** Select one live teaching behavior. Candidate gaps remain available to debrief. */
export function selectMentorPolicy({
  assessment,
  candidateIssues = [],
  previousQuestion = null,
  ruleRegistry,
  sourceRegistry,
}) {
  const safetyIssue = candidateIssues.find((issue) => issue.safety_critical) || null;
  const reinforcingTypes = new Set([
    "reasoning_reinforcement",
    "escalation_appropriate",
    "contingency_acknowledged",
  ]);
  const positiveIssue = candidateIssues.find(
    (issue) => reinforcingTypes.has(issue.type) && issue.relevant_to_current_turn !== false
  );
  const currentIssue = candidateIssues.find(
    (issue) => issue.relevant_to_current_turn !== false
  );
  const synthetic = defaultIssueForAssessment(assessment, previousQuestion);
  const syntheticFirst = assessment.safety_critical || [
    ADEQUACY.STUCK,
    ADEQUACY.EVASIVE,
    ADEQUACY.VAGUE,
  ].includes(assessment.adequacy);
  // "Enough to move on" is not "nothing to teach". A resident who names a
  // diagnosis has expressed enough for the case to advance, and the turn is
  // scored SUFFICIENT for exactly that reason - but premature closure, an
  // unranked differential and an unexcluded dangerous alternative are all
  // conditions whose whole content is that naming it was not enough. Selecting
  // only reinforcement here is what let "о аппендицит определенно" pass with a
  // silent nod on turn 2 of a pregnancy-possible case.
  const teachableIssue = candidateIssues.find(
    (issue) =>
      issue.relevant_to_current_turn !== false &&
      !reinforcingTypes.has(issue.type) &&
      (issue.lifecycle === "standing_risk" || Number(issue.severity || 0) >= TEACHABLE_SEVERITY)
  );
  const issue = safetyIssue ||
    (assessment.adequacy === ADEQUACY.SUFFICIENT
      ? positiveIssue || teachableIssue
      : syntheticFirst
        ? synthetic || currentIssue
        : currentIssue || synthetic) ||
    null;
  const mode = modeFor(assessment, issue);
  const scaffoldingLevel = scaffoldingFor(assessment.adequacy, previousQuestion, issue);
  const requestedRuleIds = issue?.clinical_rule_ids || [];
  const approvedTeachingRules = approvedRulesForEffect(
    requestedRuleIds,
    CLINICAL_RUNTIME_EFFECT.MENTOR_TEACHING,
    ruleRegistry,
    sourceRegistry
  );
  const expectedAnswerDomains = [
    ...new Set([
      ...(issue?.expected_answer_domains || []),
      ...(assessment.expected_answer_domains || []),
    ]),
  ];
  const fallbackText = fallbackFor({
    mode,
    assessment,
    issue,
    scaffoldingLevel,
    approvedTeachingRules,
  });

  return {
    policy_version: MENTOR_POLICY_VERSION,
    mode,
    adequacy: assessment.adequacy,
    priority: safetyIssue || assessment.safety_critical
      ? "safety"
      : issue?.standing_risk_stage === "irreversible_gate"
        ? "standing_risk_gate"
        : issue?.lifecycle === "standing_risk"
          ? "standing_risk"
          : assessment.adequacy === ADEQUACY.EVASIVE
            ? "ownership"
            : assessment.adequacy === ADEQUACY.STUCK
              ? "current_learning_block"
              : assessment.adequacy === ADEQUACY.SUFFICIENT
                ? "advance"
                : "current_decision",
    issue_id: mode === MENTOR_MODE.CONTINUE ? null : issue?.issue_id || null,
    why_now: issue?.why_now || assessment.reason,
    scaffolding_level: scaffoldingLevel,
    expected_answer_domains: expectedAnswerDomains,
    question_domain:
      [MENTOR_MODE.CLARIFY, MENTOR_MODE.CHALLENGE, MENTOR_MODE.TEACH, MENTOR_MODE.SAFETY_STOP].includes(mode)
        ? expectedAnswerDomains[0] || null
        : null,
    allowed_clinical_rule_ids: approvedTeachingRules.map((rule) => rule.rule_id),
    approved_teaching_rules: approvedTeachingRules,
    safety_critical: mode === MENTOR_MODE.SAFETY_STOP,
    governance_stop: Boolean(assessment.governance_stop),
    consultation_preserved: Boolean(assessment.consultation_preserved),
    reasoning_sufficient_to_advance: assessment.adequacy === ADEQUACY.SUFFICIENT,
    fallback_text: fallbackText,
    selected_issue: issue,
  };
}
