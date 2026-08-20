// Regression for replay b9d7a831 (test session, 19.08.2026).
//
// Six turns, of which three went on the same unanswered question, and the
// session was abandoned. Each test below is one of the things that went wrong.

import assert from "node:assert/strict";
import test from "node:test";
import { createV25Case } from "../v25/caseFactory.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { coreActionsById } from "../core/coreActions.js";
import {
  OPERATIONALIZATION_CONTRACTS,
  isRepairMove,
  operationalizationQuestion,
  readOrderSlots,
} from "../core/operationalization.js";

function extractorFor(intents, actionParameters = []) {
  return () =>
    JSON.stringify({ intents, action_parameters: actionParameters, unresolved_fragments: [] });
}

function optionsFor(intents, actionParameters) {
  return { actionExtractorLLM: extractorFor(intents, actionParameters) };
}

const caseData = createV25Case();

function newSession(seed) {
  return createV25Session({ caseData, mode: "reference", seed });
}

function allActionIds() {
  return new Set(
    [
      ...coreActionsById.keys(),
    ].concat(
      [
      ...caseData.expected_actions,
      ...caseData.acceptable_alternatives,
      ...caseData.unnecessary_actions,
      ...caseData.unsafe_actions,
      ].map((action) => action.id)
    )
  );
}

test("every operationalization row points at an action that exists", () => {
  const ids = allActionIds();
  for (const contract of OPERATIONALIZATION_CONTRACTS) {
    assert.ok(
      ids.has(contract.action_id),
      `${contract.action_id} не существует как действие кейса`
    );
  }
});

test("nothing in the operationalization layer is eligible for scoring", () => {
  for (const contract of OPERATIONALIZATION_CONTRACTS) {
    assert.equal(contract.eligible_for_scoring, false);
  }
  const state = readOrderSlots({ actionId: "analgesia", text: "кеторолак 30 мг в/в" });
  assert.equal(state.eligible_for_scoring, false);
});

test("«обезболю пациента» is an intention, and the team asks what and how", async () => {
  const result = await advanceV25Session({
    caseData,
    session: newSession("ops-analgesia"),
    input: "обезболю пациента",
    options: optionsFor([{ type: "management", concept_id: "analgesia", confidence: 0.99 }]),
  });

  assert.equal(result.session.completedActions.includes("analgesia"), false);
  const state = result.session.workingMemory.actionStates.analgesia;
  assert.equal(state.status, "proposed");
  // Dose joined agent and route on 20.08.2026 (owner decision). Asking for it
  // is transcription: nothing checks the number that comes back.
  assert.deepEqual(state.awaiting_slots, ["agent", "dose", "route"]);
  assert.match(
    result.reply,
    /Медсестра ожидает назначения\. Чем именно, в какой дозе и каким путём\?/
  );

  const log = result.session.actionLog.findLast((entry) => entry.action_id === "analgesia");
  assert.equal(log.applied_to_patient, false);
  assert.equal(log.action_decision, "awaiting_operationalization");
});

test("the answer names no action and still completes the order", async () => {
  const asked = await advanceV25Session({
    caseData,
    session: newSession("ops-answer"),
    input: "обезболю пациента",
    options: optionsFor([{ type: "management", concept_id: "analgesia", confidence: 0.99 }]),
  });

  const answered = await advanceV25Session({
    caseData,
    session: asked.session,
    input: "кеторолак 30 мг внутривенно",
    options: optionsFor([]),
  });

  assert.equal(answered.session.completedActions.includes("analgesia"), true);
  assert.equal(answered.session.workingMemory.actionStates.analgesia.status, "performed");
  const record = answered.session.workingMemory.orderRecords.analgesia;
  assert.equal(record.slots.agent, "кеторолак");
  assert.equal(record.slots.route, "внутривенно");
  assert.equal(record.slots.dose, "30 мг");
  // Transcribed, never judged.
  assert.equal(record.parameters_validated, false);
  assert.equal(record.eligible_for_scoring, false);
});

test("a compound half-order is asked about in one question, not one half silently", () => {
  const fluids = readOrderSlots({ actionId: "iv_fluids", text: "покапаю пока" });
  const observation = readOrderSlots({
    actionId: "active_observation",
    text: "посмотрю на динамике",
  });
  const question = operationalizationQuestion([fluids, observation]);

  assert.match(question, /какой раствор, какой объём и с какой скоростью/i);
  assert.match(question, /что контролируешь и при каких изменениях звать вас/i);
});

test("explicit postoperative escalation thresholds close the observation endpoint slot", () => {
  const state = readOrderSlots({
    actionId: "active_observation",
    text: "контролирую ЧСС и давление; звать меня при гипотонии, тахикардии или кровотечении",
  });
  assert.equal(state.complete, true);
  assert.ok(state.filled.endpoint);
});

test("«посмотрю на динамике» does not run an observation with no endpoint", async () => {
  const result = await advanceV25Session({
    caseData,
    session: newSession("ops-observation"),
    input: "покапаю пока, посмотрю на динамике",
    options: optionsFor([
      { type: "management", concept_id: "iv_fluids", confidence: 0.9 },
      { type: "management", concept_id: "active_observation", confidence: 0.9 },
    ]),
  });

  assert.equal(result.session.completedActions.includes("active_observation"), false);
  // Frequency was demoted to `recorded` on 20.08.2026 (CDR-17): "what am I
  // watching" plus "when do you call me" is the content of an observation, and
  // three demands in one breath is what stalled session TS-01.
  assert.deepEqual(
    result.session.workingMemory.actionStates.active_observation.awaiting_slots,
    ["monitored", "endpoint"]
  );
  assert.match(result.reply, /что контролируешь/i);
});

test("a fully stated order is never asked for a second time", async () => {
  const first = await advanceV25Session({
    caseData,
    session: newSession("ops-no-loop"),
    input: "покапаю пока",
    options: optionsFor([{ type: "management", concept_id: "iv_fluids", confidence: 0.9 }]),
  });
  assert.match(first.reply, /какой раствор/i);

  const second = await advanceV25Session({
    caseData,
    session: first.session,
    input: "первые 500 мл open wide nacl 0.9%, затем из расчета 5 мл на кг - еще 1.5 литра",
    options: optionsFor([{ type: "management", concept_id: "iv_fluids", confidence: 0.99 }]),
  });

  // The pilot still cannot validate 5 ml/kg, and says so — but it says it once,
  // as a statement, and does not ask again for what was just written.
  assert.doesNotMatch(second.reply, /какой раствор/i);
  assert.doesNotMatch(second.reply, /Уточни назначение/);
  const record = second.session.workingMemory.orderRecords.iv_fluids;
  assert.equal(record.complete, true);
  assert.equal(record.slots.solution, "nacl");
  assert.equal(record.slots.volume, "500 мл");
  assert.equal(record.slots.rate, "open wide");
});

test("«я же написала!» replays the record instead of answering «не распознано»", async () => {
  assert.equal(isRepairMove("я же написала!"), true);
  assert.equal(isRepairMove("повторяю: кеторолак"), true);
  assert.equal(isRepairMove("делаю узи"), false);

  const ordered = await advanceV25Session({
    caseData,
    session: newSession("ops-repair"),
    input: "обезболю кеторолаком внутривенно",
    options: optionsFor([{ type: "management", concept_id: "analgesia", confidence: 0.99 }]),
  });

  const repair = await advanceV25Session({
    caseData,
    session: ordered.session,
    input: "я же написала!",
    options: optionsFor([]),
  });

  assert.match(repair.reply, /Записано с твоих слов/);
  assert.match(repair.reply, /кеторолак/);
});

test("the safety gate still sees a dangerous number inside a half-stated order", async () => {
  const result = await advanceV25Session({
    caseData,
    session: newSession("ops-safety-first"),
    input: "физ р-р из расчета 200 мл на кг",
    options: optionsFor(
      [{ type: "management", concept_id: "iv_fluids", confidence: 0.99 }],
      [{ concept_id: "iv_fluids", dose_value: 200, dose_unit: "мл/кг" }]
    ),
  });

  // No rate was stated, so the order is incomplete — but an unreviewed 200 ml/kg
  // must not be able to slip past the parameter gate by being under-specified.
  assert.equal(result.session.workingMemory.actionStates.iv_fluids.status, "blocked");
  assert.equal(result.session.completedActions.includes("iv_fluids"), false);
});
