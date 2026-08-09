import test from "node:test";
import assert from "node:assert/strict";
import { acuteAppendicitisCase } from "../cases/acuteAppendicitis.js";
import { createV25Case } from "../v25/caseFactory.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { appendicitisRouterConceptMap } from "../diseases/appendicitis/router/conceptMap.js";
import { composeCaseWithCore } from "../core/composeCase.js";
import {
  MENTOR_MOVE,
  buildMentorBrief,
  minimumAssessmentIds,
  renderMentorBrief,
} from "../core/mentorBrief.js";
import {
  buildMentorPrompt,
  leaksUnrevealedFinding,
  runMentorAgent,
  validateMentorText,
} from "../core/mentorAgent.js";
import {
  ENGINE_PHASES,
  MAX_HEURISTICS_PER_TURN,
  SEVERITY,
  mentorHeuristics,
} from "../core/mentorHeuristics.js";
import { createV3Case } from "../v3/caseFactory.js";
import { createEmptyReasoningState } from "../core/reasoningState.js";

const { caseData } = composeCaseWithCore(acuteAppendicitisCase, {
  operativeActionIds: ["open_appendectomy_here"],
  conceptMap: appendicitisRouterConceptMap,
  // Declared, not inferred: "you looked at the patient before calling for help".
  // NEEDS_CLINICAL_REVIEW before this drives any user-facing judgement.
  minimumAssessmentActionIds: ["focused_history", "abdominal_exam"],
});

const { caseData: caseWithoutBar } = composeCaseWithCore(acuteAppendicitisCase, {
  conceptMap: appendicitisRouterConceptMap,
});

function session(overrides = {}) {
  return {
    phase: "management",
    locale: "ru",
    completedActions: [],
    revealedFindings: [],
    workingMemory: { turnNumber: 2 },
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    prerequisiteWarnings: [],
    parsed: { recognizedButUndefined: [] },
    plannerPrompt: "Что делаешь дальше?",
    ...overrides,
  };
}

function update(overrides = {}) {
  return {
    scoringEvents: [],
    blockedOperations: [],
    neutralPrompt: "Что делаешь дальше?",
    ...overrides,
  };
}

function moveTypes(brief) {
  return brief.moves.map((move) => move.type);
}

test("the brief carries verdicts, never patient facts", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan({
      prerequisiteWarnings: [{ action_id: "open_appendectomy_here", missing: "informed_consent" }],
    }),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "open_appendectomy_here" }] }),
  });

  const serialized = JSON.stringify(brief);
  const findings = {
    ...caseData.available_findings,
    ...caseData.hidden_findings,
  };
  for (const [findingId, finding] of Object.entries(findings)) {
    assert.ok(
      !serialized.includes(finding.text),
      `brief leaked finding text for ${findingId}`
    );
  }
  assert.equal(brief.containsPatientFacts, false);
});

test("the mentor prompt is built without the Case Card", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan(),
    deterministicUpdate: update(),
  });
  const prompt = buildMentorPrompt({ brief, learnerText: "что дальше?" });
  const serialized = `${prompt.system}\n${prompt.user}`;

  for (const [findingId, finding] of Object.entries(caseData.hidden_findings)) {
    assert.ok(!serialized.includes(finding.text), `prompt exposed hidden finding ${findingId}`);
  }
  assert.ok(!serialized.includes("expected_actions"));
  assert.ok(!serialized.includes("diagnosis_truth"));
});

test("operating without consent produces a blocking stop, not a silent penalty", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan({
      prerequisiteWarnings: [
        { action_id: "open_appendectomy_here", missing: "informed_consent" },
        { action_id: "open_appendectomy_here", missing: "notify_anesthesia" },
      ],
    }),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "open_appendectomy_here" }] }),
  });

  const stops = brief.moves.filter((move) => move.type === MENTOR_MOVE.PREREQUISITE_STOP);
  assert.equal(stops.length, 2);
  assert.ok(stops.every((stop) => stop.severity === "blocking"));
  assert.match(renderMentorBrief(brief), /информированное согласие/i);
  assert.match(renderMentorBrief(brief), /анестезиолог/i);
  assert.ok(stops[0].evidence.length > 0, "a stop must carry its evidence");
});

test("a prerequisite warning for an action the learner did not take stays quiet", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan({
      prerequisiteWarnings: [{ action_id: "open_appendectomy_here", missing: "informed_consent" }],
    }),
    deterministicUpdate: update({ scoringEvents: [] }),
  });
  assert.deepEqual(moveTypes(brief), []);
  assert.equal(brief.silent, true);
});

test("without a reviewed bar the mentor does not judge escalation at all", () => {
  assert.equal(minimumAssessmentIds(caseWithoutBar), null);

  const brief = buildMentorBrief({
    caseData: caseWithoutBar,
    session: session({ completedActions: [] }),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "call_senior_surgeon" }] }),
  });

  const move = brief.moves.find((item) => item.action_id === "call_senior_surgeon");
  assert.equal(move.type, MENTOR_MOVE.ESCALATION_APPROPRIATE);
  assert.equal(move.minimum_assessment_declared, false);
});

test("escalation after the available minimum is affirmed", () => {
  const minimum = minimumAssessmentIds(caseData);
  assert.deepEqual(minimum.sort(), ["abdominal_exam", "focused_history"]);

  const brief = buildMentorBrief({
    caseData,
    session: session({ completedActions: minimum }),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "call_senior_surgeon" }] }),
  });

  assert.ok(moveTypes(brief).includes(MENTOR_MOVE.ESCALATION_APPROPRIATE));
  assert.match(renderMentorBrief(brief), /границ|зрел/i);
});

test("escalation instead of assessment is redirected, not praised", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session({ completedActions: [] }),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "call_senior_surgeon" }] }),
  });

  const move = brief.moves.find((item) => item.type === MENTOR_MOVE.ESCALATION_PREMATURE);
  assert.ok(move);
  assert.deepEqual(move.missing_before_escalation.sort(), ["abdominal_exam", "focused_history"]);
  assert.doesNotMatch(renderMentorBrief(brief), /зрелое поведение/i);
});

test("calling intensive care is not gated on completing the assessment first", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session({ completedActions: [] }),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "call_intensive_care" }] }),
  });
  assert.ok(moveTypes(brief).includes(MENTOR_MOVE.ESCALATION_APPROPRIATE));
});

test("declared uncertainty is normalised and narrowed", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "declare_uncertainty" }] }),
  });

  assert.ok(moveTypes(brief).includes(MENTOR_MOVE.UNCERTAINTY_DECLARED));
  const text = renderMentorBrief(brief);
  assert.match(text, /не провал|правильный ход/i);
  assert.match(text, /\?$/);
});

test("a sensible action outside the library is acknowledged instead of dropped", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan({ parsed: { recognizedButUndefined: ["nasogastric_tube"] } }),
    deterministicUpdate: update(),
  });

  const move = brief.moves.find((item) => item.type === MENTOR_MOVE.OUT_OF_SCOPE_RECOGNIZED);
  assert.ok(move);
  assert.equal(move.concept_id, "nasogastric_tube");
  assert.match(move.template, /не войдёт/i);
});

// POLICY CHANGE, deliberate. This test used to read "the mentor is never mute:
// the brief always renders to something", and it was listed as an invariant in
// HANDOFF.md. The author reversed it: asked whether "Что делаешь дальше?" every
// turn beats saying nothing, the answer was "пусть молчит лучше когда нечего
// сказать" - which is also SURGICAL_MENTOR_LOGIC.md section 19, do not
// overcorrect. Silence is now a legitimate mentor output.
//
// What survives is the narrower guarantee that actually mattered: the mentor
// never *fails* to speak when it has something to say. A brief with moves always
// renders to text, with or without a model.
test("a brief with moves always renders to something, with or without a model", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan(),
    deterministicUpdate: update({
      neutralPrompt: "",
      scoringEvents: [{ action_id: "declare_uncertainty" }],
    }),
  });
  assert.ok(brief.moves.length > 0);
  assert.equal(brief.silent, false);
  assert.ok(renderMentorBrief(brief).trim().length > 0);
});

test("deterministic rendering passes the mentor's own validator", () => {
  const cases = [
    update({ scoringEvents: [{ action_id: "call_senior_surgeon" }] }),
    update({ scoringEvents: [{ action_id: "declare_uncertainty" }] }),
    update({ scoringEvents: [{ action_id: "open_appendectomy_here" }] }),
    update(),
  ];

  for (const deterministicUpdate of cases) {
    const brief = buildMentorBrief({
      caseData,
      session: session(),
      plan: plan({
        prerequisiteWarnings: [{ action_id: "open_appendectomy_here", missing: "informed_consent" }],
      }),
      deterministicUpdate,
    });
    if (brief.silent) continue;
    const validation = validateMentorText(renderMentorBrief(brief), caseData, []);
    assert.ok(validation.ok, `fallback text rejected: ${validation.reason}`);
  }
});

test("the mentor may affirm professional behaviour - this is what V2 could not do", () => {
  const affirming = [
    "Хорошо, что позвал старшего. Знать границы своей компетентности — это рабочий навык, а не слабость. Что именно тебя остановило?",
    "Назвать неопределённость вслух — правильный ход. Каких данных тебе не хватает?",
  ];
  for (const text of affirming) {
    const validation = validateMentorText(text, caseData, []);
    assert.ok(validation.ok, `affirmation wrongly rejected: ${validation.reason}`);
  }
});

test("the mentor may not confirm the diagnosis before debrief", () => {
  const forbidden = [
    "Диагноз сформулирован верно, можно оперировать. Что дальше?",
    "Это подтверждает диагноз острого аппендицита. Согласен?",
    "Правильный диагноз, идём в операционную. Готов?",
  ];
  for (const text of forbidden) {
    const validation = validateMentorText(text, caseData, []);
    assert.equal(validation.ok, false, `should have rejected: ${text}`);
    assert.equal(validation.reason, "premature_diagnosis_confirmation");
  }
});

test("the mentor may not announce the expected clinical decision", () => {
  const validation = validateMentorText(
    "Здесь нужно выполнить аппендэктомию прямо сейчас. Согласен?",
    caseData,
    []
  );
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, "prescribed_expected_decision");
});

test("an unrevealed finding reconstructed by the model is caught", () => {
  const leaked =
    "Червеобразный отросток гиперемирован и утолщен, без перфорации. Что делаешь дальше?";
  const detection = leaksUnrevealedFinding(leaked, caseData, []);
  assert.equal(detection.leaked, true);
  assert.equal(detection.findingId, "operative_finding");

  const validation = validateMentorText(leaked, caseData, []);
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, "finding_leak");
});

test("a finding already revealed may be referred to", () => {
  const text =
    "Червеобразный отросток гиперемирован и утолщен, без перфорации. Что это меняет в плане?";
  const detection = leaksUnrevealedFinding(text, caseData, ["operative_finding"]);
  assert.equal(detection.leaked, false);
});

test("a rejected model reply falls back to deterministic text, never to silence", async () => {
  const brief = buildMentorBrief({
    caseData,
    session: session({ completedActions: minimumAssessmentIds(caseData) }),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "call_senior_surgeon" }] }),
  });

  const result = await runMentorAgent(
    { brief, learnerText: "зову старшего", caseData, revealedFindingIds: [] },
    { llm: async () => JSON.stringify({ mentor_text: "Правильный диагноз, оперируй." }) }
  );

  assert.equal(result.source, "deterministic");
  assert.equal(result.rejectionReason, "premature_diagnosis_confirmation");
  assert.ok(result.text.length > 0);
});

test("a model error falls back instead of failing the turn", async () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "declare_uncertainty" }] }),
  });

  const result = await runMentorAgent(
    { brief, learnerText: "что дальше?", caseData },
    {
      llm: async () => {
        throw new Error("network down");
      },
    }
  );

  assert.equal(result.source, "deterministic");
  assert.equal(result.rejectionReason, "mentor_agent_error");
  assert.ok(result.text.length > 0);
});

test("a valid model reply is used and reports its move types", async () => {
  const brief = buildMentorBrief({
    caseData,
    session: session({ completedActions: minimumAssessmentIds(caseData) }),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "call_senior_surgeon" }] }),
  });

  const result = await runMentorAgent(
    { brief, learnerText: "не уверен, зову старшего", caseData },
    {
      llm: async () =>
        JSON.stringify({
          mentor_text:
            "Хорошо, что зовёшь. Осмотр уже выполнен, значит вызов идёт после работы, а не вместо неё — это зрелое решение. Что именно тебя остановило?",
        }),
    }
  );

  assert.equal(result.source, "llm");
  assert.equal(result.rejectionReason, null);
  // Escalation is praised, and the core rule adds the second half of the lesson:
  // call, but say what you think first. The learner stated no assessment here,
  // so `consultation_replacing_reasoning` is eligible.
  assert.deepEqual(result.moveTypes, [
    MENTOR_MOVE.ESCALATION_APPROPRIATE,
    MENTOR_MOVE.OUTSTANDING_PRIORITY,
  ]);
});

test("without a configured model the mentor still speaks", async () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "declare_uncertainty" }] }),
  });

  const result = await runMentorAgent({ brief, learnerText: "я не знаю", caseData }, {});
  assert.equal(result.source, "deterministic");
  assert.match(result.text, /неопределённость/i);
});

// --- integration with the V2.5 engine ------------------------------------

test("mentor is off by default: V2.5 replies are unchanged", async () => {
  const v25Case = createV25Case();
  const session = createV25Session({ caseData: v25Case, mode: "reference", seed: "mentor-off" });
  const result = await advanceV25Session({
    caseData: v25Case,
    session,
    input: "Собираю анамнез и осматриваю живот",
  });

  assert.equal(result.mentor, null);
  assert.match(result.reply, /Анамнез|Осмотр живота/);
});

test("mentor on: the closing prompt is replaced by a pedagogical reply, facts survive", async () => {
  const v25Case = createV25Case();
  const session = createV25Session({ caseData: v25Case, mode: "reference", seed: "mentor-on" });
  const result = await advanceV25Session({
    caseData: v25Case,
    session,
    input: "Собираю анамнез и осматриваю живот",
    options: { mentor: true },
  });

  assert.ok(result.mentor);
  assert.equal(result.mentor.source, "deterministic");
  // patient facts still come from the Case Card
  assert.match(result.reply, /Анамнез|Осмотр живота/);
  // and the mentor's own text is appended
  assert.ok(result.reply.includes(result.mentor.text));
});

test("mentor on: operating without consent is stopped out loud", async () => {
  const composed = composeCaseWithCore(createV25Case(), {
    operativeActionIds: ["open_appendectomy_here"],
    minimumAssessmentActionIds: ["focused_history", "abdominal_exam"],
  });
  const session = createV25Session({ caseData: composed.caseData, mode: "reference", seed: "stop" });

  // V2.5 treats "беру на операцию" as a proposal; the stop belongs to the
  // moment the learner actually commits, not to thinking about it out loud.
  const proposed = await advanceV25Session({
    caseData: composed.caseData,
    session,
    input: "Ставлю диагноз острый аппендицит и беру пациентку на операцию",
    options: { mentor: true },
  });
  assert.doesNotMatch(proposed.reply, /информированное согласие/i);

  const committed = await advanceV25Session({
    caseData: composed.caseData,
    session: proposed.session,
    input: "Открытая аппендэктомия сейчас",
    options: { mentor: true },
  });

  assert.ok(committed.mentor);
  assert.ok(
    committed.mentor.moveTypes.includes(MENTOR_MOVE.PREREQUISITE_STOP),
    `expected a stop, got ${committed.mentor.moveTypes.join(", ")}`
  );
  assert.match(committed.reply, /информированное согласие|анестезиолог/i);

  // A stop that arrives after the appendix is out is not a stop: the operation
  // must not have been applied to the patient.
  assert.ok(
    !committed.session.revealedFindings.includes("operative_finding"),
    "the operative finding was revealed despite the block"
  );
  assert.equal(committed.session.temporalState.sourceControl, false);
  assert.equal(
    committed.session.workingMemory.actionStates.open_appendectomy_here.status,
    "blocked"
  );

  // Only the blocking items speak. A supervisor does not read out five points.
  const stops = committed.mentor.moveTypes.filter((type) => type === MENTOR_MOVE.PREREQUISITE_STOP);
  assert.equal(stops.length, 2);
});

test("advisory prerequisites never block the operation", async () => {
  const composed = composeCaseWithCore(createV25Case(), {
    // consent and anaesthesia are already satisfied below, leaving only the
    // advisory items outstanding
    operativeActionIds: ["open_appendectomy_here"],
  });
  let session = createV25Session({
    caseData: composed.caseData,
    mode: "reference",
    seed: "advisory",
  });
  session = {
    ...session,
    completedActions: ["informed_consent", "notify_anesthesia", "diagnosis_acute_appendicitis"],
  };

  const result = await advanceV25Session({
    caseData: composed.caseData,
    session,
    input: "Открытая аппендэктомия сейчас",
    options: { mentor: true },
  });

  assert.equal(result.session.temporalState.sourceControl, true);
  assert.ok(result.session.revealedFindings.includes("operative_finding"));
});

test("blocking enforcement can be turned off independently of the mentor", async () => {
  const composed = composeCaseWithCore(createV25Case(), {
    operativeActionIds: ["open_appendectomy_here"],
  });
  let session = createV25Session({ caseData: composed.caseData, mode: "reference", seed: "off" });
  session = { ...session, completedActions: ["diagnosis_acute_appendicitis"] };

  const result = await advanceV25Session({
    caseData: composed.caseData,
    session,
    input: "Открытая аппендэктомия сейчас",
    options: { mentor: true, enforceBlockingPrerequisites: false },
  });

  assert.equal(result.session.temporalState.sourceControl, true);
});

// --- grammatical gender ---------------------------------------------------

test("the mentor never assigns the learner a gender", () => {
  const gendered = [
    "Хорошо, что ты прямо обозначил неуверенность. Что дальше?",
    "Ты сделала правильный шаг, вызвав старшего. Что дальше?",
    "Ты уже осмотрел живот. Каких данных не хватает?",
    "Ты растерялся здесь. Что именно тебя остановило?",
  ];
  for (const text of gendered) {
    const validation = validateMentorText(text, caseData, []);
    assert.equal(validation.ok, false, `should have rejected: ${text}`);
    assert.equal(validation.reason, "gendered_address");
  }
});

test("neutral phrasings are accepted", () => {
  const neutral = [
    "Хорошо, что неуверенность названа прямо — это не провал. Каких данных не хватает?",
    "Ты зовёшь старшего до собственной оценки. Что именно тебя останавливает?",
    "Осмотр выполнен, значит вызов идёт после работы, а не вместо неё. Что дальше?",
    "Назвать неопределённость вслух — правильный ход. Что нужно уточнить?",
  ];
  for (const text of neutral) {
    const validation = validateMentorText(text, caseData, []);
    assert.ok(validation.ok, `wrongly rejected (${validation.reason}): ${text}`);
  }
});

test("every authored mentor template is gender-neutral", () => {
  const briefs = [
    update({ scoringEvents: [{ action_id: "call_senior_surgeon" }] }),
    update({ scoringEvents: [{ action_id: "call_intensive_care" }] }),
    update({ scoringEvents: [{ action_id: "declare_uncertainty" }] }),
    update({ scoringEvents: [{ action_id: "open_appendectomy_here" }] }),
    update(),
  ];

  for (const completedActions of [[], minimumAssessmentIds(caseData)]) {
    for (const deterministicUpdate of briefs) {
      const brief = buildMentorBrief({
        caseData,
        session: session({ completedActions }),
        plan: plan({
          prerequisiteWarnings: [
            { action_id: "open_appendectomy_here", missing: "informed_consent" },
          ],
        }),
        deterministicUpdate,
      });
      const rendered = renderMentorBrief(brief);
      // Silence renders to "" and is a valid outcome; only actual text is judged.
      if (brief.silent) continue;
      const validation = validateMentorText(rendered, caseData, []);
      assert.ok(validation.ok, `authored template rejected (${validation.reason}): ${rendered}`);
    }
  }
});

test("a gendered model reply falls back to the neutral authored text", async () => {
  const brief = buildMentorBrief({
    caseData,
    session: session({ completedActions: minimumAssessmentIds(caseData) }),
    plan: plan(),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "call_senior_surgeon" }] }),
  });

  const result = await runMentorAgent(
    { brief, learnerText: "зову старшего", caseData },
    { llm: async () => JSON.stringify({ mentor_text: "Молодец, ты правильно поступил." }) }
  );

  assert.equal(result.source, "deterministic");
  assert.equal(result.rejectionReason, "gendered_address");
  const validation = validateMentorText(result.text, caseData, []);
  assert.ok(validation.ok);
});

// --- what already happened this turn --------------------------------------

test("the brief names what was just performed, without its results", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session({ completedActions: ["focused_history", "abdominal_exam"] }),
    plan: plan(),
    deterministicUpdate: update({
      scoringEvents: [{ action_id: "focused_history" }, { action_id: "abdominal_exam" }],
      findingsRevealed: ["focused_history", "abdominal_exam"],
    }),
  });

  assert.deepEqual(
    brief.justPerformed.map((entry) => entry.action_id).sort(),
    ["abdominal_exam", "focused_history"]
  );
  assert.ok(brief.justPerformed.every((entry) => entry.concept));
  assert.equal(brief.resultsAlreadyDelivered, true);

  // Names, not findings: the no-facts invariant must still hold.
  const serialized = JSON.stringify(brief);
  for (const finding of Object.values(caseData.available_findings)) {
    assert.ok(!serialized.includes(finding.text));
  }
});

test("the mentor prompt states that those actions are already answered", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan(),
    deterministicUpdate: update({
      scoringEvents: [{ action_id: "abdominal_exam" }],
      findingsRevealed: ["abdominal_exam"],
    }),
  });
  const prompt = buildMentorPrompt({ brief, learnerText: "физикальный осмотр и анамнез" });

  assert.match(prompt.system, /just_performed/);
  assert.match(prompt.system, /Never instruct the learner to do something listed in just_performed/);
  assert.match(prompt.user, /"just_performed"/);
  assert.match(prompt.user, /abdominal_exam/);
  assert.match(prompt.user, /"results_already_delivered": true/);
});

test("a turn with nothing performed reports an empty just_performed", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan(),
    deterministicUpdate: update(),
  });
  assert.deepEqual(brief.justPerformed, []);
  assert.equal(brief.resultsAlreadyDelivered, false);
});

// --- Proactive heuristics ------------------------------------------------
//
// The mentor's other five moves all wait for the learner to act. These check
// the one channel that speaks about what is NOT happening.

// Build a session whose learner has articulated the named reasoning flags.
function reasoning(overrides = {}) {
  const state = createEmptyReasoningState();
  if (overrides.workingDiagnosis) state.working_diagnosis.stated = true;
  if (overrides.stability) state.stability.stated = true;
  if (overrides.dangerousAlternative) state.differential.has_dangerous_alternative = true;
  if (overrides.managementPlan) state.management.plan_stated = true;
  if (overrides.contingency) state.contingency.stated = true;
  if (overrides.ownAssessment) state.consultation.own_assessment_stated = true;
  if (overrides.disposition) state.disposition.stated = true;
  if (overrides.observation) state.observation.active = true;
  if (overrides.observationComplete) {
    state.observation.active = true;
    state.observation.goal_stated = true;
    state.observation.reassessment_interval_stated = true;
    state.observation.escalation_criteria_stated = true;
  }
  return state;
}

test("the mentor names what is missing instead of asking 'что дальше?'", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session({
      phase: "diagnostic_workup",
      completedActions: ["focused_history", "abdominal_exam"],
      workingMemory: {
        turnNumber: 4,
        // The learner named a diagnosis and said nothing about stability.
        reasoningState: reasoning({ workingDiagnosis: true, dangerousAlternative: true }),
      },
    }),
    plan: plan(),
    deterministicUpdate: update(),
  });

  const types = brief.moves.map((move) => move.type);
  assert.ok(
    !types.includes(MENTOR_MOVE.NEUTRAL_PROMPT),
    "a fired heuristic must replace the neutral prompt, not sit beside it"
  );
  assert.ok(brief.firedHeuristicKeys.includes("hypothesis_without_stability"));
  assert.match(renderMentorBrief(brief), /стабилен/i);
});

test("a heuristic never fires on a case that lacks the actions it names", () => {
  // Without the guard, `not_completed` on an unknown action is vacuously true
  // and the heuristic would fire on every single turn of every other nosology.
  const strippedCase = { ...caseData, expected_actions: [], acceptable_alternatives: [], unnecessary_actions: [], unsafe_actions: [] };
  const brief = buildMentorBrief({
    caseData: strippedCase,
    session: session({ phase: "diagnostic_workup", workingMemory: { turnNumber: 9 } }),
    plan: plan(),
    deterministicUpdate: update(),
  });

  assert.deepEqual(brief.firedHeuristicKeys, []);
  assert.equal(brief.silent, true);
});

test("a blocking stop silences the heuristic - one thing at a time", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session({
      completedActions: ["focused_history", "abdominal_exam"],
      workingMemory: { turnNumber: 6 },
    }),
    plan: plan({
      prerequisiteWarnings: [
        { action_id: "open_appendectomy_here", missing: "informed_consent" },
      ],
    }),
    deterministicUpdate: update({ scoringEvents: [{ action_id: "open_appendectomy_here" }] }),
  });

  assert.deepEqual(brief.firedHeuristicKeys, []);
  assert.ok(brief.moves.some((move) => move.type === MENTOR_MOVE.PREREQUISITE_STOP));
});

test("a heuristic speaks once per session", () => {
  const state = {
    phase: "diagnostic_workup",
    completedActions: ["focused_history", "abdominal_exam"],
    workingMemory: { turnNumber: 4, firedHeuristicIds: ["analgesia_withheld"] },
  };
  const brief = buildMentorBrief({
    caseData,
    session: session(state),
    plan: plan(),
    deterministicUpdate: update(),
  });

  assert.deepEqual(brief.firedHeuristicKeys, []);
  assert.equal(brief.silent, true);
});

test("with nothing to say the mentor stays silent, not chatty", () => {
  // "Пусть молчит лучше когда нечего сказать." SURGICAL_MENTOR_LOGIC.md 19.
  const brief = buildMentorBrief({
    caseData,
    session: session({ phase: "presentation", workingMemory: { turnNumber: 1 } }),
    plan: plan(),
    deterministicUpdate: update(),
  });

  assert.equal(brief.silent, true);
  assert.equal(brief.moves.length, 0);
  assert.equal(renderMentorBrief(brief), "");
});

test("the more critical remark comes first, and at most two are made", () => {
  // Several heuristics match this state. Priority is the declared severity, not
  // the order of lines in the file: "смотря что критичнее".
  const brief = buildMentorBrief({
    caseData,
    session: session({
      phase: "decision",
      completedActions: ["focused_history", "abdominal_exam", "diagnosis_acute_appendicitis"],
      workingMemory: { turnNumber: 5, reasoningState: reasoning({ workingDiagnosis: true }) },
    }),
    plan: plan(),
    deterministicUpdate: update(),
  });

  const severities = brief.moves.map((move) => move.severity);
  assert.equal(brief.moves.length, MAX_HEURISTICS_PER_TURN);
  assert.deepEqual([...severities].sort((a, b) => b - a), severities);
  assert.equal(severities[0], SEVERITY.IMPORTANT_OMISSION);
});

test("deterioration lets a heuristic speak a second time", () => {
  // The author's answer to "should it re-arm": yes, when the patient gets worse
  // and the learner does nothing for a couple of steps.
  const deteriorating = session({
    phase: "decision",
    completedActions: ["focused_history", "abdominal_exam", "diagnosis_acute_appendicitis"],
    workingMemory: {
      turnNumber: 8,
      // Already said everything once, including the safety remark - but at the
      // status the patient had then.
      firedHeuristicIds: [
        "deterioration_unanswered@stable",
        "hypothesis_without_stability",
        "premature_closure",
        "hypothesis_without_management",
      ],
    },
    temporalState: { clockMinutes: 300, status: "delayed_source_control", flags: ["delay_risk"] },
  });

  const brief = buildMentorBrief({
    caseData,
    session: deteriorating,
    plan: plan(),
    deterministicUpdate: update(),
  });

  assert.ok(
    brief.firedHeuristicKeys.includes("deterioration_unanswered@delayed_source_control"),
    "a worsening patient must re-arm the safety-critical remark"
  );
  assert.equal(brief.moves[0].severity, SEVERITY.SAFETY_CRITICAL);
});

test("heuristic lines obey the same locks as any other mentor text", () => {
  // Every line is shown to the learner verbatim when no model is configured, so
  // it has to survive the validator on its own: no patient finding, no
  // diagnosis, no gendered address to the learner.
  for (const heuristic of mentorHeuristics) {
    const verdict = validateMentorText(heuristic.mentor_line, caseData, []);
    assert.equal(verdict.ok, true, `${heuristic.id}: ${verdict.reason}`);
  }
});

test("senior-surgeon heuristics are opinion and cannot move the score", () => {
  for (const heuristic of mentorHeuristics) {
    assert.equal(
      heuristic.eligible_for_scoring,
      false,
      `${heuristic.id} must not be scoreable before clinical review`
    );
    assert.ok(
      ["EXPERT_OPINION_UNREVIEWED", "EXPERT_OPINION_NEEDS_SOURCE_VERIFICATION"].includes(
        heuristic.provenance
      ),
      `${heuristic.id} carries an unrecognised provenance: ${heuristic.provenance}`
    );
    assert.ok(
      heuristic.rationale_for_reviewer,
      `${heuristic.id} must carry a rationale for the reviewer`
    );
    assert.ok(heuristic.spec_section, `${heuristic.id} must cite a section of the mentor spec`);
    assert.ok(
      Number.isInteger(heuristic.severity) && heuristic.severity >= 0 && heuristic.severity <= 4,
      `${heuristic.id} must declare a severity from the spec's 0-4 scale`
    );
  }
});

test("heuristics gate on real engine phases", () => {
  // The failure this guards against: gating on the case-action phase vocabulary
  // ("diagnosis", "management") instead of the engine's temporal phases. Every
  // unit test passed and nothing fired in a real session.
  for (const heuristic of mentorHeuristics) {
    for (const phase of heuristic.when.phase || []) {
      assert.ok(
        ENGINE_PHASES.includes(phase),
        `${heuristic.id} gates on "${phase}", which is not an engine phase`
      );
    }
  }
});

test("a heuristic fires in a real session, not only in a hand-built one", async () => {
  // Regression. The first version of these heuristics gated on phase names taken
  // from the case action vocabulary ("diagnosis", "management") instead of the
  // engine's temporal phases ("diagnostic_workup", "decision"). Every unit test
  // passed, because each one handed buildMentorBrief the same wrong name it was
  // asserting against. Nothing fired in an actual session. Only a run through
  // the engine can catch that class of mistake.
  const v3Case = createV3Case();
  let session = createV25Session({ caseData: v3Case, mode: "reference", seed: "heuristics" });

  const turns = [
    "соберу анамнез, спрошу про миграцию боли",
    "осмотрю живот, пальпация, симптомы раздражения брюшины",
    "оак и общий анализ мочи",
    "тест на беременность",
    "думаю про острый аппендицит",
  ];
  for (const input of turns) {
    const result = await advanceV25Session({
      caseData: v3Case,
      session,
      input,
      options: { mentor: true },
    });
    session = result.session;
  }

  assert.ok(
    session.workingMemory.firedHeuristicIds.length > 0,
    "no heuristic spoke across a whole diagnostic workup - check the `when` gates against real engine phases"
  );
});
