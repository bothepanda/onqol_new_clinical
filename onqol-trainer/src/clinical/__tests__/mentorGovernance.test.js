import assert from "node:assert/strict";
import test from "node:test";

import { buildV35Case } from "../v35/createCase.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { planClinicalTurn } from "../v25/turnPlanner.js";
import {
  ADEQUACY,
  MENTOR_MODE,
  classifyLearnerAdequacy,
  selectMentorPolicy,
} from "../core/mentorPolicy.js";
import { reviewActionParameters } from "../core/parameterSafety.js";
import { validateMentorPayload } from "../core/mentorAgent.js";
import { buildMentorBrief } from "../core/mentorBrief.js";
import { buildEvidenceGroundedDebrief } from "../v25/debrief.js";
import {
  CLINICAL_RULE_REGISTRY,
  CLINICAL_RULE_STATUS,
  CLINICAL_RUNTIME_EFFECT,
  SOURCE_REGISTRY,
  approvedRulesForEffect,
  clinicalGovernanceReadiness,
  ruleAllowsRuntimeEffect,
  validateClinicalRule,
  validateSourceRegistry,
} from "../governance/clinicalGovernance.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";

const caseData = buildV35Case({
  seed: "mentor-governance",
  requestedPresetId: "APP-001",
}).caseData;

function routerOptions(router, extra = {}) {
  return {
    mentor: true,
    actionExtractorLLM: router,
    conceptMap: appendicitisRouterConceptMap,
    conceptRegistry: resolveConcept,
    ...extra,
  };
}

function routerPayload(payload) {
  return () => JSON.stringify({ intents: [], unresolved_fragments: [], ...payload });
}

function assessmentFor(text, overrides = {}) {
  const plan = {
    pendingMentorQuestionBeforeTurn: null,
    parameterSafetySignals: [],
    operations: [],
    managementDecisions: [],
    parsed: { reasoning: null },
    turnKind: { semantic_kind: "unknown" },
    ...overrides,
  };
  return classifyLearnerAdequacy({
    learnerText: text,
    plan,
    session: { phase: "management", pathState: "decision", workingMemory: {} },
  });
}

function approvedUnsafeFluidRule() {
  return {
    rule_id: "TEST-FLUID-001",
    module: "test_fixture",
    rule_type: "fluid_dose",
    claim: "Fixture rule for deterministic parameter classification.",
    conditions: [],
    exceptions: [],
    jurisdiction: "reference",
    resource_context: [],
    source_ids: ["WSES2025"],
    evidence_strength: "not_graded",
    review_status: CLINICAL_RULE_STATUS.APPROVED,
    risk_class: "high",
    reviewed_by: ["reviewer-a", "reviewer-b"],
    reviewed_at: "2026-08-13",
    next_review_due: "2027-08-13",
    supersedes: null,
    allowed_runtime_effects: [CLINICAL_RUNTIME_EFFECT.SAFETY_VERDICT],
    parameter_contract: {
      concept_ids: ["iv_fluids"],
      parameter: "volume_per_weight",
      unit: "ml/kg",
      safe_range: { min: 1, max: 100 },
      outside_verdict: "reviewed_unsafe",
    },
    tests: ["mentorGovernance.test.js"],
    legacy_v1: false,
  };
}

test("source and rule registries reject V1 authority and remain release gated", () => {
  assert.equal(validateSourceRegistry().ok, true);
  assert.equal(SOURCE_REGISTRY.some((source) => source.legacy_v1), false);
  const readiness = clinicalGovernanceReadiness();
  assert.equal(readiness.structurally_valid, true);
  // Twelve rules were approved on 19.08.2026 on two signatures, so the registry
  // is no longer the thing holding the learner release. What must stay true is
  // that every one of them carries two reviewers and teaches only: no rule in
  // this package may score, stop a simulation or override a learner.
  assert.equal(readiness.learner_release_ready, true);
  assert.deepEqual(readiness.pending_rule_ids, []);
  assert.equal(CLINICAL_RULE_REGISTRY.length, 12);
  for (const rule of CLINICAL_RULE_REGISTRY) {
    assert.equal(validateClinicalRule(rule).ok, true, rule.rule_id);
    assert.ok(rule.reviewed_by.length >= 2, rule.rule_id);
    assert.deepEqual(rule.allowed_runtime_effects, ["mentor_teaching"], rule.rule_id);
  }
});

test("only approved rules can receive an authoritative runtime effect", () => {
  const approved = approvedUnsafeFluidRule();
  assert.equal(validateClinicalRule(approved).ok, true);
  assert.equal(
    ruleAllowsRuntimeEffect(approved, CLINICAL_RUNTIME_EFFECT.SAFETY_VERDICT),
    true
  );
  const draft = {
    ...approved,
    rule_id: "TEST-DRAFT-001",
    review_status: CLINICAL_RULE_STATUS.DRAFT,
  };
  assert.equal(ruleAllowsRuntimeEffect(draft, CLINICAL_RUNTIME_EFFECT.SAFETY_VERDICT), false);
  assert.deepEqual(
    approvedRulesForEffect(
      [draft.rule_id],
      CLINICAL_RUNTIME_EFFECT.SAFETY_VERDICT,
      [draft]
    ),
    []
  );
});

test("unreviewed parameter is blocked without being silently called safe", () => {
  const result = reviewActionParameters(
    [{ concept_id: "iv_fluids", dose_value: 200, dose_unit: "мл/кг" }],
    "инфузия 200 мл/кг",
    ["iv_fluids"]
  );
  assert.equal(result.reviews[0].review_status, "not_yet_reviewed");
  assert.equal(result.reviews[0].safety_verdict, "not_yet_reviewed");
  assert.equal(result.reviews[0].source_rule_id, null);
  assert.equal(result.reviews[0].blocks_application, true);
});

test("approved unsafe parameter produces the deterministic UNSAFE classification", () => {
  const rule = approvedUnsafeFluidRule();
  const review = reviewActionParameters(
    [{ concept_id: "iv_fluids", dose_value: 200, dose_unit: "мл/кг" }],
    "инфузия 200 мл/кг",
    ["iv_fluids"],
    { clinicalRules: [rule] }
  ).reviews[0];
  assert.equal(review.safety_verdict, "reviewed_unsafe");
  const assessment = assessmentFor("инфузия 200 мл/кг", {
    parameterSafetySignals: [review],
  });
  assert.equal(assessment.adequacy, ADEQUACY.UNSAFE);
  assert.equal(assessment.safety_critical, true);
});

test("mentor cannot state content from a non-approved clinical rule", () => {
  const draft = {
    ...approvedUnsafeFluidRule(),
    rule_id: "TEST-DRAFT-TEACH-001",
    review_status: CLINICAL_RULE_STATUS.DRAFT,
    allowed_runtime_effects: [],
  };
  const brief = {
    candidateIssues: [{ issue_id: "current", safety_critical: false }],
    revealedFacts: [],
    approvedTeachingRules: [draft],
  };
  const result = validateMentorPayload(
    {
      mode: "CLARIFY",
      issue_id: "current",
      mentor_text: draft.claim,
      factual_claims: [
        { source_id: `clinical_rule.${draft.rule_id}`, text: draft.claim },
      ],
      question_domain: null,
    },
    brief,
    caseData,
    []
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "fact_source_not_allowed");

  const numeric = validateMentorPayload(
    {
      mode: "CLARIFY",
      issue_id: "current",
      mentor_text: "Ориентируйся на 30 мл/кг. Что дальше?",
      factual_claims: [
        { source_id: `clinical_rule.${draft.rule_id}`, text: "30 мл/кг" },
      ],
      question_domain: null,
    },
    brief,
    caseData,
    []
  );
  assert.equal(numeric.ok, false);
  assert.equal(numeric.reason, "fact_source_not_allowed");
});

test("unrelated rules never reach a mentor turn", () => {
  const brief = buildMentorBrief({
    caseData,
    session: createV25Session({ caseData, mode: "reference", seed: "governance" }),
    plan: { parsed: {} },
    deterministicUpdate: {},
  });
  assert.deepEqual(brief.approvedTeachingRules, []);
  for (const rule of brief.approvedTeachingRules) {
    assert.equal(
      ruleAllowsRuntimeEffect(rule, CLINICAL_RUNTIME_EFFECT.MENTOR_TEACHING),
      true,
      `${rule.rule_id} is not approved for mentor teaching`
    );
  }
});

test("adequacy distinguishes vague, stuck, evasive and partial responses", () => {
  assert.equal(assessmentFor("смотрю пациента").adequacy, ADEQUACY.VAGUE);
  assert.equal(assessmentFor("не знаю").adequacy, ADEQUACY.STUCK);
  const evasive = assessmentFor("это реаниматологи делают");
  assert.equal(evasive.adequacy, ADEQUACY.EVASIVE);
  assert.equal(evasive.consultation_preserved, true);
  assert.equal(
    assessmentFor("лапаротомия, ревизия, санация").adequacy,
    ADEQUACY.PARTIAL
  );
});

test("genuine uncertainty increases scaffolding while evasion restores ownership", () => {
  const pending = {
    issue_id: "current_management",
    expects: ["management"],
    scaffolding_level: 1,
  };
  const stuck = selectMentorPolicy({
    assessment: assessmentFor("не знаю", { pendingMentorQuestionBeforeTurn: pending }),
    candidateIssues: [],
    previousQuestion: pending,
  });
  assert.equal(stuck.mode, MENTOR_MODE.TEACH);
  assert.equal(stuck.scaffolding_level, 2);

  const evasive = selectMentorPolicy({
    assessment: assessmentFor("утром старшие разберутся"),
    candidateIssues: [],
  });
  assert.equal(evasive.mode, MENTOR_MODE.CHALLENGE);
  assert.equal(evasive.consultation_preserved, true);
  assert.match(evasive.fallback_text, /Помощь команды уместна/);
});

test("current safety always outranks a stale educational gap", () => {
  const policy = selectMentorPolicy({
    assessment: {
      adequacy: ADEQUACY.PARTIAL,
      reason: "high_risk_parameter_not_yet_reviewed",
      expected_answer_domains: ["treatment_parameter"],
      safety_critical: true,
      governance_stop: true,
    },
    candidateIssues: [
      {
        issue_id: "old_investigation_gap",
        type: "outstanding_priority",
        relevant_to_current_turn: false,
        safety_critical: false,
      },
      {
        issue_id: "GOV-PARAMETER-UNREVIEWED-001",
        type: "parameter_safety",
        relevant_to_current_turn: true,
        safety_critical: true,
      },
    ],
  });
  assert.equal(policy.mode, MENTOR_MODE.SAFETY_STOP);
  assert.equal(policy.issue_id, "GOV-PARAMETER-UNREVIEWED-001");
});

test("sufficient current reasoning is explicitly allowed to advance", async () => {
  const session = createV25Session({ caseData, mode: "reference", seed: "advance" });
  const plan = await planClinicalTurn({
    input: "рабочая версия аппендицит, внематочную исключаю",
    caseData,
    session,
    options: routerOptions(
      routerPayload({
        reasoning: {
          working_diagnosis: {
            stated: true,
            concept_id: "diagnosis_acute_appendicitis",
            uncertainty_stated: true,
          },
          differential: {
            stated: true,
            items: [
              { concept_id: "diagnosis_acute_appendicitis", rank: 1 },
              { concept_id: "differential_ectopic", rank: 2, dangerous: true },
            ],
          },
        },
      })
    ),
  });
  assert.equal(plan.adequacyAssessment.adequacy, ADEQUACY.SUFFICIENT);
  assert.equal(plan.reasoningSufficientToAdvance, true);
  assert.equal(plan.patientInteraction, false);
});

test("deferred live gaps remain visible in formative debrief", () => {
  const session = createV25Session({ caseData, mode: "reference", seed: "deferred" });
  session.workingMemory.deferredMentorIssues = [
    { issue_id: "checkpoint_problem_representation" },
    { issue_id: "no_contingency_plan" },
  ];
  const report = buildEvidenceGroundedDebrief({
    caseData,
    session,
    scoring: {
      eligibleForScoring: false,
      formativeDomains: [],
      reviewStatus: "formative_only",
    },
    knowledgeBase: { documents: [] },
  });
  assert.match(report.markdown, /Отложено для разбора/);
  assert.match(report.markdown, /Представление проблемы/);
  assert.match(report.markdown, /План на случай изменения ситуации/);
});

test("nine-turn behavioral regression preserves patient-first progression", async () => {
  const turns = [
    {
      text: "собираю анамнез и осматриваю живот",
      payload: {
        intents: [
          { type: "request_history", concept_id: "focused_history", confidence: 0.99 },
          { type: "request_examination", concept_id: "abdominal_exam", confidence: 0.99 },
        ],
      },
    },
    {
      text: "рабочая версия аппендицит, но исключаю внематочную; ОАК и ХГЧ",
      payload: {
        intents: [
          { type: "diagnosis", concept_id: "diagnosis_acute_appendicitis", confidence: 0.99 },
          { type: "diagnosis", concept_id: "differential_ectopic", confidence: 0.99 },
          { type: "request_test", concept_id: "cbc", confidence: 0.99 },
          { type: "request_test", concept_id: "pregnancy_test", confidence: 0.99 },
        ],
        reasoning: {
          working_diagnosis: {
            stated: true,
            concept_id: "diagnosis_acute_appendicitis",
            uncertainty_stated: true,
          },
          differential: {
            stated: true,
            ranked: true,
            has_dangerous_alternative: true,
            items: [
              { concept_id: "diagnosis_acute_appendicitis", rank: 1 },
              { concept_id: "differential_ectopic", rank: 2, dangerous: true },
            ],
          },
        },
      },
    },
    { text: "лапаротомия, ревизия, санация", payload: {} },
    {
      text: "инфузия 200 мл/кг",
      payload: {
        intents: [{ type: "management", concept_id: "iv_fluids", confidence: 0.99 }],
        action_parameters: [
          { concept_id: "iv_fluids", dose_value: 200, dose_unit: "мл/кг" },
        ],
      },
    },
    {
      text: "отменяю расчёт по массе, обезболиваю и оставляю NPO",
      payload: {
        intents: [
          { type: "management", concept_id: "analgesia", confidence: 0.99 },
          { type: "management", concept_id: "npo", confidence: 0.99 },
        ],
        reasoning: { management: { plan_stated: true, rationale_stated: true } },
      },
    },
    { text: "не знаю", payload: {} },
    {
      text: "оцениваю гемодинамику и зову старшего",
      payload: {
        intents: [{ type: "management", concept_id: "call_senior_surgeon", confidence: 0.99 }],
        reasoning: { stability: { stated: true, learner_assessment: "uncertain" } },
      },
    },
    { text: "это реаниматологи делают", payload: {} },
    {
      text: "зову реаниматолога и продолжаю собственную оценку",
      payload: {
        intents: [{ type: "management", concept_id: "call_intensive_care", confidence: 0.99 }],
        reasoning: {
          consultation: {
            own_assessment_stated: true,
            consultation_question_stated: true,
          },
        },
      },
    },
  ];

  let session = createV25Session({ caseData, mode: "reference", seed: "nine-turn" });
  const results = [];
  for (let index = 0; index < turns.length; index += 1) {
    if (index === 5) {
      session = {
        ...session,
        temporalState: { ...session.temporalState, status: "delayed_source_control" },
      };
    }
    const current = turns[index];
    const result = await advanceV25Session({
      caseData,
      session,
      input: current.text,
      options: routerOptions(routerPayload(current.payload)),
    });
    results.push(result);
    session = result.session;
  }

  assert.equal(results[0].mentorPolicy.reasoning_sufficient_to_advance, true);
  assert.ok(["CONTINUE", "REINFORCE"].includes(results[1].mentor.mode));
  assert.equal(results[2].mentorPolicy.adequacy, ADEQUACY.PARTIAL);
  assert.equal(results[2].mentor.mode, MENTOR_MODE.CLARIFY);
  assert.equal(results[3].mentor.mode, MENTOR_MODE.SAFETY_STOP);
  assert.equal(results[3].session.completedActions.includes("iv_fluids"), false);
  assert.equal(results[4].mentorPolicy.reasoning_sufficient_to_advance, true);
  // "обезболиваю" names no agent, dose or route, so the order is on the table
  // and not in the patient until the team is told what and how much. See
  // core/operationalization.js.
  assert.equal(results[4].session.completedActions.includes("analgesia"), false);
  assert.equal(
    results[4].session.workingMemory.actionStates.analgesia.status,
    "proposed"
  );
  assert.deepEqual(
    results[4].session.workingMemory.actionStates.analgesia.awaiting_slots,
    ["agent", "dose", "route"]
  );
  assert.match(results[4].reply, /чем именно, в какой дозе и каким путём/i);
  assert.equal(results[5].mentorPolicy.adequacy, ADEQUACY.STUCK);
  assert.equal(results[5].mentor.mode, MENTOR_MODE.TEACH);
  assert.ok(results[5].mentorPolicy.scaffolding_level >= 2);
  assert.equal(results[6].mentorPolicy.reasoning_sufficient_to_advance, true);
  assert.equal(results[7].mentorPolicy.adequacy, ADEQUACY.EVASIVE);
  assert.equal(results[7].mentor.mode, MENTOR_MODE.CHALLENGE);
  assert.equal(results[7].mentorPolicy.consultation_preserved, true);
  assert.equal(results[8].mentorPolicy.reasoning_sufficient_to_advance, true);
  assert.equal(results[8].session.completedActions.includes("call_intensive_care"), true);
});
