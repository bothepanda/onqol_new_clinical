import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRule, VERDICT } from "./ruleEngine.js";

test("a condition with no evaluator is UNKNOWN, and UNKNOWN makes the whole rule ineligible - never MET by default", () => {
  const rule = { id: "R1", conditions: [{ type: "someUnimplementedEvaluator" }] };
  const evaluation = evaluateRule(rule, { state: {}, learnerVisible: {} });
  assert.equal(evaluation.verdict, VERDICT.UNKNOWN);
  assert.equal(evaluation.eligible, false);
});

test("a rule with all conditions MET is eligible", () => {
  const rule = {
    id: "R2",
    conditions: [{ type: "managementIntentIs", intent: "operative" }],
  };
  const ctx = { state: { managementPlan: { intent: "operative" } }, learnerVisible: {} };
  const evaluation = evaluateRule(rule, ctx);
  assert.equal(evaluation.verdict, VERDICT.MET);
  assert.equal(evaluation.eligible, true);
});

test("one UNKNOWN condition among otherwise-MET conditions still fails the whole rule closed", () => {
  const rule = {
    id: "R3",
    conditions: [
      { type: "managementIntentIs", intent: "operative" },
      { type: "findingRevealed", findingId: "operative_finding" }, // learnerVisible has none
    ],
  };
  const ctx = { state: { managementPlan: { intent: "operative" } }, learnerVisible: { revealedFindings: [] } };
  const evaluation = evaluateRule(rule, ctx);
  assert.equal(evaluation.verdict, VERDICT.NOT_MET); // findingRevealed evaluator exists and returns false, not unknown
  assert.equal(evaluation.eligible, false);
});

test("mentor-boundary regression: a rule keyed to the hidden operative finding stays ineligible until that finding is disclosed", () => {
  const rule = {
    id: "COMPLICATED-TEACHING",
    conditions: [{ type: "findingRevealed", findingId: "operative_finding" }],
  };
  const beforeDisclosure = evaluateRule(rule, { state: {}, learnerVisible: { revealedFindings: [] } });
  assert.equal(beforeDisclosure.eligible, false);

  const afterDisclosure = evaluateRule(rule, { state: {}, learnerVisible: { revealedFindings: ["operative_finding"] } });
  assert.equal(afterDisclosure.eligible, true);
});
