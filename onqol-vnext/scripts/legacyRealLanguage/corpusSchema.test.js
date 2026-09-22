import { test } from "node:test";
import assert from "node:assert/strict";
import { precedingPrompt } from "./buildCorpus.mjs";
import { validateAnnotation } from "./corpusSchema.mjs";

// Synthetic rows only: the real corpus carries learners' words and lives under private/.
const good = () => ({
  channel: "clinical_action", scope: "IN_SCOPE", scopeReason: "modeled_action", commitmentState: "COMMITTED",
  expectedDisposition: "commands", ambiguity: { level: "none", note: "" }, annotationConfidence: "high",
  expectedCommands: [{ type: "ORDER_TEST", params: { testId: "cbc" } }], unmodeledFragments: [], namedButNotCommitted: [], annotationNote: "synthetic",
});

test("a well-formed annotation validates", () => assert.deepEqual(validateAnnotation(good()), []));

test("unknown command types, channels, scopes and expect modes are rejected", () => {
  assert.ok(validateAnnotation({ ...good(), channel: "chat" }).length);
  assert.ok(validateAnnotation({ ...good(), scope: "MAYBE" }).length);
  assert.ok(validateAnnotation({ ...good(), expectedCommands: [{ type: "ORDER_MAGIC", params: {} }] }).length);
  assert.ok(validateAnnotation({ ...good(), expectedCommands: [{ type: "ORDER_TEST", params: {}, expect: "sometimes" }] }).length);
  assert.ok(validateAnnotation({ ...good(), expectedCommands: [{ type: "ORDER_TEST", params: {}, altTypes: ["NOPE"] }] }).length);
});

test("scope and reason must agree, and a modeled action needs a command", () => {
  assert.ok(validateAnnotation({ ...good(), scope: "OUT_OF_CURRENT_SCOPE" }).length);
  assert.ok(validateAnnotation({ ...good(), expectedCommands: [] }).length);
});

test("no_action carries no commands, commands_partial needs unmodeled fragments, compound needs its channels", () => {
  assert.ok(validateAnnotation({ ...good(), expectedDisposition: "no_action" }).length);
  assert.ok(validateAnnotation({ ...good(), expectedDisposition: "commands_partial" }).length);
  assert.ok(validateAnnotation({ ...good(), channel: "compound" }).length);
  assert.deepEqual(validateAnnotation({ ...good(), channel: "compound", channelsPresent: ["clinical_action", "patient_question"] }), []);
});

test("the preceding prompt is the question block, not the data dump before it", () => {
  const p = (role, text) => ({ role, text });
  const paragraphs = [p("system", "ЧСС 100"), p("system", "АД 120/80"), p("system", "Что дальше?"), p("learner", "x")];
  assert.equal(precedingPrompt(paragraphs, 3), "Что дальше?");
  const noQuestion = [p("system", "a"), p("system", "b"), p("system", "c"), p("system", "d"), p("learner", "x")];
  assert.equal(precedingPrompt(noQuestion, 4), "b\nc\nd");
  const afterLearner = [p("system", "old?"), p("learner", "y"), p("system", "Новый вопрос?"), p("learner", "x")];
  assert.equal(precedingPrompt(afterLearner, 3), "Новый вопрос?");
});
