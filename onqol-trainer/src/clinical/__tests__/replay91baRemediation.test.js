import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildV35Case } from "../v35/createCase.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { generateScenario } from "../v25/scenarioEngine.js";
import {
  appendicitisRouterConceptMap,
  resolveConcept,
} from "../diseases/appendicitis/router/conceptRegistry.js";

import { replay91baRouter, routed } from "./fixtures/replay91baRouter.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/replay-91ba7206.json", import.meta.url), "utf8")
);
const forbiddenGeneric = "Эти данные не заданы в карте пациента.";



function options(overrides = {}) {
  return {
    mentor: true,
    actionExtractorLLM: replay91baRouter,
    conceptMap: appendicitisRouterConceptMap,
    conceptRegistry: resolveConcept,
    ...overrides,
  };
}

function buildReplayCase() {
  return buildV35Case({
    seed: fixture.effective_seed,
    requestedPresetId: fixture.case_preset_id,
  }).caseData;
}

test("replay fixture freezes the full learner transcript and deterministic case", () => {
  const caseData = buildReplayCase();
  assert.equal(caseData.patient_state.age, 56);
  assert.equal(caseData.v35_composition.phenotype_id, "pelvic");
  assert.equal(fixture.transcript.filter((entry) => entry.role === "user").length, 8);
});

test("compound pelvic diagnostic order gives one addressed status per fragment", async () => {
  const caseData = buildReplayCase();
  const input = fixture.transcript[3].content;
  const result = await advanceV25Session({
    caseData,
    session: createV25Session({ caseData, mode: "reference", seed: fixture.effective_seed }),
    input,
    options: options(),
  });

  for (const label of ["ОАК", "Общий анализ мочи", "УЗИ брюшной полости", "УЗИ органов малого таза"]) {
    assert.match(result.reply, new RegExp(label, "i"));
  }
  assert.match(result.reply, /«тест на беременность».*не авторизован/is);
  assert.doesNotMatch(result.reply, new RegExp(forbiddenGeneric));
  assert.equal(result.mentor.moveTypes.includes("out_of_scope_recognized"), false);
  const turn = result.session.eventLog.findLast((entry) => entry.event_type === "clinical_turn");
  assert.equal(turn.router_intents_before_mapping.length, 7);
  assert.ok(turn.action_changes.every((entry) => entry.action_decision));
  assert.equal(turn.simulator_invocation_suppressed_reason, "deterministic_environment_answer");
});

test("CT advances and the mentor surfaces the still-open dangerous alternative", async () => {
  const caseData = buildReplayCase();
  let session = createV25Session({ caseData, mode: "reference", seed: fixture.effective_seed });
  let result = await advanceV25Session({
    caseData,
    session,
    input: fixture.transcript[3].content,
    options: options(),
  });
  session = result.session;
  result = await advanceV25Session({
    caseData,
    session,
    input: "пока непонятно. кт обп",
    options: options(),
  });
  assert.match(result.reply, /КТ брюшной полости/i);
  assert.equal(result.mentor.mode, "CHALLENGE");
  assert.equal(result.mentor.issueId, "appendicitis_ectopic_not_excluded");
  assert.match(result.mentor.text, /обязательно нужно исключить/i);
  assert.equal(result.mentor.moveTypes.includes("uncertainty_declared"), false);
  assert.doesNotMatch(result.reply, /сохранять диагностическое мышление|можно двигаться дальше/i);

  result = await advanceV25Session({
    caseData,
    session: result.session,
    input: "конец кейса",
    options: options(),
  });
  assert.doesNotMatch(result.reply, /- Цель исследования не была вербализована\./);
  assert.match(result.reply, /Для «КТ брюшной полости» не было явно сказано/i);
});

test("operative approach is resource-aware and does not start source control", async () => {
  const caseData = buildReplayCase();
  const reference = createV25Session({ caseData, mode: "reference", seed: fixture.effective_seed });
  const selected = await advanceV25Session({
    caseData,
    session: reference,
    input: "Готовим к операции. Выбираю лапароскопическую аппендэктомию.",
    options: options({
      actionExtractorLLM: () => JSON.stringify({
        intents: [routed(
          "management",
          "operative_approach_laparoscopic",
          "лапароскопическую аппендэктомию"
        )],
        unresolved_fragments: [],
        action_parameters: [],
      }),
    }),
  });
  assert.equal(selected.session.workingMemory.operativeApproach.approach, "laparoscopic");
  assert.equal(selected.session.workingMemory.operativeState.procedure_started, false);
  assert.equal(selected.session.temporalState.sourceControl, false);
  assert.doesNotMatch(selected.reply, /только открытый доступ|Time Out/i);

  const constrained = createV25Session({
    caseData,
    scenario: generateScenario({ mode: "real", seed: "demo-3" }),
    mode: "real",
    seed: "demo-3",
  });
  const blocked = await advanceV25Session({
    caseData,
    session: constrained,
    input: "Выбираю лапароскопическую аппендэктомию.",
    options: options({
      actionExtractorLLM: () => JSON.stringify({
        intents: [routed(
          "management",
          "operative_approach_laparoscopic",
          "лапароскопическую аппендэктомию"
        )],
        unresolved_fragments: [],
        action_parameters: [],
      }),
    }),
  });
  assert.match(blocked.reply, /гинекологической операции/i);
  assert.equal(blocked.session.workingMemory.operativeApproach.status, "blocked");
  assert.equal(blocked.session.unnecessaryActions.length, 0);
});

test("approach selection, procedure start and conversation dispute remain separate", async () => {
  const caseData = buildReplayCase();
  let session = createV25Session({ caseData, mode: "reference", seed: fixture.effective_seed });
  let result = await advanceV25Session({
    caseData,
    session,
    input: fixture.transcript[9].content,
    options: options(),
  });
  session = result.session;
  assert.equal(session.workingMemory.operativeApproach.approach, "open");
  assert.equal(session.workingMemory.operativeState.procedure_started, false);

  result = await advanceV25Session({
    caseData,
    session,
    input: "Начинаю операцию",
    options: options({
      actionExtractorLLM: () => JSON.stringify({
        intents: [routed("management", "procedure_start", "Начинаю операцию")],
        unresolved_fragments: [],
        action_parameters: [],
      }),
    }),
  });
  // CDR-18: the stop before induction is consent and the anaesthetist.
  assert.match(result.reply, /До индукции не хватает/i);
  assert.equal(result.session.workingMemory.operativeState.procedure_started, false);

  session = {
    ...result.session,
    completedActions: [
      ...result.session.completedActions,
      "informed_consent",
      "notify_anesthesia",
      "notify_operating_team",
    ],
  };
  const clockBefore = session.temporalState.clockMinutes;
  result = await advanceV25Session({
    caseData,
    session,
    input: "Я же сделала все это выше!",
    options: options(),
  });
  assert.equal(result.session.temporalState.clockMinutes, clockBefore);
  assert.match(result.reply, /согласие.*уведомление анестезиолога.*готовность операционной/is);
  // CDR-18: the answer is what IS on record, not a list of checkpoints missing.
  assert.doesNotMatch(result.reply, /Sign In|Time Out/i);
  assert.doesNotMatch(result.reply, /Уточни, какие данные хочешь/i);
});

test("full replay fails closed on medication parameters and never emits generic UNKNOWN", async () => {
  const caseData = buildReplayCase();
  let session = createV25Session({ caseData, mode: fixture.mode, seed: fixture.effective_seed });
  const replies = [];
  let disputedClock = null;

  for (const entry of fixture.transcript.filter((item) => item.role === "user")) {
    const before = session.temporalState.clockMinutes;
    const result = await advanceV25Session({
      caseData,
      session,
      input: entry.content,
      options: options(),
    });
    replies.push(result.reply);
    session = result.session;
    if (/Я же сделала/.test(entry.content)) {
      disputedClock = [before, session.temporalState.clockMinutes];
    }
  }

  assert.equal(replies.some((reply) => reply.includes(forbiddenGeneric)), false);
  assert.ok(disputedClock);
  assert.equal(disputedClock[1], disputedClock[0]);
  assert.equal(session.completedActions.includes("analgesia"), false);
  assert.equal(session.completedActions.includes("iv_fluids"), false);
  assert.equal(session.completedActions.includes("preop_single_antibiotic_prophylaxis"), false);
  assert.equal(session.temporalState.sourceControl, false);
  const drugLog = session.actionLog.find(
    (entry) => entry.action_id === "analgesia" && entry.recognized_drug === "ектотоп"
  );
  assert.ok(drugLog);
  assert.equal(drugLog.applied_to_patient, false);
  assert.equal(drugLog.action_decision, "blocked");
  const turnEvents = session.eventLog.filter((entry) => entry.event_type === "clinical_turn");
  assert.ok(turnEvents.every((entry) => Array.isArray(entry.router_intents_before_mapping)));
  assert.ok(turnEvents.every((entry) => Array.isArray(entry.simulator_response_parts)));
});
