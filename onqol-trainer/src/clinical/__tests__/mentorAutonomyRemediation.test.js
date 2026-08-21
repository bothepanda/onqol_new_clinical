import assert from "node:assert/strict";
import test from "node:test";

import { buildV35Case } from "../v35/createCase.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { planClinicalTurn } from "../v25/turnPlanner.js";
import {
  buildMentorPrompt,
  runMentorAgent,
  validateMentorPayload,
} from "../core/mentorAgent.js";
import { createEmptyReasoningState, mergeReasoningState } from "../core/reasoningState.js";
import { selectHeuristics } from "../core/mentorHeuristics.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";
import { generateScenario } from "../v25/scenarioEngine.js";

const caseData = buildV35Case({
  seed: "mentor-autonomy-remediation",
  requestedPresetId: "APP-001",
}).caseData;

function minimalBrief(overrides = {}) {
  return {
    moves: [],
    candidateIssues: [],
    revealedFacts: [],
    justPerformed: [],
    recentDialogue: [],
    turnNumber: 1,
    phase: "diagnostic_workup",
    pathState: "data_gathering",
    locale: "ru",
    ...overrides,
  };
}

function optionsFor(router) {
  return {
    mentor: true,
    actionExtractorLLM: router,
    conceptMap: appendicitisRouterConceptMap,
    conceptRegistry: resolveConcept,
  };
}

function payloadFor(input) {
  const empty = { intents: [], unresolved_fragments: [] };
  if (input === "физикальный осмотр и опрос") {
    return {
      ...empty,
      intents: [
        { type: "request_history", concept_id: "focused_history", confidence: 0.99 },
        { type: "request_examination", concept_id: "abdominal_exam", confidence: 0.99 },
      ],
    };
  }
  if (input.startsWith("пока похоже")) {
    return {
      ...empty,
      intents: [
        { type: "diagnosis", concept_id: "diagnosis_acute_appendicitis", confidence: 0.98 },
        { type: "diagnosis", concept_id: "differential_ectopic", confidence: 0.98 },
        { type: "request_test", concept_id: "cbc", confidence: 0.99 },
        { type: "request_test", concept_id: "pregnancy_test", confidence: 0.99 },
        { type: "request_test", concept_id: "abdominal_ultrasound", confidence: 0.99 },
        { type: "request_test", concept_id: "pelvic_ultrasound", confidence: 0.99 },
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
            { concept_id: "diagnosis_acute_appendicitis", rank: 1, dangerous: false },
            { concept_id: "differential_ectopic", rank: 2, dangerous: true },
          ],
        },
        test_reasoning: [
          { concept_id: "cbc", purpose_stated: false, management_consequence_stated: false },
          {
            concept_id: "pregnancy_test",
            purpose_stated: true,
            management_consequence_stated: true,
            justification: "важжно исключить внематочную беременность",
          },
        ],
      },
    };
  }
  if (input.startsWith("стабильна")) {
    return {
      ...empty,
      intents: [
        { type: "management", concept_id: "prepare_for_possible_surgery", confidence: 0.99 },
      ],
      reasoning: {
        stability: { stated: true, learner_assessment: "stable" },
        management: { plan_stated: true, urgency_stated: true, rationale_stated: true },
      },
    };
  }
  if (input.startsWith("пациентку госпитализировать")) {
    return {
      ...empty,
      intents: [
        { type: "management", concept_id: "iv_fluids", confidence: 0.99 },
        { type: "management", concept_id: "analgesia", confidence: 0.99 },
        { type: "management", concept_id: "npo", confidence: 0.99 },
        { type: "management", concept_id: "active_observation", confidence: 0.99 },
      ],
      action_parameters: [
        {
          concept_id: "iv_fluids",
          verbatim: "физ р-р из расчета 200 мл на кг массы тела",
          dose_value: 200,
          dose_unit: "мл/кг",
        },
      ],
      reasoning: {
        management: { plan_stated: true, urgency_stated: false, rationale_stated: false },
        observation: {
          active: true,
          goal_stated: false,
          reassessment_interval_stated: true,
          escalation_criteria_stated: false,
        },
        reassessment_stated: true,
        disposition: { stated: true, destination: "ward" },
      },
    };
  }
  return empty;
}

function replayRouter(prompt) {
  return JSON.stringify(payloadFor(JSON.parse(prompt.user).raw_user_text));
}

test("mentor output accepts CONTINUE with empty text", () => {
  const result = validateMentorPayload(
    { mode: "CONTINUE", issue_id: null, mentor_text: "", factual_claims: [], question_domain: null },
    minimalBrief(),
    caseData,
    []
  );
  assert.equal(result.ok, true);
});

test("mentor may reinforce without a question, but must quote the learner", () => {
  const brief = minimalBrief({
    candidateIssues: [{ issue_id: "dangerous_alternative_retained" }],
  });
  const learnerText = "думаю аппендицит, но внематочную пока не снимаю";
  const result = validateMentorPayload(
    {
      mode: "REINFORCE",
      issue_id: "dangerous_alternative_retained",
      mentor_text: "Внематочную ты не снимаешь — правильно, её снимает только тест.",
      anchor_quote: "внематочную пока не снимаю",
      factual_claims: [],
      question_domain: null,
    },
    brief,
    caseData,
    [],
    { learnerText }
  );
  assert.equal(result.ok, true);

  // 21.08.2026: praise the learner cannot trace to their own words is what the
  // wording ban never managed to stop. The anchor is structural instead.
  const unanchored = validateMentorPayload(
    {
      mode: "REINFORCE",
      issue_id: "dangerous_alternative_retained",
      mentor_text: "Опасную альтернативу держишь в поле зрения.",
      anchor_quote: null,
      factual_claims: [],
      question_domain: null,
    },
    brief,
    caseData,
    [],
    { learnerText }
  );
  assert.equal(unanchored.ok, false);
  assert.equal(unanchored.reason, "reinforce_without_anchor");

  const invented = validateMentorPayload(
    {
      mode: "REINFORCE",
      issue_id: "dangerous_alternative_retained",
      mentor_text: "Ты сказал про перитонит — верно.",
      anchor_quote: "признаки перитонита",
      factual_claims: [],
      question_domain: null,
    },
    brief,
    caseData,
    [],
    { learnerText }
  );
  assert.equal(invented.reason, "reinforce_without_anchor");
});

test("mentor accepts zero questions and records stacked ones without refusing", () => {
  const issue = { issue_id: "current_decision", safety_critical: false };
  const brief = minimalBrief({ candidateIssues: [issue] });
  assert.equal(
    validateMentorPayload(
      {
        mode: "CHALLENGE",
        issue_id: issue.issue_id,
        mentor_text: "Решение требует явного обоснования.",
        factual_claims: [],
        question_domain: null,
      },
      brief,
      caseData,
      []
    ).ok,
    true
  );
  const stacked = validateMentorPayload(
    {
      mode: "CLARIFY",
      issue_id: issue.issue_id,
      mentor_text: "Что изменит решение? Когда начнёшь действовать?",
      factual_claims: [],
      question_domain: null,
    },
    brief,
    caseData,
    []
  );
  // Was a refusal until 21.08.2026. A refusal costs the learner the sentence and
  // buys back a more cautious one; stacking is style, so it is recorded and the
  // reply stands. TEACH may stack outright - see spec section 20.
  assert.equal(stacked.ok, true);
  assert.ok(stacked.telemetry.includes("multiple_questions"));
});

test("mentor prompt receives issues and context but no reference rendering", () => {
  const prompt = buildMentorPrompt({
    brief: minimalBrief({
      candidateIssues: [
        {
          issue_id: "current_decision",
          type: "outstanding_priority",
          why_now: "reasoning_changed_this_turn",
          evidence: [],
        },
      ],
      recentDialogue: [{ role: "user", content: "наблюдаю" }],
      reasoningDeltaThisTurn: { management: { plan_stated: true } },
      previousMentorQuestionContract: { expects: ["contingency"] },
    }),
    learnerText: "наблюдаю",
  });
  const user = JSON.parse(prompt.user);
  assert.equal(Object.hasOwn(user, "reference_rendering"), false);
  assert.equal(user.candidate_issues[0].issue_id, "current_decision");
  assert.deepEqual(
    user.deterministic_policy_shadow.previous_mentor_question_contract.expects,
    ["contingency"]
  );
});

test("stale investigation-purpose gap is suppressed after topic moves to management", () => {
  let state = createEmptyReasoningState();
  state = mergeReasoningState(
    state,
    {
      investigations: [
        {
          action_id: "cbc",
          purpose_stated: false,
          management_consequence_stated: false,
          justification: null,
        },
      ],
    },
    2
  ).state;
  state = mergeReasoningState(
    state,
    { management: { plan_stated: true, urgency_stated: false, rationale_stated: false } },
    3
  ).state;
  const selected = selectHeuristics({
    caseData,
    session: {
      phase: "decision",
      pathState: "decision",
      completedActions: ["cbc"],
      temporalState: { clockMinutes: 90, status: "stable", flags: [] },
      workingMemory: { turnNumber: 3, reasoningState: state },
    },
    attempted: new Set(),
    currentTurn: { topic: "management", pathState: "decision", previousIssueId: null },
    limit: 5,
  });
  assert.equal(selected.some((issue) => issue.id === "investigation_without_purpose"), false);
});

test("short answer to a contingency question updates reasoning without simulator", async () => {
  let session = createV25Session({ caseData, mode: "reference", seed: "short-contingency" });
  session = {
    ...session,
    workingMemory: {
      ...session.workingMemory,
      pendingMentorQuestion: {
        issue_id: "no_contingency_plan",
        expects: ["contingency"],
        asked_turn: 2,
      },
    },
  };
  let simulatorCalls = 0;
  const result = await advanceV25Session({
    caseData,
    session,
    input: "резкое ухудшение",
    options: {
      ...optionsFor(replayRouter),
      simulatorLLM: async () => {
        simulatorCalls += 1;
        return JSON.stringify({ response_parts: [] });
      },
    },
  });
  assert.equal(result.plan.turnKind.semantic_kind, "mentor_answer");
  assert.equal(result.session.workingMemory.reasoningState.contingency.stated, true);
  assert.equal(result.session.workingMemory.reasoningState.contingency.specificity, "vague");
  assert.deepEqual(
    result.session.workingMemory.reasoningState.contingency.trigger_verbatim,
    ["резкое ухудшение"]
  );
  assert.equal(result.parsed.unresolvedFragments.length, 0);
  assert.equal(simulatorCalls, 0);
});

test("observation-list answer becomes monitoring and escalation reasoning", async () => {
  let session = createV25Session({ caseData, mode: "reference", seed: "observation-answer" });
  session = {
    ...session,
    workingMemory: {
      ...session.workingMemory,
      pendingMentorQuestion: {
        issue_id: "observation_without_endpoint",
        expects: ["observation", "contingency"],
        asked_turn: 1,
      },
    },
  };
  const input =
    "усилится ли боль, поднимется ли температура, снизится ли давление, и ЧСС увеличится ли";
  const result = await advanceV25Session({
    caseData,
    session,
    input,
    options: optionsFor(replayRouter),
  });
  const reasoning = result.session.workingMemory.reasoningState;
  assert.equal(result.plan.turnKind.semantic_kind, "mentor_answer");
  assert.equal(reasoning.observation.goal_stated, true);
  assert.equal(reasoning.observation.escalation_criteria_stated, true);
  assert.equal(reasoning.contingency.stated, true);
  assert.doesNotMatch(result.reply, /данные не заданы/i);
});

test("explicit numeric escalation thresholds become standalone reasoning", async () => {
  const session = createV25Session({ caseData, mode: "reference", seed: "threshold-list" });
  const input =
    "Эскалация немедленно при сАД ниже 90, ЧСС выше 120, сатурации ниже 94%, олигурии или кровотечении";
  const result = await advanceV25Session({
    caseData,
    session,
    input,
    options: optionsFor(replayRouter),
  });
  const reasoning = result.session.workingMemory.reasoningState;
  assert.equal(reasoning.observation.escalation_criteria_stated, true);
  assert.equal(reasoning.contingency.specificity, "specific");
  assert.deepEqual(reasoning.contingency.trigger_verbatim, [input]);
});

test("clinical reasoning alone does not touch patient, clock or simulator", async () => {
  const session = createV25Session({ caseData, mode: "reference", seed: "reasoning-only" });
  let simulatorCalls = 0;
  const result = await advanceV25Session({
    caseData,
    session,
    input: "стабильна, можно подготовить пациентку к потенциальной операции",
    options: {
      ...optionsFor(replayRouter),
      simulatorLLM: async () => {
        simulatorCalls += 1;
        return JSON.stringify({ response_parts: [] });
      },
    },
  });
  assert.equal(result.plan.turnKind.semantic_kind, "clinical_reasoning");
  assert.equal(result.session.temporalState.clockMinutes, 0);
  assert.equal(simulatorCalls, 0);
});

test("patient question is classified separately and may reach simulator", async () => {
  const session = createV25Session({ caseData, mode: "reference", seed: "patient-question" });
  let simulatorCalls = 0;
  const router = () =>
    JSON.stringify({
      intents: [{ type: "question", concept_id: null, confidence: 0.95 }],
      unresolved_fragments: [],
    });
  const result = await advanceV25Session({
    caseData,
    session,
    input: "как пациентка себя чувствует?",
    options: {
      ...optionsFor(router),
      simulatorLLM: async () => {
        simulatorCalls += 1;
        return JSON.stringify({ response_parts: [] });
      },
    },
  });
  assert.equal(result.plan.turnKind.semantic_kind, "patient_question");
  assert.equal(simulatorCalls, 1);
  assert.equal(result.session.temporalState.clockMinutes, 0);
});

test("compound turn separates reasoning from a performed action", async () => {
  const session = createV25Session({ caseData, mode: "reference", seed: "compound" });
  const input = "стабильна и обезболить";
  const router = () =>
    JSON.stringify({
      intents: [{ type: "management", concept_id: "analgesia", confidence: 0.99 }],
      reasoning: { stability: { stated: true, learner_assessment: "stable" } },
    });
  const plan = await planClinicalTurn({
    input,
    caseData,
    session,
    options: optionsFor(router),
  });
  assert.equal(plan.turnKind.semantic_kind, "clinical_action");
  assert.deepEqual(plan.turnKind.components, ["clinical_action", "clinical_reasoning"]);
  assert.equal(plan.operations[0].action_id, "analgesia");
  assert.equal(plan.parsed.reasoning.stability.stated, true);
});

test("an unrelated compound action does not become a mentor answer", async () => {
  let session = createV25Session({ caseData, mode: "reference", seed: "compound-pending" });
  session = {
    ...session,
    workingMemory: {
      ...session.workingMemory,
      pendingMentorQuestion: {
        issue_id: "no_contingency_plan",
        expects: ["contingency"],
        asked_turn: 1,
      },
    },
  };
  const input = "пациентку госпитализировать и обезболить, затем выполнить общий анализ крови";
  const router = () =>
    JSON.stringify({
      intents: [
        { type: "management", concept_id: "analgesia", confidence: 0.99 },
        { type: "request_test", concept_id: "cbc", confidence: 0.99 },
      ],
      unresolved_fragments: [],
    });
  const plan = await planClinicalTurn({ input, caseData, session, options: optionsFor(router) });
  assert.equal(plan.mentorAnswer, null);
  assert.equal(plan.turnKind.semantic_kind, "clinical_action");
  assert.equal(plan.parsed.reasoning, null);
});

test("tentative operative phrases create no procedure and do not enter preop", async () => {
  const phrases = [
    ["можно подготовить к потенциальной операции", "prepare_for_possible_surgery"],
    ["если подтвердится, вероятно понадобится операция", "operative_intent"],
    ["думаю об операции", "operative_intent"],
    ["можно рассмотреть открытую аппендэктомию", "operative_intent"],
  ];
  for (const [input, conceptId] of phrases) {
    assert.equal(resolveConcept(conceptId).kind, "reasoning_only");
    // Even a bad model classification cannot bypass the deterministic
    // commitment guard.
    const router = () =>
      JSON.stringify({
        intents: [
          { type: "management", concept_id: "open_appendectomy_here", confidence: 0.99 },
        ],
        reasoning: { management: { plan_stated: true } },
      });
    let session = createV25Session({ caseData, mode: "reference", seed: input });
    session = {
      ...session,
      completedActions: ["diagnosis_acute_appendicitis"],
    };
    const result = await advanceV25Session({
      caseData,
      session,
      input,
      options: optionsFor(router),
    });
    assert.equal(result.plan.operations.length, 0, input);
    assert.notEqual(result.session.pathState, "preop", input);
    assert.equal(result.session.completedActions.includes("open_appendectomy_here"), false, input);
  }
});

test("committed appendectomy decision enters preop without performing procedure", async () => {
  for (const input of ["готовим к аппендэктомии", "решение: аппендэктомия"]) {
    const router = () =>
      JSON.stringify({
        intents: [
          { type: "management", concept_id: "decision_for_appendectomy", confidence: 0.99 },
        ],
        reasoning: { management: { plan_stated: true } },
      });
    let session = createV25Session({ caseData, mode: "reference", seed: input });
    session = {
      ...session,
      completedActions: ["diagnosis_acute_appendicitis"],
    };
    const result = await advanceV25Session({
      caseData,
      session,
      input,
      options: optionsFor(router),
    });
    assert.equal(result.session.pathState, "preop");
    assert.equal(result.session.temporalState.sourceControl, false);
    assert.equal(result.session.completedActions.includes("open_appendectomy_here"), false);
  }
});

test("explicit open and laparoscopic approaches remain distinct decisions", async () => {
  const session = createV25Session({ caseData, mode: "reference", seed: "approaches" });
  const open = await planClinicalTurn({
    input: "выполняем открытую аппендэктомию",
    caseData,
    session,
    options: optionsFor(() =>
      JSON.stringify({
        intents: [
          { type: "management", concept_id: "operative_approach_open", confidence: 0.99 },
        ],
      })
    ),
  });
  const lap = await planClinicalTurn({
    input: "выполняем лапароскопическую аппендэктомию",
    caseData,
    session,
    options: optionsFor(() =>
      JSON.stringify({
        intents: [
          {
            type: "management",
            concept_id: "operative_approach_laparoscopic",
            confidence: 0.99,
          },
        ],
      })
    ),
  });
  assert.equal(open.operations.length, 0);
  assert.equal(open.managementDecisions[0].decision_id, "operative_approach");
  assert.equal(open.managementDecisions[0].approach, "open");
  assert.equal(lap.operations.length, 0);
  assert.equal(lap.managementDecisions[0].decision_id, "operative_approach");
  assert.equal(lap.managementDecisions[0].approach, "laparoscopic");
  assert.equal(lap.parsed.unresolvedByKind.length, 0);
});

test("200 ml per kg fluid order fails safe and forces safety interrupt", async () => {
  const session = createV25Session({ caseData, mode: "reference", seed: "fluid-safety" });
  const input =
    "пациентку госпитализировать в отделение, физ р-р из расчета 200 мл на кг массы тела, обезболить, НПО, пероценка через 3 часа";
  const result = await advanceV25Session({
    caseData,
    session,
    input,
    options: optionsFor(replayRouter),
  });
  assert.equal(result.plan.parameterSafetySignals[0].value, 200);
  assert.equal(result.plan.parameterSafetySignals[0].unit, "ml/kg");
  assert.equal(result.plan.parameterSafetySignals[0].safety_verdict, "not_yet_reviewed");
  assert.equal(result.session.workingMemory.actionStates.iv_fluids.status, "blocked");
  assert.equal(result.session.completedActions.includes("iv_fluids"), false);
  assert.equal(result.mentor.mode, "SAFETY_STOP");
  assert.match(result.reply, /требует клинической проверки/i);
});

test("exact six-turn replay follows contextual mentor and runtime contract", async () => {
  const turns = [
    "физикальный осмотр и опрос",
    "пока похоже на острый аппендциит, но у женщин важжно исключить внематочную беременность\nОАК, тест на беременность, УЗИ ОБП+ОМТ",
    "стабильна, давалени в норме, чсс и чд тоже. нет нужды спешить, можно подготовить пациентку к потенциальной операции",
    "пациентку госпитализировать в отделение, физ р-р из расчета 200 мл на кг массы тела, обезболить, НПО, пероценка через 3 часа",
    "усилится ли боль, поднимется ли температура, снизится ли давление, и ЧСС увеличится ли",
    "резкое ухудшение",
  ];
  let session = createV25Session({ caseData, mode: "reference", seed: "exact-six-turns" });
  const results = [];
  let simulatorCalls = 0;
  for (const input of turns) {
    const result = await advanceV25Session({
      caseData,
      session,
      input,
      options: {
        ...optionsFor(replayRouter),
        simulatorLLM: async () => {
          simulatorCalls += 1;
          return JSON.stringify({ response_parts: [] });
        },
      },
    });
    results.push(result);
    session = result.session;
  }

  assert.equal(results[1].mentor.mode, "REINFORCE");
  assert.doesNotMatch(results[2].mentor.text, /исследован|тест|ОАК/i);
  assert.notEqual(results[2].session.pathState, "preop");
  assert.equal(results[3].session.workingMemory.actionStates.iv_fluids.status, "blocked");
  assert.equal(results[3].mentor.mode, "SAFETY_STOP");
  // CONTRACT CHANGED, base rules v2. The parameter stop itself is unchanged:
  // turn 4 stops, and iv_fluids stays `blocked` and is never applied. What
  // changed is that a GOVERNANCE stop - "the pilot has no reviewed rule for this
  // parameter" - is stated once instead of re-arming every later turn. There is
  // no answer that can satisfy it, so repeating it was a demand the learner
  // could only walk out of; that is how replay 91ba7206 ended. A REVIEWED unsafe
  // verdict still repeats for as long as the learner insists on it - see
  // parameterStopKey in mentorPolicy.js.
  assert.equal(results[4].plan.turnKind.semantic_kind, "clinical_reasoning");
  assert.equal(results[4].mentor.mode, "CONTINUE");
  assert.equal(results[5].plan.turnKind.semantic_kind, "unknown");
  assert.notEqual(results[5].mentor.mode, "SAFETY_STOP");
  assert.equal(results[5].session.workingMemory.actionStates.iv_fluids.status, "blocked");
  assert.equal(session.workingMemory.reasoningState.contingency.stated, true);
  assert.equal(session.workingMemory.reasoningState.contingency.specificity, "partial");
  assert.equal(
    simulatorCalls,
    1,
    "a compound turn with an addressed content gap stays deterministic; only turn 1 reaches the simulator"
  );
});

test("seeded scenario determinism is unchanged by mentor policy", () => {
  const first = generateScenario({ mode: "real", seed: "mentor-policy-seed" });
  const second = generateScenario({ mode: "real", seed: "mentor-policy-seed" });
  assert.deepEqual(first, second);
});

test("the mentor cannot create an issue outside the deterministic brief", async () => {
  const issue = {
    issue_id: "no_contingency_plan",
    type: "outstanding_priority",
    severity: 2,
    safety_critical: false,
    fallback_text: "План есть. Что заставит тебя его поменять?",
    evidence: [],
  };
  const result = await runMentorAgent(
    {
      brief: minimalBrief({ candidateIssues: [issue], moves: [] }),
      learnerText: "наблюдаю",
      caseData,
      revealedFindingIds: [],
    },
    {
      llm: async () =>
        JSON.stringify({
          mode: "CLARIFY",
          issue_id: "unrelated_topic",
          mentor_text: "Что дальше?",
          factual_claims: [],
          question_domain: "contingency",
        }),
    }
  );
  assert.equal(result.source, "deterministic");
  assert.equal(result.mode, "CLARIFY");
  assert.equal(result.text, issue.fallback_text);
  assert.deepEqual(result.rejectionReasons, ["issue_not_in_brief"]);
  assert.deepEqual(result.firedHeuristicKeys, []);
});
