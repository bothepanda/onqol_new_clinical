import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregate, matchesGold, paramsMatch, scoreRow, targetReport } from "./legacyMetrics.mjs";
import { classifyRow } from "./taxonomy.mjs";

// Synthetic rows only. A row is what evaluateV3Rows returns; only the fields the metrics read are built.
const cmd = (type, params = {}, sourceText = "") => ({ id: `${type}-${Math.random()}`, type, params, sourceText });
const row = ({ commands = [], executed = commands.filter((c) => c.complete !== false), withheld = [] } = {}) => ({
  id: "t", text: "x", channel: "clinical_action",
  hybrid: { commands, withheldCommands: withheld, unmatchedFragments: [], semanticTelemetry: { called: false } }, executedCommands: executed,
  deterministic: { commands, withheldCommands: withheld, unmatchedFragments: [] }, deterministicExecuted: executed,
});
const test_ = (testId) => cmd("ORDER_TEST", { testId });
const gold = (...commands) => ({ commands, disposition: "commands" });

test("array parameters compare as sets, strings ignore case and whitespace", () => {
  assert.ok(paramsMatch({ analytes: ["b", "a"] }, { analytes: ["a", "b"] }));
  assert.ok(!paramsMatch({ analytes: ["a"] }, { analytes: ["a", "b"] }));
  assert.ok(paramsMatch({ dose: "30 мг" }, { dose: "30мг" }));
});

test("altTypes and anyOf make a two-way reading correct either way", () => {
  const g = { type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "nonoperative" }, anyOf: [{ intent: "observation" }] };
  assert.ok(matchesGold(cmd("COMMIT_MANAGEMENT_PLAN", { intent: "observation" }), g));
  assert.ok(!matchesGold(cmd("COMMIT_MANAGEMENT_PLAN", { intent: "operative" }), g));
  assert.ok(matchesGold(cmd("REQUEST_ANESTHESIA_REVIEW"), { type: "CALL_STAFF", params: { role: "anesthesiologist" }, altTypes: ["REQUEST_ANESTHESIA_REVIEW"] }));
});

test("an exact row commits exactly the gold set", () => {
  const score = scoreRow(row({ commands: [test_("cbc"), test_("crp")] }), "v3", gold({ type: "ORDER_TEST", params: { testId: "cbc" } }, { type: "ORDER_TEST", params: { testId: "crp" } }));
  assert.equal(score.exact, true);
  assert.equal(score.requiredHit, 2);
});

test("an executed command outside the gold is a false execution and breaks exactness", () => {
  const score = scoreRow(row({ commands: [test_("cbc"), test_("ct_abdomen")] }), "v3", gold({ type: "ORDER_TEST", params: { testId: "cbc" } }));
  assert.equal(score.exact, false);
  assert.equal(score.falseExecutions.length, 1);
});

test("a clarify gold needs the INCOMPLETE command; completing an absent parameter is an invented parameter", () => {
  const g = gold({ type: "ORDER_MEDICATION", params: { drugId: "ketoprofen", doseMg: 30 }, expect: "clarify", absent: ["route"] });
  const incomplete = cmd("ORDER_MEDICATION", { drugId: "ketoprofen", doseMg: 30, dose: "30мг" });
  assert.equal(scoreRow(row({ commands: [incomplete], executed: [] }), "v3", g).exact, true);
  const completed = cmd("ORDER_MEDICATION", { drugId: "ketoprofen", doseMg: 30, dose: "30мг", route: "iv" });
  const score = scoreRow(row({ commands: [completed] }), "v3", g);
  assert.equal(score.exact, false);
  assert.equal(score.completedInsteadOfClarify.length, 1);
  assert.equal(aggregate([{ row: row({ commands: [completed] }), gold: g, score }], "v3").inventedParameterCount, 1);
});

test("optional commands are never a miss and never a false execution", () => {
  const g = gold({ type: "ORDER_TEST", params: { testId: "cbc" } }, { type: "START_PROCEDURE", params: { approach: "open" }, expect: "optional" });
  assert.equal(scoreRow(row({ commands: [test_("cbc")] }), "v3", g).exact, true);
  const withOptional = scoreRow(row({ commands: [test_("cbc"), cmd("START_PROCEDURE", { approach: "open" })] }), "v3", g);
  assert.equal(withOptional.exact, true);
  assert.equal(scoreRow(row({ commands: [test_("cbc"), cmd("START_PROCEDURE", { approach: "laparoscopic" })] }), "v3", g).exact, false);
});

test("a restraint row is exact only when nothing is committed or asked", () => {
  const g = { commands: [], disposition: "no_action" };
  assert.equal(scoreRow(row(), "v3", g).exact, true);
  assert.equal(scoreRow(row({ commands: [cmd("CALL_STAFF", { role: "surgeon" })] }), "v3", g).exact, false);
  assert.equal(scoreRow(row({ commands: [cmd("ORDER_MEDICATION", { drugId: "ketoprofen" })], executed: [] }), "v3", g).exact, false);
});

test("either accepts a complete command or the clarification, but not another region", () => {
  const g = gold({ type: "EXAMINE", params: { region: "general" }, expect: "either" });
  assert.equal(scoreRow(row({ commands: [cmd("EXAMINE", { region: "general" })] }), "v3", g).exact, true);
  assert.equal(scoreRow(row({ commands: [cmd("EXAMINE", {})], executed: [] }), "v3", g).exact, true);
  assert.equal(scoreRow(row({ commands: [cmd("EXAMINE", { region: "abdomen" })] }), "v3", g).exact, false);
});

test("targets are read straight from the block, not adjusted", () => {
  const pass = targetReport({ falseExecutionCount: 0, highRiskFalseExecutionCount: 0, inventedParameterCount: 0, commandPrecision: 0.95, commandRecall: 0.9, exactAccuracy: 0.9 });
  assert.ok(pass.every((g) => g.pass));
  const fail = targetReport({ falseExecutionCount: 1, highRiskFalseExecutionCount: 0, inventedParameterCount: 0, commandPrecision: 0.949, commandRecall: 0.9, exactAccuracy: 0.9 });
  assert.deepEqual(fail.filter((g) => !g.pass).map((g) => g.name), ["false executions = 0", "precision >= 0.95"]);
});

test("taxonomy names the mechanism and never carries learner text", () => {
  const turn = { namedButNotCommitted: [{ text: "ЗАПРЕТНЫЙ ТЕКСТ", state: "CONDITIONAL", type: "ORDER_TEST" }], unmodeledFragments: [] };
  const g = gold({ type: "ORDER_TEST", params: { testId: "cbc" } });
  const r = row({ commands: [], withheld: [{ type: "ORDER_TEST", params: { testId: "cbc" }, commitment: { status: "TENTATIVE" } }] });
  const tags = classifyRow({ row: r, gold: g, score: scoreRow(r, "v3", g), turn });
  assert.deepEqual(tags.map((t) => t.class), ["MISS_WITHHELD"]);
  assert.ok(!JSON.stringify(tags).includes("ЗАПРЕТНЫЙ"));
});
