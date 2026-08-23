import { test } from "node:test";
import assert from "node:assert/strict";
import { interpretTurn } from "./interpretTurn.js";
import { validateCommand } from "../../core/commands/commandTypes.js";

// Behavioral regression #1-2 (Core Foundation Spec §68, task brief §27).

test('"осмотрю пациента" asks what is examined - EXAMINE with region missing', () => {
  const { commands } = interpretTurn({ text: "осмотрю пациента" });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "EXAMINE");
  assert.equal(validateCommand(commands[0]).outcome, "CLARIFY");
});

test('"живот" executes appropriate abdominal examination without ritual enumeration', () => {
  const { commands } = interpretTurn({ text: "живот" });
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "EXAMINE");
  assert.equal(commands[0].params.region, "abdomen");
  assert.equal(validateCommand(commands[0]).outcome, "SUFFICIENT");
});

test('"что с пациентом сейчас?" returns current status, not mentor interrogation', () => {
  const result = interpretTurn({ text: "что с пациентом сейчас?" });
  assert.equal(result.intent, "REQUEST_CURRENT_STATUS");
  assert.equal(result.commands[0].type, "REQUEST_STATUS");
});

test('"ОАК, БХАК, КТ ОБП" decomposes into three parallel test orders', () => {
  const { commands } = interpretTurn({ text: "ОАК, БХАК, КТ ОБП" });
  assert.deepEqual(
    commands.map((c) => c.params.testId),
    ["cbc", "chemistry", "ct_abdomen"],
  );
});

test('"кетопрофен 100 мг" without a route is CLARIFY, never a guessed route', () => {
  const { commands } = interpretTurn({ text: "кетопрофен 100 мг" });
  assert.equal(commands[0].type, "ORDER_MEDICATION");
  assert.equal(commands[0].params.route, undefined);
  assert.equal(validateCommand(commands[0]).outcome, "CLARIFY");
});

test('"прокапаем его нормально" does not guess fluid/volume/duration - stays incomplete', () => {
  const { commands } = interpretTurn({ text: "прокапаем его нормально" });
  assert.equal(commands[0].type, "ORDER_INFUSION");
  assert.equal(commands[0].params.volumeMl, undefined);
  assert.equal(validateCommand(commands[0]).outcome, "CLARIFY");
});

test('"переоценю через час" without stated targets asks what is being reassessed', () => {
  const { commands } = interpretTurn({ text: "переоценю через час" });
  assert.equal(commands[0].type, "REASSESS");
  assert.equal(validateCommand(commands[0]).outcome, "CLARIFY");
});

test('"переоценю боль и витальные через час" carries stated targets and is sufficient', () => {
  const { commands } = interpretTurn({ text: "переоценю боль и витальные через час" });
  assert.equal(commands[0].type, "REASSESS");
  assert.ok(commands[0].params.targets.includes("pain") && commands[0].params.targets.includes("vitals"));
  assert.equal(validateCommand(commands[0]).outcome, "SUFFICIENT");
});

test('"не знаю" is read as a mentor answer signalling STUCK, not a clinical command', () => {
  const result = interpretTurn({ text: "не знаю" });
  assert.equal(result.intent, "MENTOR_ANSWER");
  assert.equal(result.mentorSignal, "STUCK");
  assert.equal(result.commands.length, 0);
});

test("free-form clinical reasoning with no recognized action updates reasoning only, not the simulator", () => {
  const result = interpretTurn({ text: "думаю, это может быть аппендицит, но надо исключить гинекологическую причину" });
  assert.equal(result.intent, "CLINICAL_REASONING");
  assert.equal(result.commands.length, 0);
});

test('"ОАК и КТ ОБП" splits on the conjunction "и", not only on commas', () => {
  const { commands } = interpretTurn({ text: "ОАК и КТ ОБП" });
  assert.deepEqual(
    commands.map((c) => c.params.testId),
    ["cbc", "ct_abdomen"],
  );
});

test('reassessment targets joined by "и" stay one REASSESS command, not scattered fragments', () => {
  const { commands } = interpretTurn({ text: "переоценю боль и витальные через час" });
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].params.targets, ["pain", "vitals"]);
  assert.equal(commands[0].params.afterMinutes, 60);
});
