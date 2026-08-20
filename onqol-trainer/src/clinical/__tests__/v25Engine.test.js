import assert from "node:assert/strict";
import test from "node:test";
import { createV25Case } from "../v25/caseFactory.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { createKnowledgeBase } from "../v25/knowledgeBase.js";
import {
  generateScenario,
  resolveActionResource,
  resolveScenarioResource,
} from "../v25/scenarioEngine.js";
import { buildV35Case } from "../v35/createCase.js";
import { scoreSession } from "../scoring.js";
import { resolveActionEta, turnEtaMinutes } from "../v25/resourceTiming.js";
import { buildV25ReplayExport } from "../v25/replayExport.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";

function actionExtractorFor(intents) {
  return () => JSON.stringify({ intents, unresolved_fragments: [] });
}

function lastEvent(session, eventType) {
  return session.eventLog.findLast((entry) => entry.event_type === eventType);
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

test("V3.5 real mode uses the case's canonical KZ profile instead of a random facility", () => {
  const districtCase = buildV35Case({
    seed: "profile-district",
    requestedPresetId: "APP-001",
  }).caseData;
  const district = createV25Session({
    caseData: districtCase,
    mode: "real",
    seed: "profile-district",
  });
  assert.equal(district.scenario.declaredResourceProfileId, "KZ-R1-DISTRICT");
  assert.equal(district.scenario.effectiveResourceProfileId, "KZ-R1-DISTRICT");
  assert.equal(district.scenario.facility.id, "KZ-R1-DISTRICT");
  assert.equal(district.scenario.facility.capabilities.ct.installed, false);

  const urbanCase = buildV35Case({
    seed: "profile-urban",
    requestedPresetId: "APP-003",
  }).caseData;
  const urban = createV25Session({ caseData: urbanCase, mode: "real", seed: "profile-urban" });
  assert.equal(urban.scenario.facility.id, "KZ-R2-URBAN");
  assert.equal(urban.scenario.facility.capabilities.ct.installed, true);

  const reference = createV25Session({
    caseData: districtCase,
    mode: "reference",
    seed: "profile-reference",
  });
  assert.equal(reference.scenario.declaredResourceProfileId, "KZ-R1-DISTRICT");
  assert.equal(reference.scenario.effectiveResourceProfileId, "REFERENCE-FULL");
  assert.equal(reference.scenario.constraints.length, 0);
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
    input: "Выбираю лапароскопическую аппендэктомию",
  });
  assert.match(blocked.reply, /гинекологической операции/);
  assert.equal(blocked.session.temporalState.sourceControl, false);
  assert.equal(blocked.session.unnecessaryActions.length, 0);
  assert.deepEqual(blocked.session.workingMemory.revealedConstraints, ["laparoscopy"]);
  assert.equal(blocked.session.actionLog.at(-1).lifecycle_after, "blocked");

  session = blocked.session;
  const adapted = await advanceV25Session({
    caseData,
    session,
    input: "Тогда выбираю открытую аппендэктомию",
  });
  assert.equal(adapted.session.workingMemory.operativeApproach.approach, "open");
  assert.equal(adapted.session.workingMemory.operativeApproach.status, "selected");
  assert.equal(adapted.session.temporalState.sourceControl, false);
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
  const proposed = await advanceV25Session({ caseData, session, input: "Готовим к аппендэктомии" });
  assert.equal(proposed.session.temporalState.sourceControl, false);
  assert.equal(proposed.session.workingMemory.operativeDecision.status, "proposed");
  assert.equal(proposed.session.workingMemory.operativeState.procedure_started, false);
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
  assert.equal(result.session.terminal_status, "completed");
  assert.equal(result.session.completion_status, "completed");
  assert.match(result.reply, /Итоговая оценка/);
  assert.match(result.reply, /Использованные источники/);
  assert.equal(result.session.eventLog.at(-1).event_type, "session_scored");
  assert.equal(result.session.eventLog.at(-1).rubric_version, result.session.scoring_rubric_version);
});

test("ending before the first clinical turn abandons the session without scoring", async () => {
  const { caseData } = buildV35Case({ seed: "turn-zero", requestedPresetId: "APP-001" });
  const session = createV25Session({ caseData, mode: "reference", seed: "turn-zero" });
  const result = await advanceV25Session({ caseData, session, input: "конец кейса" });

  assert.equal(result.session.finished, true);
  assert.equal(result.session.terminal_status, "abandoned");
  assert.equal(result.session.completion_status, "abandoned");
  assert.equal(result.session.scoring, null);
  assert.equal(result.session.report, null);
  assert.equal(result.session.eventLog.at(-1).event_type, "session_abandoned");
  assert.equal(result.session.eventLog.at(-1).reason, "ended_before_first_clinical_turn");
  assert.equal(result.session.eventLog.some((entry) => entry.event_type === "session_scored"), false);
  assert.equal(
    result.session.eventLog.some((entry) => entry.event_type === "session_formative_completed"),
    false
  );
  assert.deepEqual(result.scoringEvents, []);
  assert.match(result.reply, /до первого клинического хода/);
});

test("V3.5 completion produces formative domains and never a numeric score", async () => {
  const { caseData } = buildV35Case({ seed: "no-numeric-score", requestedPresetId: "APP-001" });
  let session = createV25Session({ caseData, mode: "reference", seed: "no-numeric-score" });
  session = (
    await advanceV25Session({ caseData, session, input: "Собираю анамнез" })
  ).session;
  const result = await advanceV25Session({ caseData, session, input: "конец кейса" });

  assert.equal(result.session.finished, true);
  assert.equal(result.session.terminal_status, "incomplete");
  assert.equal(result.session.scoring.mode, "formative_only");
  assert.equal(result.session.scoring.eligibleForScoring, false);
  assert.equal(result.session.scoring.overallScore, null);
  assert.ok(Object.values(result.session.scoring.domainScores).every((value) => value === null));
  assert.doesNotMatch(result.reply, /Итоговая оценка|\d+%/);
  assert.match(result.reply, /числовой балл отключён/i);
  assert.equal(result.session.eventLog.at(-1).event_type, "session_formative_incomplete");
  assert.equal(
    result.session.eventLog.some((entry) => entry.event_type === "session_scored"),
    false
  );
  assert.deepEqual(result.scoringEvents, [
    { type: "formative_feedback_incomplete", overall_score: null },
  ]);
  assert.throws(
    () => scoreSession(caseData, result.session),
    /Numeric scoring is disabled/
  );
});

test("V3.5 stable runtime path reaches discharge before a completed debrief", async () => {
  const { caseData } = buildV35Case({ seed: "stable-endpoint", requestedPresetId: "APP-001" });
  let session = createV25Session({ caseData, mode: "reference", seed: "stable-endpoint" });

  let result = await advanceV25Session({
    caseData,
    session,
    input: "Выписываю с рекомендациями",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "management", concept_id: "discharge_and_followup", confidence: 0.99 },
      ]),
    },
  });
  assert.equal(result.session.completedActions.includes("discharge_and_followup"), false);
  assert.match(result.reply, /Выписка пока не может быть завершена/);

  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "Предоперационная подготовка и чек-лист",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "management", concept_id: "informed_consent", confidence: 0.99 },
        { type: "management", concept_id: "notify_anesthesia", confidence: 0.99 },
        { type: "management", concept_id: "notify_operating_team", confidence: 0.99 },
        { type: "management", concept_id: "who_sign_in", confidence: 0.99 },
        { type: "management", concept_id: "who_time_out", confidence: 0.99 },
        {
          type: "management",
          concept_id: "preop_single_antibiotic_prophylaxis",
          confidence: 0.99,
        },
      ]),
    },
  });
  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "Выбираю лапароскопическую аппендэктомию",
    options: {
      actionExtractorLLM: actionExtractorFor([
        {
          type: "management",
          concept_id: "operative_approach_laparoscopic",
          confidence: 0.99,
        },
      ]),
      conceptMap: appendicitisRouterConceptMap,
      conceptRegistry: resolveConcept,
    },
  });
  assert.equal(result.session.temporalState.sourceControl, false);
  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "Начинаю операцию",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "management", concept_id: "appendectomy_procedure_start", confidence: 0.99 },
      ]),
    },
  });
  assert.equal(result.session.workingMemory.operativeState.procedure_started, true);
  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "Аппендэктомия выполнена, контроль источника завершён",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "management", concept_id: "appendectomy_here", confidence: 0.99 },
      ]),
    },
  });
  assert.equal(result.session.pathState, "operation");

  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "Передаю пациента из операционной",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "management", concept_id: "structured_handover", confidence: 0.99 },
      ]),
    },
  });
  // CONTRACT CHANGED, CDR-18 (owner, 20.08.2026): Sign Out is theatre work and
  // no longer gates the handover. The handover itself still has to be given.
  assert.equal(result.session.completedActions.includes("structured_handover"), true);
  assert.doesNotMatch(result.reply, /Sign Out/);
  assert.equal(result.session.pathState, "postop_destination");

  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "Контролирую после операции витальные, боль, живот, диурез, питание и рану",
    options: {
      actionExtractorLLM: actionExtractorFor([
        // Live language routing chose the broader observation concept here. The
        // deterministic phase must narrow it to postoperative reassessment.
        { type: "management", concept_id: "active_observation", confidence: 0.99 },
      ]),
    },
  });
  assert.equal(result.session.completedActions.includes("postoperative_reassessment"), true);
  assert.equal(result.session.completedActions.includes("active_observation"), false);
  assert.equal(result.session.pathState, "ward_care");

  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "Фиксирую готовность, лекарства, инструкции, наблюдение и критерии возврата",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "management", concept_id: "discharge_and_followup", confidence: 0.99 },
      ]),
    },
  });
  assert.equal(result.session.pathState, "discharge");
  assert.match(result.reply, /Стабильный путь завершён/);

  session = result.session;
  result = await advanceV25Session({ caseData, session, input: "конец кейса" });
  assert.equal(result.session.terminal_status, "completed");
  assert.equal(result.session.pathState, "complete");
  assert.equal(result.session.eventLog.at(-1).event_type, "session_formative_completed");
  assert.equal(result.session.report.pathwayStatus, "completed");
  assert.match(result.reply, /выписка и дальнейшее наблюдение зафиксированы/);
});

test("session_started and replay export carry complete deterministic V3.5 inputs", async () => {
  const { caseData } = buildV35Case({ seed: "replay-seed", requestedPresetId: "APP-002" });
  let session = createV25Session({
    caseData,
    mode: "reference",
    seed: "replay-seed",
    startedAt: "2026-08-10T00:00:00.000Z",
    participantConsent: {
      accepted: true,
      policy_version: "pilot-data-notice-test-v1",
      accepted_at: "2026-08-10T00:00:00.000Z",
      provider_processing_disclosed: true,
      provider_default_abuse_log_retention_days: 30,
      local_retention_days: 7,
    },
  });
  const started = session.eventLog[0];

  assert.equal(started.event_type, "session_started");
  assert.equal(started.engine_version, session.engine_version);
  assert.equal(started.product_version, "3.5");
  assert.equal(started.content_version, caseData.v35_composition.content_version);
  assert.equal(started.case_preset_id, "APP-002");
  assert.equal(started.requested_seed, "replay-seed");
  assert.equal(started.effective_seed, caseData.v35_composition.effective_seed);
  assert.deepEqual(started.selection_attempts, caseData.v35_composition.selection_attempts);
  assert.equal(started.participant_consent.policy_version, "pilot-data-notice-test-v1");
  assert.equal(session.scoring_rubric_version, caseData.scoring_rubric_version);

  session = {
    ...session,
    messages: [...session.messages, { role: "user", content: "Мой ИИН 123456789012" }],
    workingMemory: {
      ...session.workingMemory,
      reasoningState: {
        ...(session.workingMemory?.reasoningState || {}),
        problem_representation_verbatim: "Мой ИИН 123456789012",
      },
    },
    eventLog: [
      ...session.eventLog,
      {
        event_type: "test_raw_input",
        raw_text_redacted: "Мой ИИН [IIN_REDACTED]",
        clinical_fact: "appendicitis",
      },
    ],
  };
  const payload = buildV25ReplayExport(session, "2026-08-10T01:00:00.000Z", {
    clinicalReports: [
      { report_id: "rep-current", context: { session_id: session.session_id } },
      { report_id: "rep-other", context: { session_id: "another-session" } },
    ],
  });
  assert.equal(payload.export_schema_version, "3.5.0");
  assert.equal(payload.replay.engine_version, session.engine_version);
  assert.equal(payload.replay.case_preset_id, "APP-002");
  assert.equal(payload.replay.requested_seed, "replay-seed");
  assert.deepEqual(payload.session.scenario, session.scenario);
  assert.deepEqual(payload.session.v35_composition, caseData.v35_composition);
  assert.equal(payload.data_policy.raw_learner_text_included, false);
  assert.equal(payload.data_policy.verbatim_transcript_included_after_identifier_scrubbing, true);
  assert.equal(payload.data_policy.provider_processing_disclosed_to_participant, true);
  assert.equal(payload.session.participant_consent.local_retention_days, 7);
  assert.deepEqual(payload.clinical_reports.map((report) => report.report_id), ["rep-current"]);
  assert.match(payload.transcript.at(-1).content, /\[IIN_REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(payload), /123456789012/);
  assert.equal(payload.events.at(-1).clinical_fact, "appendicitis");
  assert.equal("raw_text_redacted" in payload.events.at(-1), false);
  assert.equal(
    "problem_representation_verbatim" in payload.state_snapshot.working_memory.reasoningState,
    false
  );
});

test("event log scrubs direct identifiers from learner text", async () => {
  const caseData = createV25Case();
  const session = createV25Session({ caseData, mode: "reference", seed: "reference" });
  const result = await advanceV25Session({
    caseData,
    session,
    input: "Мой ИИН 123456789012, собираю анамнез",
  });
  const turn = lastEvent(result.session, "clinical_turn");
  assert.match(turn.raw_text_redacted, /\[IIN_REDACTED\]/);
  assert.doesNotMatch(turn.raw_text_redacted, /123456789012/);
});

test("model-backed and local turns are separated into explicit evaluation groups", async () => {
  const caseData = createV25Case();
  const local = await advanceV25Session({
    caseData,
    session: createV25Session({ caseData, mode: "reference", seed: "group-local" }),
    input: "собираю анамнез",
  });
  assert.equal(lastEvent(local.session, "execution_profile").evaluation_group, "local_fallback");

  const model = await advanceV25Session({
    caseData,
    session: createV25Session({ caseData, mode: "reference", seed: "group-model" }),
    input: "назначаю ОАК",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { concept_id: "cbc", type: "request_test", confidence: 0.99 },
      ]),
      provider: "openai",
      routerModel: "router-test-model",
      gatewayVersion: "gateway-test-version",
      schemaVersions: { router: { version: "router-v2", ready: true } },
    },
  });
  const profile = lastEvent(model.session, "execution_profile");
  assert.equal(profile.evaluation_group, "model_backed");
  assert.equal(profile.router_execution, "model");
  assert.equal(profile.router_model, "router-test-model");
  assert.equal(profile.gateway_version, "gateway-test-version");
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
  assert.equal(result.plan.turnKind.kind, "conversation_management");
  assert.equal(result.plan.turnKind.legacy_kind, "clarification_request");
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

  // CONTRACT CHANGED, base rules v2 §2.1: the router is the gate on execution,
  // not on speech, so a conversation-management turn now reaches the mentor too.
  // Nothing executed and the clock did not move (asserted above); a silent
  // mentor still leaves the deterministic restatement standing, which is what
  // happens here without a model.
  assert.match(result.reply, /Какой следующий клинический шаг\?/);
  assert.equal(result.mentor.mode, "CONTINUE");
  assert.equal(result.session.completedActions.length, 0);
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

  assert.equal(second.plan.turnKind.kind, "clinical_action");
  assert.equal(second.plan.turnKind.legacy_kind, "repeat_or_correction");
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

  const turn = lastEvent(second.session, "clinical_turn");
  assert.equal(turn.event_type, "clinical_turn");
  assert.equal(turn.turn_kind, "clinical_action");
  assert.equal(turn.turn_legacy_kind, "repeat_or_correction");
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

test("delayed, unavailable and transfer-only resources have distinct absolute states", () => {
  const delayedScenario = generateScenario({ mode: "real", seed: "clock-0" });
  assert.equal(delayedScenario.facility.id, "district_ct_open");
  const beforeOpening = resolveScenarioResource(delayedScenario, "ultrasound", 0);
  assert.equal(beforeOpening.status, "delayed");
  assert.equal(beforeOpening.available, false);
  assert.equal(beforeOpening.readyAt, 380);
  assert.equal(resolveScenarioResource(delayedScenario, "ultrasound", 379).available, false);
  const atOpening = resolveScenarioResource(delayedScenario, "ultrasound", 380);
  assert.equal(atOpening.status, "available");
  assert.equal(atOpening.available, true);
  assert.equal(atOpening.readyAt, 380);

  const unavailableScenario = generateScenario({ mode: "real", seed: "profile-5" });
  const unavailable = resolveScenarioResource(unavailableScenario, "ct", 10_000);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.readyAt ?? null, null);

  const reference = generateScenario({ mode: "reference", seed: "transfer-only" });
  const transferOnlyScenario = {
    ...reference,
    facility: {
      ...reference.facility,
      capabilities: {
        ...reference.facility.capabilities,
        ct: {
          installed: false,
          access: "transfer_only",
          transferMinutes: 150,
          transferDestination: "областную больницу",
        },
      },
    },
  };
  const transferOnly = resolveScenarioResource(transferOnlyScenario, "ct", 0);
  assert.equal(transferOnly.status, "transfer_only");
  assert.equal(transferOnly.available, false);
  assert.equal(transferOnly.transferMinutes, 150);
  assert.match(transferOnly.revealText, /только после перевода/i);
});

test("night ultrasound becomes executable at readyAt and returns its authored result", async () => {
  const caseData = createV25Case();
  const scenario = generateScenario({ mode: "real", seed: "clock-0" });
  let session = createV25Session({ caseData, scenario, seed: "clock-0" });

  const blocked = await advanceV25Session({
    caseData,
    session,
    input: "Назначаю УЗИ живота",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "request_test", concept_id: "abdominal_ultrasound", confidence: 0.99 },
      ]),
    },
  });
  assert.equal(blocked.session.temporalState.clockMinutes, 0);
  assert.equal(blocked.session.completedActions.includes("abdominal_ultrasound"), false);
  assert.equal(blocked.session.resourceQueue.ultrasound.status, "pending");
  assert.equal(blocked.session.resourceQueue.ultrasound.ready_at, 380);

  session = blocked.session;
  const waited = await advanceV25Session({
    caseData,
    session,
    input: "Жду до открытия УЗИ",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "management", concept_id: "wait_for_ultrasound", confidence: 0.99 },
      ]),
    },
  });
  assert.equal(waited.session.temporalState.clockMinutes, 380);
  assert.equal(resolveActionEta(scenario, "abdominal_ultrasound", "", 380).available, true);

  session = waited.session;
  const resulted = await advanceV25Session({
    caseData,
    session,
    input: "Теперь выполняю УЗИ живота",
    options: {
      actionExtractorLLM: actionExtractorFor([
        { type: "request_test", concept_id: "abdominal_ultrasound", confidence: 0.99 },
      ]),
    },
  });
  assert.equal(resulted.session.temporalState.clockMinutes, 410);
  assert.equal(resulted.session.completedActions.includes("abdominal_ultrasound"), true);
  assert.equal(resulted.session.revealedFindings.includes("abdominal_ultrasound"), true);
  assert.equal(resulted.session.resourceQueue.ultrasound.status, "consumed");
  assert.match(resulted.reply, /УЗИ брюшной полости/);
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

  const turn = lastEvent(result.session, "clinical_turn");
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
