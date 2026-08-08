import assert from "node:assert/strict";
import test from "node:test";
import { createV25Case } from "../v25/caseFactory.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { createKnowledgeBase } from "../v25/knowledgeBase.js";
import { generateScenario, resolveActionResource } from "../v25/scenarioEngine.js";

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
