import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics } from "./statefulMentorMetrics.mjs";

function intervened(overrides = {}) {
  return { type: "MENTOR_INTERVENED", payload: { spoke: true, mode: "CLARIFY", issueId: "x", scaffolding: 1, openQuestion: null, ...overrides } };
}
function grounded(overrides = {}) {
  return { type: "MENTOR_GROUNDED_RESPONSE_RENDERED", payload: { status: "fallback", reasons: [], ...overrides } };
}

test("an exact repeated question (same issue, same scaffold) on consecutive spoken turns counts toward question_repeat_rate", () => {
  const events = [intervened({ issueId: "a", scaffolding: 1 }), intervened({ issueId: "a", scaffolding: 1 })];
  const metrics = computeMetrics([{ file: "t", events }]);
  assert.equal(metrics.question_repeat_rate, 0.5, "1 of the 2 spoken interventions was an exact repeat");
});

test("escalating scaffolding on the same issue is not counted as a repeat", () => {
  const events = [intervened({ issueId: "a", scaffolding: 1 }), intervened({ issueId: "a", scaffolding: 2 })];
  const metrics = computeMetrics([{ file: "t", events }]);
  assert.equal(metrics.question_repeat_rate, 0);
});

test("a SUFFICIENT spoken intervention counts toward unnecessary_intervention_rate", () => {
  const events = [intervened({ adequacy: "SUFFICIENT" }), intervened({ adequacy: "PARTIAL" })];
  const metrics = computeMetrics([{ file: "t", events }]);
  assert.equal(metrics.unnecessary_intervention_rate, 0.5);
});

test("closing a pending issue on a SUFFICIENT turn counts toward sufficient_answer_advancement_rate", () => {
  const events = [
    intervened({ issueId: "a", adequacy: "PARTIAL", pendingMentorQuestion: { issueId: "a" } }),
    intervened({ issueId: "a", adequacy: "SUFFICIENT", pendingMentorQuestion: null }),
  ];
  const metrics = computeMetrics([{ file: "t", events }]);
  assert.equal(metrics.sufficient_answer_advancement_rate, 1);
});

test("a grounding rejection whose reasons include a hidden-diagnosis violation is counted in hidden_truth_leak_rate, not unsupported_claim_rate", () => {
  const events = [grounded({ reasons: ["noHiddenDiagnosis"] }), grounded({ status: "accepted", reasons: [] })];
  const metrics = computeMetrics([{ file: "t", events }]);
  assert.equal(metrics.hidden_truth_leak_rate, 0.5);
  assert.equal(metrics.unsupported_claim_rate, 0);
});

test("an empty log produces null rates, not NaN or a crash", () => {
  const metrics = computeMetrics([{ file: "t", events: [] }]);
  for (const key of ["question_repeat_rate", "unnecessary_intervention_rate", "hidden_truth_leak_rate"]) {
    assert.equal(metrics[key], null);
  }
});
