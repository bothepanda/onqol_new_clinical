import { test } from "node:test";
import assert from "node:assert/strict";
import { decideMentorResponse, MENTOR_MODE } from "./mentorEngine.js";

function baseState(overrides = {}) {
  return { turn: 1, mentor: { scaffolding: 0, lastInterventionTurn: null, silentTurns: 0, openQuestion: null }, ...overrides };
}

test("SAFETY_STOP outranks every other consideration", () => {
  const response = decideMentorResponse({
    state: baseState(),
    turnResult: { outcome: "SAFETY_STOP", teachingPointRu: "Стоп.", ruleId: "R1" },
  });
  assert.equal(response.mode, MENTOR_MODE.SAFETY_STOP);
});

test('"не знаю" increases scaffolding rather than repeating the same question', () => {
  const first = decideMentorResponse({ state: baseState(), turnResult: { outcome: "EXECUTED" }, mentorSignal: "STUCK" });
  assert.equal(first.mode, MENTOR_MODE.TEACH);
  assert.equal(first.scaffolding, 1);

  const second = decideMentorResponse({
    state: baseState({ mentor: { scaffolding: 1, lastInterventionTurn: 1, silentTurns: 0, openQuestion: null } }),
    turnResult: { outcome: "EXECUTED" },
    mentorSignal: "STUCK",
  });
  assert.equal(second.scaffolding, 2);
  assert.notEqual(second.textRu, first.textRu); // does not repeat the identical prompt
});

test("a competent turn with nothing to flag stays silent (CONTINUE), not a forced question", () => {
  const response = decideMentorResponse({ state: baseState(), turnResult: { outcome: "EXECUTED", firedRules: [] } });
  assert.equal(response.mode, MENTOR_MODE.CONTINUE);
  assert.equal(response.textRu, null);
});

test("a fired Level-2 teaching rule produces exactly one CHALLENGE, using the rule's own reviewed wording", () => {
  const rule = { id: "RULE-X", level: "LEVEL_2_EDUCATIONAL", teaching_point_ru: "Проверь ещё раз." };
  const response = decideMentorResponse({
    state: baseState(),
    turnResult: { outcome: "EXECUTED", firedRules: [rule] },
  });
  assert.equal(response.mode, MENTOR_MODE.CHALLENGE);
  assert.equal(response.textRu, "Проверь ещё раз.");
  assert.equal(response.ruleId, "RULE-X");
});

test("CLARIFY outcomes delegate to hospital staff rather than becoming a mentor question", () => {
  const response = decideMentorResponse({ state: baseState(), turnResult: { outcome: "CLARIFY", missing: ["route"] } });
  assert.equal(response.delegateToStaff, true);
  assert.equal(response.mode, MENTOR_MODE.CONTINUE);
});
