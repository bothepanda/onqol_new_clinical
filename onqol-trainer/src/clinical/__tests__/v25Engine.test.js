import assert from "node:assert/strict";
import test from "node:test";
import { createV25Case } from "../v25/caseFactory.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { createKnowledgeBase } from "../v25/knowledgeBase.js";
import { generateScenario, resolveActionResource } from "../v25/scenarioEngine.js";
import { buildV35Case } from "../v35/createCase.js";
import { resolveActionEta, turnEtaMinutes } from "../v25/resourceTiming.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";

function actionExtractorFor(intents) {
  return () => JSON.stringify({ intents, unresolved_fragments: [] });
}

test("V2.5 knowledge base is an internal versioned corpus", () => {
  const knowledgeBase = createKnowledgeBase();
  assert.equal(knowledgeBase.corpusVersion, "appendicitis-corpus-0.2.0");
  assert.ok(knowledgeBase.sources.length > 0);
  assert.equal(knowledgeBase.sources.every((source) => source.builtin === true), true);
});

test("V2.5 scenario generation is reproducible and uses zero to two shift constraints", () => {
  const first = generateScenario({ mode: "real", seed: "stable-seed" });
  const second = generateScenario({ mode: "real", seed: "stable-seed" });
  assert.deepEqual(first, second);
  assert.ok(first.constraints.length >= 0 && first.constraints.length <= 2);

  const cleanShift = generateScenario({ mode: "real", seed: "seed-0" });
  assert.equal(cleanShift.constraints.length, 0);
});

test("reference mode always has full resources and no random constraints", () => {
  const scenario = generateScenario({ mode: "reference", seed: "reference" });
  assert.equal(scenario.constraints.length, 0);
  assert.equal(scenario.facility.capabilities.ct.installed, true);
  assert.equal(scenario.facility.capabilities.laparoscopy.installed, true);
  assert.equal(resolveActionResource(scenario, "ct_abdomen").available, true);
});

test("initial V2.5 presentation does not leak the hidden facility profile", () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "real", seed: "demo-3" });
  const presentation = session.messages[0].content.toLowerCase();
  assert.doesNotMatch(presentation, /кт нет|узи-специалист|лапароскопической стойки нет|ремонт/);
  assert.equal(session.workingMemory.revealedConstraints.length, 0);
});

test("busy laparoscopic stack is revealed only on request and does not penalize the first attempt", async () => {
  const caseData = createV25Case();
  let session = createV25Session({ caseData, mode: "real", seed: "demo-3" });
  assert.equal(session.scenario.facility.id, "district_lap_no_ct");
  assert.deepEqual(session.scenario.constraints.map((item) => item.id), ["laparoscopy_busy_gynecology"]);

  const blocked = await advanceV25Session({
    caseData,
    session,
    input: "Выполняю лапароскопическую аппендэктомию",
  });
  assert.match(blocked.reply, /гинекологической операции/);
  assert.equal(blocked.session.completedActions.includes("open_appendectomy_here"), false);
  assert.equal(blocked.session.unnecessaryActions.length, 0);
  assert.deepEqual(blocked.session.workingMemory.revealedConstraints, ["laparoscopy"]);
  assert.equal(blocked.session.actionLog.at(-1).lifecycle_after, "blocked");

  session = blocked.session;
  const adapted = await advanceV25Session({
    caseData,
    session,
    input: "Тогда выполняю открытую аппендэктомию, антибиотикопрофилактика до разреза",
  });
  assert.equal(adapted.session.completedActions.includes("open_appendectomy_here"), true);
  assert.equal(adapted.session.completedActions.includes("preop_single_antibiotic_prophylaxis"), true);
  assert.equal(adapted.session.temporalState.sourceControl, true);
  assert.equal(adapted.session.actionLog.at(-2).technique, "open");
});

test("permanent CT absence is discovered on request without creating a low-value penalty", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "real", seed: "profile-5" });
  assert.equal(session.scenario.facility.capabilities.ct.installed, false);
  const result = await advanceV25Session({ caseData, session, input: "Назначаю КТ живота" });
  assert.match(result.reply, /КТ-аппарата.*нет/);
  assert.equal(result.session.completedActions.includes("ct_abdomen"), false);
  assert.equal(result.session.unnecessaryActions.includes("ct_abdomen"), false);
  assert.equal(result.session.temporalState.clockMinutes, 0);
});

test("generic operation proposal is remembered but not applied until access is operationalized", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "reference" });
  const proposed = await advanceV25Session({ caseData, session, input: "Беру пациентку на операцию" });
  assert.equal(proposed.session.temporalState.sourceControl, false);
  assert.equal(proposed.session.workingMemory.actionStates.open_appendectomy_here.status, "proposed");
  assert.match(proposed.reply, /Какой операционный доступ/);
});

test("parallel diagnostic orders advance by the longest turnaround, not the sum", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "reference" });
  const result = await advanceV25Session({
    caseData,
    session,
    input: "Назначаю ОАК, ОАМ и ХГЧ",
  });
  assert.equal(result.session.temporalState.clockMinutes, 35);
  assert.deepEqual(
    new Set(result.session.completedActions),
    new Set(["pregnancy_test", "cbc", "urinalysis"])
  );
});

test("diagnostic reasoning preserves time and responds to competing hypotheses contextually", async () => {
  const caseData = createV25Case();
  let session = createV25Session({ caseData, mode: "reference", seed: "reference" });

  let result = await advanceV25Session({
    caseData,
    session,
    input: "осмотр",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "request_examination", concept_id: "abdominal_exam", confidence: 0.99 },
      ]),
    },
  });
  assert.match(result.reply, /Осмотр живота/);
  assert.doesNotMatch(result.reply, /Что дальше/);

  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "анамнез?",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "request_history", concept_id: "focused_history", confidence: 0.99 },
      ]),
    },
  });
  assert.match(result.reply, /Анамнез/);
  assert.doesNotMatch(result.reply, /Что дальше/);
  assert.equal(result.session.temporalState.clockMinutes, 14);

  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "похоже на острый аппендицит или внематочную",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "diagnosis", concept_id: "diagnosis_acute_appendicitis", confidence: 0.99 },
        { type: "diagnosis", concept_id: "differential_ectopic", confidence: 0.99 },
      ]),
    },
  });

  assert.equal(result.session.temporalState.clockMinutes, 14);
  assert.equal(result.session.temporalState.status, "stable");
  assert.equal(result.session.workingMemory.workingDiagnosis.action_id, "diagnosis_acute_appendicitis");
  assert.deepEqual(result.session.workingMemory.differentials, ["differential_ectopic"]);
  assert.match(
    result.reply,
    /Как будешь различать острый аппендицит и внематочную беременность\?/
  );
  assert.doesNotMatch(result.reply, /Динамика|Как это меняет твою тактику/);
});

test("V2.5 debrief is deterministic, evidence-grounded and versioned in the event log", async () => {
  const caseData = createV25Case();
  let session = createV25Session({ caseData, mode: "reference", seed: "reference" });
  for (const input of [
    "Собираю анамнез и осматриваю живот",
    "Назначаю ОАК, ОАМ и ХГЧ",
    "Рабочий диагноз острый аппендицит",
    "Выполняю лапароскопическую аппендэктомию и однократную профилактику",
  ]) {
    const result = await advanceV25Session({ caseData, session, input });
    session = result.session;
  }
  const result = await advanceV25Session({ caseData, session, input: "конец кейса" });
  assert.equal(result.session.finished, true);
  assert.match(result.reply, /Итоговая оценка/);
  assert.match(result.reply, /Использованные источники/);
  assert.equal(result.session.eventLog.at(-1).event_type, "session_scored");
  assert.equal(result.session.eventLog.at(-1).rubric_version, result.session.scoring_rubric_version);
});

test("event log scrubs direct identifiers from learner text", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "reference" });
  const result = await advanceV25Session({
    caseData,
    session,
    input: "Мой ИИН 123456789012, собираю анамнез",
  });
  assert.match(result.session.eventLog.at(-1).raw_text_redacted, /\[IIN_REDACTED\]/);
  assert.doesNotMatch(result.session.eventLog.at(-1).raw_text_redacted, /123456789012/);
});

// --- turn kind, idempotency and the scoring contract -----------------------
//
// Every case below is taken from the first recorded live run, session
// 095a865b-249f-4037-aeb4-4cce0b81c1df on seed reference-d6c0a7cc.

test("asking for the question to be repeated is not a clinical action", async () => {
  // Turn 8 of the live run: "не понимаю вопроса" was routed as
  // `declare_uncertainty`, a proposed diagnosis, and charged four minutes.
  const caseData = createV25Case();
  let session = createV25Session({ caseData, mode: "reference", seed: "repair-1" });
  const before = session.temporalState.clockMinutes;

  const result = await advanceV25Session({
    caseData,
    session,
    input: "не понимаю вопроса",
    options: {
      // The extractor would have produced an action; the conversational
      // resolver must run before it and stop the turn.
      actionExtractorLLM: actionExtractorFor([
        { concept_id: "declare_uncertainty", type: "diagnosis", confidence: 0.99 },
      ]),
    },
  });

  assert.equal(result.plan.mode, "conversational_turn");
  assert.equal(result.plan.turnKind.kind, "clarification_request");
  assert.deepEqual(result.plan.operations, []);
  assert.equal(result.session.completedActions.length, 0);
  assert.equal(result.session.temporalState.clockMinutes, before, "часы не должны идти");
  assert.deepEqual(result.scoringEvents, []);
});

test("a repair turn restates the previous question instead of asking a new one", async () => {
  const caseData = createV25Case();
  let session = createV25Session({ caseData, mode: "reference", seed: "repair-2" });
  session = {
    ...session,
    messages: [
      ...session.messages,
      { role: "assistant", content: "Пациент стабилен. Какой следующий клинический шаг?" },
    ],
  };

  const result = await advanceV25Session({
    caseData,
    session,
    input: "не понимаю вопроса",
    options: { mentor: true },
  });

  assert.match(result.reply, /Какой следующий клинический шаг\?/);
  assert.equal(result.mentor, null, "наставник не выбирает новый ход на просьбу переспросить");
});

test("repeating a plan does not run the orders a second time", async () => {
  // Turn 9 of the live run: restating the same plan performed observation, NPO
  // and the fluids again and added another two hours.
  const caseData = createV25Case();
  let session = createV25Session({ caseData, mode: "reference", seed: "idem-1" });
  const extractor = actionExtractorFor([
    { concept_id: "npo", type: "management", confidence: 0.99 },
    { concept_id: "iv_fluids", type: "management", confidence: 0.99 },
  ]);

  const first = await advanceV25Session({
    caseData,
    session,
    input: "НПО, в/в натрия хлорид 1 л быстро, 1 л за след 3 часа",
    options: { actionExtractorLLM: extractor },
  });
  const afterFirst = first.session.temporalState.clockMinutes;
  assert.ok(afterFirst > 0, "первое назначение должно стоить времени");

  const second = await advanceV25Session({
    caseData,
    session: first.session,
    input: "я же сказала решение - НПО, в/в натрия хлорид 1 л быстро, 1 л за след 3 часа",
    options: { actionExtractorLLM: extractor },
  });

  assert.equal(second.plan.turnKind.kind, "repeat_or_correction");
  assert.deepEqual(second.plan.operations, [], "повтор не выполняет назначения заново");
  assert.deepEqual(
    second.plan.suppressedOperations.map((entry) => entry.action_id).sort(),
    ["iv_fluids", "npo"]
  );
  assert.equal(second.session.temporalState.clockMinutes, afterFirst, "часы не должны идти");
});

test("an explicit request to repeat an investigation still performs it", async () => {
  // Idempotency must not swallow serial re-examination: "повтори ОАК" is a real
  // second blood count.
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "idem-2" });
  const extractor = actionExtractorFor([
    { concept_id: "cbc", type: "request_test", confidence: 0.99 },
  ]);

  const first = await advanceV25Session({
    caseData,
    session,
    input: "оак",
    options: { actionExtractorLLM: extractor },
  });
  const second = await advanceV25Session({
    caseData,
    session: first.session,
    input: "повтори оак в динамике",
    options: { actionExtractorLLM: extractor },
  });

  assert.equal(second.plan.operations.length, 1, "явный повтор выполняется");
  assert.ok(
    second.session.temporalState.clockMinutes > first.session.temporalState.clockMinutes,
    "повторный анализ стоит времени"
  );
});

test("the log records the turn kind and what was not repeated", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "log-1" });
  const extractor = actionExtractorFor([
    { concept_id: "npo", type: "management", confidence: 0.99 },
  ]);
  const first = await advanceV25Session({
    caseData,
    session,
    input: "НПО",
    options: { actionExtractorLLM: extractor },
  });
  const second = await advanceV25Session({
    caseData,
    session: first.session,
    input: "я уже сказала - НПО",
    options: { actionExtractorLLM: extractor },
  });

  const turn = second.session.eventLog.at(-1);
  assert.equal(turn.event_type, "clinical_turn");
  assert.equal(turn.turn_kind, "repeat_or_correction");
  assert.deepEqual(
    turn.duplicate_suppressed.map((entry) => entry.action_id),
    ["npo"]
  );
  assert.equal(turn.elapsed_minutes, 0);
});

// --- typed concept registry ------------------------------------------------

test("an understood concept that is not an action gets its own answer", async () => {
  // Live run, turn 2: "пальцевое ректальное исследование" was recognised by the
  // router, mapped to an empty array and vanished without a word. Six different
  // situations shared that empty array; each now answers for itself.
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "kind-1" });

  const result = await advanceV25Session({
    caseData,
    session,
    input: "проведу пальцевое ректальное исследование и сделаю трузи",
    options: {
      conceptRegistry: resolveConcept,
      conceptMap: appendicitisRouterConceptMap,
      actionExtractorLLM: actionExtractorFor([
        { type: "request_examination", concept_id: "rectal_examination", confidence: 0.95 },
        { type: "request_test", concept_id: "transrectal_ultrasound", confidence: 0.95 },
      ]),
    },
  });

  assert.match(result.reply, /не смоделирован/i, "система должна сказать, чего нет");
  assert.equal(result.session.completedActions.length, 0);
  assert.equal(result.session.temporalState.clockMinutes, 0, "несмоделированное не стоит времени");
});

test("a hypothesis creates no action and reveals nothing", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "kind-2" });

  const result = await advanceV25Session({
    caseData,
    session,
    input: "думаю ещё про почечную колику",
    options: {
      conceptRegistry: resolveConcept,
      conceptMap: appendicitisRouterConceptMap,
      actionExtractorLLM: actionExtractorFor([
        { type: "diagnosis", concept_id: "renal_colic", confidence: 0.9 },
      ]),
    },
  });

  assert.equal(result.session.completedActions.length, 0);
  assert.equal(result.session.revealedFindings.length, 0);
  assert.equal(result.session.temporalState.clockMinutes, 0);
});

test("a vague antibiotic order is asked to be specified, not guessed", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "kind-3" });

  const result = await advanceV25Session({
    caseData,
    session,
    input: "назначаю антибиотики",
    options: {
      conceptRegistry: resolveConcept,
      conceptMap: appendicitisRouterConceptMap,
      actionExtractorLLM: actionExtractorFor([
        { type: "management", concept_id: "antibiotics", confidence: 0.95 },
      ]),
    },
  });

  assert.match(result.reply, /профилактика перед операцией/i);
  assert.equal(result.session.completedActions.length, 0, "движок не выбирает за резидента");
});

test("a narrow question about one sign does not hand over the whole examination", async () => {
  // The abdominal examination stays addressable slot by slot, so asking about
  // Rovsing answers about Rovsing.
  const { caseData } = buildV35Case({ seed: "slot-1", requestedPresetId: "APP-002" });
  const session = createV25Session({ caseData, mode: "reference", seed: "slot-1" });

  const result = await advanceV25Session({
    caseData,
    session,
    input: "симптом ровзинга есть?",
    options: {
      conceptRegistry: resolveConcept,
      conceptMap: appendicitisRouterConceptMap,
      actionExtractorLLM: actionExtractorFor([
        { type: "request_examination", concept_id: "rovsing_sign", confidence: 0.95 },
      ]),
    },
  });

  assert.match(result.reply, /Ровзинга/);
  assert.doesNotMatch(result.reply, /участвует в акте дыхания/, "весь осмотр выдавать нельзя");
  assert.doesNotMatch(result.reply, /перистальтика/i);
  assert.equal(result.session.revealedFindings.includes("abdominal_exam"), false);
});

// --- one resource resolver, one clock --------------------------------------

test("an ultrasound in a hospital that has one round the clock costs its turnaround", async () => {
  // Live run: reference facility, `ultrasound: coverage 24/7`, and the scan
  // still cost 360 minutes because a flat table said so. Of that session's 822
  // minutes, 360 came from this one number.
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "eta-1" });

  const eta = resolveActionEta(session.scenario, "abdominal_ultrasound");
  assert.equal(eta.available, true);
  assert.equal(eta.queue_delay_minutes, 0, "круглосуточное УЗИ не создаёт очереди");
  assert.equal(eta.total_eta_minutes, eta.baseline_turnaround_minutes);
  assert.ok(eta.total_eta_minutes < 60, `ожидался оборот, а не смена: ${eta.total_eta_minutes}`);
});

test("investigations ordered together cost the longest, not the sum", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "eta-2" });
  const ids = ["cbc", "urinalysis", "crp", "abdominal_ultrasound"];

  const longest = Math.max(
    ...ids.map((id) => resolveActionEta(session.scenario, id).total_eta_minutes)
  );
  assert.equal(turnEtaMinutes(session.scenario, ids), longest);

  const result = await advanceV25Session({
    caseData,
    session,
    input: "оак, оам, срб, узи обп",
    options: {
      actionExtractorLLM: actionExtractorFor(
        ids.map((concept_id) => ({ concept_id, type: "request_test", confidence: 0.99 }))
      ),
    },
  });
  assert.equal(result.session.temporalState.clockMinutes, longest);
});

test("asking when a result would come does not order it and does not move the clock", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "eta-3" });

  const result = await advanceV25Session({
    caseData,
    session,
    input: "когда будет доступно узи?",
    options: {
      conceptRegistry: resolveConcept,
      conceptMap: appendicitisRouterConceptMap,
      actionExtractorLLM: actionExtractorFor([
        { type: "question", concept_id: "resource_availability", confidence: 0.9 },
      ]),
    },
  });

  assert.match(result.reply, /Доступность ресурса/);
  assert.match(result.reply, /Результат ожидается/);
  assert.equal(result.session.temporalState.clockMinutes, 0, "вопрос не двигает часы");
  assert.equal(result.session.completedActions.length, 0, "вопрос ничего не заказывает");
});

test("the workflow clock and the disease clock are reported separately", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "eta-4" });
  const result = await advanceV25Session({
    caseData,
    session,
    input: "оак",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { concept_id: "cbc", type: "request_test", confidence: 0.99 },
      ]),
    },
  });

  const turn = result.session.eventLog.at(-1);
  assert.ok(Number.isFinite(turn.workflow_time_minutes));
  assert.ok(Number.isFinite(turn.disease_time_minutes));
  assert.ok(
    turn.disease_time_minutes > turn.workflow_time_minutes,
    "болезнь началась до поступления"
  );
  const breakdown = turn.time_cost_breakdown.find((entry) => entry.action_id === "cbc");
  assert.equal(breakdown.queue_delay_minutes, 0);
  assert.equal(breakdown.total_eta_minutes, breakdown.baseline_turnaround_minutes);
});

test("the opening timeline entry describes this patient, not a frozen one", () => {
  // It used to read "Стабильная пациентка с болью в правой подвздошной области
  // поступила ночью" for every patient - wrong sex and wrong site for most of
  // them, and an invented time of day.
  const male = buildV35Case({ seed: "tl-male", requestedPresetId: "APP-004" }).caseData;
  const session = createV25Session({ caseData: male, mode: "reference", seed: "tl-1" });
  const opening = session.temporalState.timeline[0].detail;

  assert.doesNotMatch(opening, /ночью/, "время суток никто не заявлял");
  assert.doesNotMatch(opening, /Стабильн/, "стабильность - утверждение резидента");
  const sex = male.patient_state.sex;
  if (sex === "male") assert.match(opening, /^Пациент /);
  if (sex === "female") assert.match(opening, /^Пациентка /);
});
