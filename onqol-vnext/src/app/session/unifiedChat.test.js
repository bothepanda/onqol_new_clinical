import { test } from "node:test";
import assert from "node:assert/strict";
import { routeUnifiedChat } from "./unifiedChat.js";
import { interpretTurn } from "../../ai/interpreter/interpretTurn.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn, buildTurnContext } from "../../core/session/submitLearnerTurn.js";
import { withShared } from "../../core/content/loadBundle.js";
import disease from "../../content/generated/appendicitis.json" with { type: "json" };
import shared from "../../content/generated/shared.json" with { type: "json" };
const bundle = withShared(disease, shared);
const session = () => createSession({ sessionId: "unified-test", seed: "unified", mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", locale: "ru", startIso: "2026-09-21T08:00:00Z", bundle });
function read(text, s = session()) { const interpreted = interpretTurn({text, bundle, turnContext: buildTurnContext(s)}); return { interpreted, route: routeUnifiedChat(text, interpreted) }; }
test("questions, uncertainty and mentor answers do not execute named orders", () => {
  for (const text of ["Почему нужна КТ?", "Нужно ли назначать кетопрофен 100 мг в/в?", "А если назначить КТ?", "КТ?", "Я не знаю", "Объясни миграцию боли"]) {
    const {route} = read(text); assert.equal(route.execute, false, text); assert.equal(route.discuss,true,text);
  }
});
test("explicit commands keep clinical routing and missing parameter validation", () => {
  for (const text of ["Назначаю КТ", "осмотр живота", "Назначаю кетопрофен"]) {
    const {route} = read(text); assert.equal(route.execute,true,text);
  }
  const s = session(); const text = "Назначаю кетопрофен";const {interpreted} = read(text,s);
  assert.ok(submitLearnerTurn({session:s,text,interpreted}).outcomes.some(x => x.outcome === "CLARIFY"));
});
test("mixed order and question execute only the committed order", () => {
  const text = "Назначаю ОАК. Почему нужна КТ?"; const {route,interpreted} = read(text);
  assert.equal(route.kind,"mixed"); assert.deepEqual(interpreted.commands.map(x=>x.params.testId),["cbc"]);
  assert.equal(interpreted.withheldCommands[0].params.testId,"ct_abdomen");
});
test("contradictory discussion framing clarifies before any action", () => {
  for(const text of ["Назначаю кетопрофен 100 мг в/в — это вопрос для обсуждения", "Как ты думаешь, назначаю КТ?"]) {
    const {route} = read(text); assert.equal(route.kind,"clarify");assert.equal(route.execute,false);
  }
});
test("reasoning bookkeeping remains in clinical evidence while requesting dialogue", () => {
  const s = session();const text = "Я считаю это аппендицитом, потому что боль мигрировала";
  const {interpreted,route} = read(text,s);assert.equal(route.execute,true);assert.equal(route.discuss,true);
  const next = submitLearnerTurn({session:s,text,interpreted}).session;
  assert.equal(next.state.clock.elapsedMinutes,s.state.clock.elapsedMinutes);
  assert.ok(next.events.some(x=>x.type === "LEARNER_TURN_RECEIVED" && x.payload.interpretedCommands.some(c=>c.type === "STATE_REASONING")));
});
test("an unrecognised fragment is reported by the environment, not sent to the mentor", () => {
  const route = routeUnifiedChat("физикальный осмотр и анамнещз", {
    commands: [{ type: "EXAMINE", params: { region: "general" } }],
    unmatchedFragments: ["анамнещз"],
  });
  assert.deepEqual(route, { kind: "clinical", execute: true, discuss: false });
  const onlyUnknown = routeUnifiedChat("анамнещз", { commands: [], unmatchedFragments: ["анамнещз"] });
  assert.deepEqual(onlyUnknown, { kind: "unrecognized", execute: true, discuss: false });
});
