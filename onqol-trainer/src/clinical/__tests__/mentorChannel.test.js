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
  assert.deepEqual(moveTypes(brief), [MENTOR_MOVE.NEUTRAL_PROMPT]);
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

test("the mentor is never mute: the brief always renders to something", () => {
  const brief = buildMentorBrief({
    caseData,
    session: session(),
    plan: plan(),
    deterministicUpdate: update({ neutralPrompt: "" }),
  });
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
    deterministicUpdate: update(),
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
  assert.deepEqual(result.moveTypes, [MENTOR_MOVE.ESCALATION_APPROPRIATE]);
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
