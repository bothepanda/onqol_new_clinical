import assert from "node:assert/strict";
import test from "node:test";

import { buildV35Case } from "../v35/createCase.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { buildMentorBrief } from "../core/mentorBrief.js";
import {
  ADEQUACY,
  MENTOR_MODE,
  selectMentorPolicy,
} from "../core/mentorPolicy.js";
import { selectHeuristics } from "../core/mentorHeuristics.js";
import {
  CLINICAL_RULE_REGISTRY,
  CLINICAL_RUNTIME_EFFECT,
  ruleAllowsRuntimeEffect,
} from "../governance/clinicalGovernance.js";
import {
  anchorQuoteMatches,
  buildMentorPrompt,
  duplicatesEngineHousekeeping,
  paraphrasesEngine,
  repeatsRecentQuestion,
  runMentorAgent,
  validateMentorPayload,
  validateMentorText,
} from "../core/mentorAgent.js";

/**
 * The voice remediation of 21.08.2026.
 *
 * Live run AB_MENTOR_LIVE_20260820 produced a mentor that was correct, safe and
 * unreadable: it spoke in the passive, it repeated the engine, and it went quiet
 * at the two turns that mattered most. These tests hold the four structural
 * changes that came out of that run. The behavioural half - the archetypes and
 * the voice reference - lives in ONQOL_MENTOR_BEHAVIOR_SPEC.md sections 19.1 and
 * 22, and is checked by running the archetype harness, not by unit test.
 */

const caseData = buildV35Case({
  seed: "mentor-voice-remediation",
  requestedPresetId: "APP-001",
}).caseData;

function minimalBrief(overrides = {}) {
  return {
    moves: [],
    candidateIssues: [],
    revealedFacts: [],
    justPerformed: [],
    recentDialogue: [],
    learnerTurns: [],
    engineReplyText: "",
    turnNumber: 1,
    phase: "diagnostic_workup",
    pathState: "data_gathering",
    locale: "ru",
    ...overrides,
  };
}

// --- 1. the mentor does not say what the engine already said ----------------

test("the mentor may not restate the engine's own housekeeping", () => {
  // Verbatim from the live run, turn 4. The engine explained that the ordered
  // parameters have no reviewed rule; the mentor then spent its whole turn
  // saying the same thing, and the learner reads one screen.
  const engineReplyText = [
    "**Операционный доступ:** лапароскопический доступ выбран; ресурс доступен.",
    "",
    "**Назначения записаны:** «физ-р-р 2 л», «ектотоп 30 мг в/м», «цефазолин 1 гр профилкатика в оперблок». Отрецензированных правил под них в пилоте пока нет, поэтому параметры не проверяются, к пациенту назначения не применены и эффект не моделируется. Это не замечание к твоему выбору.",
  ].join("\n");
  const echoed =
    "Указанные параметры инфузии, обезболивания и антибиотикопрофилактики в этой версии не имеют моделируемого эффекта и не применены к пациентке.";

  assert.equal(duplicatesEngineHousekeeping(echoed, engineReplyText), true);

  const brief = minimalBrief({
    engineReplyText,
    candidateIssues: [{ issue_id: "current_decision", safety_critical: false }],
  });
  const verdict = validateMentorPayload(
    {
      mode: "CLARIFY",
      issue_id: "current_decision",
      mentor_text: echoed,
      anchor_quote: null,
      factual_claims: [],
      question_domain: null,
    },
    brief,
    caseData,
    [],
    { learnerText: "готовим к операции" }
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "repeats_engine_housekeeping");
});

test("teaching about the same order as the engine still passes", () => {
  const engineReplyText =
    "**Назначения записаны:** «цефазолин 1 гр профилкатика в оперблок». Отрецензированных правил под них в пилоте пока нет, поэтому эффект не моделируется.";
  const teaching = "Цефазолин ты уже назначил. Какую цель профилактики он у тебя закрывает?";
  assert.equal(duplicatesEngineHousekeeping(teaching, engineReplyText), false);
  assert.equal(paraphrasesEngine(teaching, engineReplyText).paraphrased, false);
});

test("the mentor may still answer a question the engine did not raise", () => {
  // Hard bound 1 keeps this useful: saying honestly what the case does not
  // simulate is allowed. It is banned only as an echo of the same turn.
  const engineReplyText = "**УЗИ ОБП:** аппендикс достоверно не визуализирован.";
  const answer = "КТ в этом кейсе не моделируется — решай по тому, что уже есть на руках.";
  assert.equal(duplicatesEngineHousekeeping(answer, engineReplyText), false);
});

test("the prompt hands the mentor the engine's exact words and forbids repeating them", () => {
  const prompt = buildMentorPrompt({
    brief: minimalBrief({ engineReplyText: "**ОАК:** лейкоциты 9,5." }),
    learnerText: "оак",
  });
  assert.match(prompt.system, /DO NOT SAY WHAT THE ENGINE ALREADY SAID/);
  assert.equal(JSON.parse(prompt.user).brief.engine_reply_this_turn, "**ОАК:** лейкоциты 9,5.");
});

// --- 2. reinforcement has to quote the learner ------------------------------

test("the anchor quote must be the learner's own words, not a paraphrase of them", () => {
  const learnerText = "думаю аппендицит, но внематочную пока не снимаю";
  assert.equal(anchorQuoteMatches("внематочную пока не снимаю", learnerText), true);
  // Case and punctuation are noise; the words are not.
  assert.equal(anchorQuoteMatches("Внематочную, пока не снимаю!", learnerText), true);
  assert.equal(anchorQuoteMatches("опасную альтернативу держишь", learnerText), false);
  // A single word is not a quote - almost anything matches one word.
  assert.equal(anchorQuoteMatches("аппендицит", learnerText), false);
  assert.equal(anchorQuoteMatches("", learnerText), false);
  assert.equal(anchorQuoteMatches(null, learnerText), false);
});

// --- 3. what speaks when the model's reply cannot be used -------------------

test("a safety stop still speaks when the model fails twice", async () => {
  const brief = minimalBrief({
    candidateIssues: [
      {
        issue_id: "unsafe_parameter",
        type: "parameter_safety",
        safety_critical: true,
        fallback_text: "Стоп. Проверь дозу перед введением.",
        evidence: [],
      },
    ],
    mentorPolicy: null,
  });
  const result = await runMentorAgent(
    { brief, learnerText: "вводим", caseData, revealedFindingIds: [] },
    {
      llm: async () =>
        JSON.stringify({
          // Not SAFETY_STOP, so the safety interrupt refuses it - twice.
          mode: "CLARIFY",
          issue_id: "unsafe_parameter",
          mentor_text: "Что дальше?",
          anchor_quote: null,
          factual_claims: [],
          question_domain: null,
        }),
    }
  );
  assert.equal(result.mode, MENTOR_MODE.SAFETY_STOP);
  assert.equal(result.text, "Стоп. Проверь дозу перед введением.");
  assert.deepEqual(result.rejectionReasons, [
    "safety_interrupt_required",
    "safety_interrupt_required",
  ]);
});

// --- 4. style is recorded, medicine is refused ------------------------------

test("only the clinical bounds refuse; style is telemetry", () => {
  const refused = [
    ["", "empty"],
    ["Диагноз поставлен верно.", "premature_diagnosis_confirmation"],
  ];
  for (const [text, reason] of refused) {
    const verdict = validateMentorText(text, caseData, []);
    assert.equal(verdict.ok, false, text);
    assert.equal(verdict.reason, reason, text);
  }

  const recorded = [
    ["Можно двигаться дальше.", "unanchored_meta_praise"],
    ["Что дальше? И почему именно сейчас?", "multiple_questions"],
    ["Здесь нужно выполнить аппендэктомию прямо сейчас.", "prescribed_expected_decision"],
  ];
  for (const [text, flag] of recorded) {
    const verdict = validateMentorText(text, caseData, []);
    assert.equal(verdict.ok, true, text);
    assert.ok(verdict.telemetry.includes(flag), `${text} -> ${verdict.telemetry.join(",")}`);
  }
});

test("a reply that has run away is still refused", () => {
  const runaway = "Разбираем по шагам. ".repeat(300);
  const verdict = validateMentorText(runaway, caseData, []);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "runaway_length");
});

// --- 5. the mentor stops asking and starts teaching -------------------------

test("a third consecutive probe is refused, and TEACH is the way out", () => {
  // Verbatim from the live run of 21.08.2026, turns 5 to 7. One question, three
  // wordings, never answered, patient never moved.
  const brief = minimalBrief({
    probingStreak: 2,
    recentMentorQuestions: [
      "Что именно изменилось в ситуации и почему это меняет доступ?",
      "что именно заставило тебя перейти к открытой операции?",
    ],
    candidateIssues: [{ issue_id: "access_change_unexplained", safety_critical: false }],
  });
  const learnerText = "готовим к открытой аппендектоми";
  const fourthTry = {
    mode: "CHALLENGE",
    issue_id: "access_change_unexplained",
    mentor_text: "Что именно обосновывает открытую операцию?",
    anchor_quote: null,
    factual_claims: [],
    question_domain: null,
  };
  assert.equal(
    validateMentorPayload(fourthTry, brief, caseData, [], { learnerText }).reason,
    "third_consecutive_probe"
  );

  // An imperative is still a probe. The v4 run escaped the old check by
  // dropping the question mark: "Сейчас назови следующий контрольный этап".
  assert.equal(
    validateMentorPayload(
      { ...fourthTry, mentor_text: "Сейчас назови следующий контрольный этап перед индукцией." },
      brief,
      caseData,
      [],
      { learnerText }
    ).reason,
    "third_consecutive_probe"
  );

  // The escalation the rule is asking for. TEACH is exempt on purpose: breaking
  // the question into smaller ones necessarily reuses its words.
  const teaching = {
    mode: "TEACH",
    issue_id: "access_change_unexplained",
    mentor_text:
      "Разберём по частям. Лапароскопию меняют на открытую по трём поводам: доступ недоступен, обзора не хватает, состояние не терпит. Какой из них у тебя?",
    anchor_quote: null,
    factual_claims: [],
    question_domain: null,
    scaffolding_level: 3,
  };
  assert.equal(validateMentorPayload(teaching, brief, caseData, [], { learnerText }).ok, true);
});

test("a near-verbatim repeat is caught even when the streak was broken", () => {
  const asked = ["Что именно заставило тебя перейти к открытой операции?"];
  assert.equal(
    repeatsRecentQuestion("Что именно обосновывает переход к открытой операции?", asked).repeated,
    true
  );
  // A question about something else is not a repeat.
  assert.equal(
    repeatsRecentQuestion("Какую цель профилактики закрывает цефазолин?", asked).repeated,
    false
  );
});

// --- 6. the mentor may not invent a guideline -------------------------------

test("an appeal to an approved rule must name an approved rule", () => {
  // Verbatim from the live run of 21.08.2026, turn 7. No rule in the registry
  // says anything about operative access; the model invented the content and
  // the citation together, and nothing in the clinical bounds caught it - there
  // is no number in the sentence to catch.
  const brief = minimalBrief({
    candidateIssues: [{ issue_id: "access_change_unexplained", safety_critical: false }],
    approvedTeachingRules: [],
  });
  const fabricated = {
    mode: "TEACH",
    issue_id: "access_change_unexplained",
    mentor_text:
      "По утверждённому правилу, у стабильной взрослой пациентки с неосложнённым аппендицитом лапароскопический доступ является рекомендуемым вариантом.",
    anchor_quote: null,
    factual_claims: [],
    question_domain: null,
    scaffolding_level: 3,
  };
  assert.equal(
    validateMentorPayload(fabricated, brief, caseData, [], { learnerText: "открытая" }).reason,
    "unsourced_rule_citation"
  );

  // The same teaching point, made as the mentor's own question, is fine.
  const owned = {
    ...fabricated,
    mentor_text: "Лапароскопию на открытую меняют по конкретному поводу. Какой повод у тебя?",
  };
  assert.equal(validateMentorPayload(owned, brief, caseData, [], { learnerText: "открытая" }).ok, true);
});

test("a rule the mentor does cite must be quoted, not paraphrased", () => {
  // A real registry rule: a hand-made one is not a source at all, because
  // ruleAllowsRuntimeEffect revalidates it against the source registry first.
  const rule = CLINICAL_RULE_REGISTRY.find((candidate) =>
    ruleAllowsRuntimeEffect(candidate, CLINICAL_RUNTIME_EFFECT.MENTOR_TEACHING)
  );
  assert.ok(rule, "the registry holds at least one rule approved for teaching");
  const brief = minimalBrief({
    approvedTeachingRules: [rule],
    candidateIssues: [{ issue_id: "prophylaxis", safety_critical: false }],
  });
  const paraphrased = {
    mode: "TEACH",
    issue_id: "prophylaxis",
    mentor_text: "По утверждённому правилу профилактику дают где-то перед операцией.",
    anchor_quote: null,
    factual_claims: [{ source_id: `clinical_rule.${rule.rule_id}`, text: rule.claim }],
    question_domain: null,
    scaffolding_level: 3,
  };
  assert.equal(
    validateMentorPayload(paraphrased, brief, caseData, [], { learnerText: "цефазолин" }).reason,
    "rule_claim_not_quoted"
  );

  const quoted = {
    ...paraphrased,
    mentor_text: `По утверждённому правилу: ${rule.claim} Когда ты его вводишь?`,
  };
  assert.equal(
    validateMentorPayload(quoted, brief, caseData, [], { learnerText: "цефазолин" }).ok,
    true
  );
});

// --- 7. the mentor does not guess a gender ----------------------------------

test("a gender nobody declared is refused; the declared one is fine", () => {
  const brief = minimalBrief({
    candidateIssues: [{ issue_id: "access_change_unexplained", safety_critical: false }],
  });
  const base = {
    mode: "CHALLENGE",
    issue_id: "access_change_unexplained",
    anchor_quote: null,
    factual_claims: [],
    question_domain: null,
  };
  const learnerText = "ну значит открытая аппендектомия";

  // Verbatim from the live run of 21.08.2026, turn 5.
  assert.equal(
    validateMentorPayload(
      { ...base, mentor_text: "Нет. Ты только что выбрал лапароскопический доступ. Что меняет тактику?" },
      brief,
      caseData,
      [],
      { learnerText }
    ).reason,
    "gendered_address_without_form"
  );

  // The rewrite the repair instruction asks for: present tense, no gender.
  assert.equal(
    validateMentorPayload(
      { ...base, mentor_text: "Нет. Ты меняешь доступ без причины. Что именно меняет тактику?" },
      brief,
      caseData,
      [],
      { learnerText }
    ).ok,
    true
  );

  // Declared feminine: matching it is the entire point of asking on the start screen.
  const feminine = { ...brief, learnerAddressForm: "feminine" };
  assert.equal(
    validateMentorPayload(
      { ...base, mentor_text: "Ты выбрала лапароскопию. Что меняет тактику?" },
      feminine,
      caseData,
      [],
      { learnerText }
    ).ok,
    true
  );
  assert.equal(
    validateMentorPayload(
      { ...base, mentor_text: "Ты выбрал лапароскопию. Что меняет тактику?" },
      feminine,
      caseData,
      [],
      { learnerText }
    ).reason,
    "gendered_address_wrong_form"
  );
});

// --- 8. standing risks stay live without becoming a checklist --------------

test("an open standing risk speaks once, re-arms at the operation gate, then stops", () => {
  const standingCase = buildV35Case({
    seed: "standing-risk-ectopic",
    requestedPresetId: "APP-003",
  }).caseData;
  const initial = createV25Session({
    caseData: standingCase,
    mode: "reference",
    seed: "standing-risk-ectopic",
  });
  const session = {
    ...initial,
    phase: "decision",
    pathState: "preop",
    completedActions: ["abdominal_exam", "diagnosis_acute_appendicitis"],
    workingMemory: {
      ...initial.workingMemory,
      turnNumber: 4,
    },
  };
  const currentTurn = {
    previousIssueId: null,
    pathState: "preop",
    topic: "management",
  };

  const opened = selectHeuristics({
    caseData: standingCase,
    session,
    attempted: new Set(),
    currentTurn,
    limit: 20,
  }).find((rule) => rule.id === "appendicitis_ectopic_not_excluded");
  assert.ok(opened);
  assert.equal(opened.standing_risk_stage, "open");
  assert.equal(opened.fired_key, "appendicitis_ectopic_not_excluded@open");

  const atGate = selectHeuristics({
    caseData: standingCase,
    session,
    attempted: new Set(["appendectomy_procedure_start"]),
    alreadyFired: [opened.fired_key],
    currentTurn,
    limit: 20,
  }).find((rule) => rule.id === "appendicitis_ectopic_not_excluded");
  assert.ok(atGate);
  assert.equal(atGate.standing_risk_stage, "irreversible_gate");
  assert.equal(atGate.hint_level, 4);
  assert.match(atGate.mentor_line, /внематочная беременность/iu);
  assert.equal(
    atGate.fired_key,
    "appendicitis_ectopic_not_excluded@irreversible_gate"
  );

  const exhausted = selectHeuristics({
    caseData: standingCase,
    session,
    attempted: new Set(["appendectomy_procedure_start"]),
    alreadyFired: [opened.fired_key, atGate.fired_key],
    currentTurn,
    limit: 20,
  });
  assert.equal(
    exhausted.some((rule) => rule.id === "appendicitis_ectopic_not_excluded"),
    false
  );
});

test("closing a standing risk removes it instead of repeating it at the gate", () => {
  const standingCase = buildV35Case({
    seed: "standing-risk-closed",
    requestedPresetId: "APP-003",
  }).caseData;
  const initial = createV25Session({
    caseData: standingCase,
    mode: "reference",
    seed: "standing-risk-closed",
  });
  const session = {
    ...initial,
    phase: "decision",
    pathState: "preop",
    completedActions: [
      "abdominal_exam",
      "diagnosis_acute_appendicitis",
      "pregnancy_test",
    ],
    workingMemory: { ...initial.workingMemory, turnNumber: 4 },
  };
  const selected = selectHeuristics({
    caseData: standingCase,
    session,
    attempted: new Set(["appendectomy_procedure_start"]),
    currentTurn: { previousIssueId: null, pathState: "preop", topic: "management" },
    limit: 20,
  });
  assert.equal(
    selected.some((rule) => rule.id === "appendicitis_ectopic_not_excluded"),
    false
  );
});

test("a low-severity standing risk is still a live challenge, not silent debrief material", () => {
  const policy = selectMentorPolicy({
    assessment: {
      adequacy: ADEQUACY.SUFFICIENT,
      reason: "safe_current_action_is_executable",
      expected_answer_domains: [],
      safety_critical: false,
      governance_stop: false,
      consultation_preserved: false,
    },
    candidateIssues: [
      {
        issue_id: "appendicitis_analgesia_withheld",
        type: "outstanding_priority",
        severity: 2,
        hint_level: 1,
        lifecycle: "standing_risk",
        standing_risk_stage: "open",
        relevant_to_current_turn: true,
        expected_answer_domains: ["current_decision"],
        fallback_text: "Живот осмотрен, а обезболивание не назначено. Что делаешь?",
      },
    ],
  });
  assert.equal(policy.mode, MENTOR_MODE.CHALLENGE);
  assert.equal(policy.priority, "standing_risk");
  assert.equal(policy.scaffolding_level, 1);
});

test("the mentor brief promotes an open ectopic risk ahead of housekeeping at procedure start", () => {
  const standingCase = buildV35Case({
    seed: "standing-risk-brief",
    requestedPresetId: "APP-003",
  }).caseData;
  const initial = createV25Session({
    caseData: standingCase,
    mode: "reference",
    seed: "standing-risk-brief",
  });
  const session = {
    ...initial,
    phase: "decision",
    pathState: "preop",
    completedActions: ["abdominal_exam", "diagnosis_acute_appendicitis"],
    workingMemory: { ...initial.workingMemory, turnNumber: 5 },
  };
  const brief = buildMentorBrief({
    caseData: standingCase,
    session,
    plan: {
      input: "начинаем операцию",
      parsed: {},
      actions: [],
      operations: [],
      managementDecisions: [],
      parameterSafetySignals: [],
      operationalizationStates: [],
      prerequisiteWarnings: [],
      turnKind: { semantic_kind: "clinical_action" },
      adequacyAssessment: {
        adequacy: ADEQUACY.SUFFICIENT,
        reason: "safe_current_action_is_executable",
        expected_answer_domains: [],
        safety_critical: false,
        governance_stop: false,
        consultation_preserved: false,
      },
    },
    deterministicUpdate: {
      scoringEvents: [{ action_id: "appendectomy_procedure_start" }],
      blockedOperations: [],
    },
  });

  assert.equal(brief.candidateIssues[0].issue_id, "appendicitis_ectopic_not_excluded");
  assert.equal(brief.candidateIssues[0].standing_risk_stage, "irreversible_gate");
  assert.equal(brief.mentorPolicy.mode, MENTOR_MODE.CHALLENGE);
  assert.equal(brief.mentorPolicy.priority, "standing_risk_gate");
  assert.equal(brief.mentorPolicy.scaffolding_level, 4);
  assert.match(brief.candidateIssues[0].fallback_text, /внематочная беременность/iu);
  assert.deepEqual(brief.firedHeuristicKeys, [
    "appendicitis_ectopic_not_excluded@irreversible_gate",
  ]);
});

function preparedProcedureSession(standingCase) {
  const initial = createV25Session({
    caseData: standingCase,
    mode: "reference",
    seed: "standing-gate-engine",
  });
  return {
    ...initial,
    phase: "decision",
    pathState: "preop",
    completedActions: [
      "abdominal_exam",
      "diagnosis_acute_appendicitis",
      "informed_consent",
      "notify_anesthesia",
    ],
    workingMemory: {
      ...initial.workingMemory,
      turnNumber: 5,
      operativeDecision: { status: "proposed", updated_turn: 4 },
      operativeApproach: { approach: "open", status: "selected", updated_turn: 5 },
      operativeState: {
        ...initial.workingMemory.operativeState,
        appendectomy_decided: true,
        operative_approach_selected: true,
      },
    },
  };
}

function procedureStartOptions(overrides = {}) {
  return {
    mentor: true,
    actionExtractorLLM: () =>
      JSON.stringify({
        intents: [{
          type: "management",
          concept_id: "appendectomy_procedure_start",
          confidence: 0.99,
          requested_fragment: "начинаю операцию",
        }],
        unresolved_fragments: [],
        action_parameters: [],
      }),
    ...overrides,
  };
}

test("the standing-risk gate holds the action before procedure_started mutates", async () => {
  const standingCase = buildV35Case({
    seed: "standing-gate-engine",
    requestedPresetId: "APP-003",
  }).caseData;
  const held = await advanceV25Session({
    caseData: standingCase,
    session: preparedProcedureSession(standingCase),
    input: "начинаю операцию",
    options: procedureStartOptions(),
  });

  assert.equal(held.session.workingMemory.operativeState.procedure_started, false);
  assert.equal(
    held.session.workingMemory.actionStates.appendectomy_procedure_start.status,
    "proposed"
  );
  assert.equal(
    held.session.actionLog.findLast(
      (entry) => entry.action_id === "appendectomy_procedure_start"
    ).action_decision,
    "mentor_gate_held"
  );
  assert.equal(held.mentor.issueId, "appendicitis_ectopic_not_excluded");
  assert.match(held.mentor.text, /внематочная беременность/iu);

  // Both ectopic exclusion and analgesia are open, but the gate is
  // conversational and speaks once for this irreversible action. A later
  // explicit attempt executes instead of walking the learner through a list.
  const repeated = await advanceV25Session({
    caseData: standingCase,
    session: held.session,
    input: "начинаю операцию",
    options: procedureStartOptions(),
  });
  assert.equal(repeated.session.workingMemory.operativeState.procedure_started, true);
});

test("CONTINUE cannot consume a held standing-risk gate", async () => {
  const standingCase = buildV35Case({
    seed: "standing-gate-continue",
    requestedPresetId: "APP-003",
  }).caseData;
  const result = await advanceV25Session({
    caseData: standingCase,
    session: preparedProcedureSession(standingCase),
    input: "начинаю операцию",
    options: procedureStartOptions({
      mentorLLM: async () =>
        JSON.stringify({
          mode: "CONTINUE",
          issue_id: null,
          mentor_text: "",
          factual_claims: [],
          question_domain: null,
        }),
    }),
  });

  assert.equal(result.session.workingMemory.operativeState.procedure_started, false);
  assert.equal(result.mentor.source, "deterministic");
  assert.deepEqual(result.mentor.rejectionReasons, [
    "standing_gate_intervention_required",
    "standing_gate_intervention_required",
  ]);
  assert.match(result.mentor.text, /внематочная беременность/iu);
});

test("an imperative mentor probe creates the same answer contract as a question", async () => {
  const issue = {
    issue_id: "appendicitis_analgesia_withheld",
    type: "outstanding_priority",
    severity: 2,
    expected_answer_domains: ["current_decision"],
    fallback_text: "Назови препарат и путь введения.",
  };
  const result = await runMentorAgent(
    {
      brief: minimalBrief({
        candidateIssues: [issue],
        mentorPolicy: {
          mode: MENTOR_MODE.CHALLENGE,
          issue_id: issue.issue_id,
          fallback_text: issue.fallback_text,
          expected_answer_domains: issue.expected_answer_domains,
          question_domain: "current_decision",
        },
      }),
      learnerText: "готовим к операции",
      caseData,
      revealedFindingIds: [],
    },
    {}
  );

  assert.equal(result.text, "Назови препарат и путь введения.");
  assert.deepEqual(result.pendingQuestion?.expects, ["current_decision"]);
});

test("a direct treatment recommendation needs a rule scoped to its candidate issue", () => {
  const brief = minimalBrief({
    candidateIssues: [{
      issue_id: "operative_reasoning",
      type: "current_decision",
      safety_critical: false,
      clinical_rule_ids: [],
    }],
    approvedTeachingRules: [],
  });
  const verdict = validateMentorPayload(
    {
      mode: MENTOR_MODE.TEACH,
      issue_id: "operative_reasoning",
      mentor_text: "Здесь нужно выполнить аппендэктомию прямо сейчас.",
      factual_claims: [],
      question_domain: null,
      scaffolding_level: 3,
    },
    brief,
    caseData,
    [],
    { learnerText: "что делать?" }
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "unsupported_clinical_recommendation");

  const drugDirective = validateMentorPayload(
    {
      mode: MENTOR_MODE.TEACH,
      issue_id: "operative_reasoning",
      mentor_text: "Назначь цефазолин сейчас.",
      factual_claims: [],
      question_domain: null,
      scaffolding_level: 3,
    },
    brief,
    caseData,
    [],
    { learnerText: "что делать?" }
  );
  assert.equal(drugDirective.reason, "unsupported_clinical_recommendation");

  // Quoting a learner's proposal back as a challenge is still natural
  // supervision; the quoted imperative is not the mentor's prescription.
  const quotedLearner = validateMentorPayload(
    {
      mode: MENTOR_MODE.CHALLENGE,
      issue_id: "operative_reasoning",
      mentor_text: "Ты говоришь: «назначь цефазолин». Чем обосновываешь?",
      factual_claims: [],
      question_domain: "management",
      scaffolding_level: 2,
    },
    brief,
    caseData,
    [],
    { learnerText: "назначь цефазолин" }
  );
  assert.equal(quotedLearner.ok, true);
});
