import { test } from "node:test";
import assert from "node:assert/strict";

import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";
import { buildSemanticTaskRequest, interpretSemanticTask, routeSemanticTasks, runSplitSemanticShadow } from "./splitSemanticInterpreter.js";
import {
  ACTION_RESPONSE_FORMAT,
  MENTOR_RESPONSE_FORMAT,
  REASONING_RESPONSE_FORMAT,
  SEMANTIC_TASK,
  WAVE23_SCHEMA_VERSION,
  validateTaskOutput,
} from "./semanticTaskSchemas.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const meta = { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 0.9 };
const emptyAction = () => ({ clinicalActions: [], patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta });
const emptyReasoning = () => ({ reasoningDelta: {}, ambiguities: [], meta });
const emptyMentor = () => ({ answered: false, mentorAnswerDelta: { domains: [], evidenceSpans: [], completeness: "none", stuck: false }, reasoningDelta: {}, ambiguities: [], meta });

function provider(outputs = {}, failures = {}) {
  return {
    async complete(request) {
      if (failures[request.task]) throw failures[request.task];
      return { output: outputs[request.task], meta: { model: "fixture-snapshot", usage: { inputTokens: 20, outputTokens: 10 } } };
    },
  };
}

test("task routing is deterministic and never depends on model output", () => {
  assert.deepEqual(routeSemanticTasks({ turnContext: {} }), [SEMANTIC_TASK.ACTION, SEMANTIC_TASK.REASONING]);
  assert.deepEqual(routeSemanticTasks({ turnContext: { openMentorQuestion: { id: "q" } } }), [SEMANTIC_TASK.ACTION, SEMANTIC_TASK.MENTOR_ANSWER]);
});

test("Action Interpreter schema cannot return reasoning or mentor fields", () => {
  assert.equal(validateTaskOutput(SEMANTIC_TASK.ACTION, { ...emptyAction(), reasoningDelta: {} }).ok, false);
  const schema = JSON.stringify(ACTION_RESPONSE_FORMAT.json_schema.schema);
  assert.equal(schema.includes("reasoningDelta"), false);
  assert.equal(schema.includes("mentorAnswerDelta"), false);
});

test("Reasoning Interpreter has no clinical command or patient-question schema", () => {
  const schema = JSON.stringify(REASONING_RESPONSE_FORMAT.json_schema.schema);
  for (const forbidden of ["clinicalActions", "patientQuestions", "ORDER_TEST", "WAIT", "MOVE_PATIENT"]) assert.equal(schema.includes(forbidden), false);
  assert.equal(validateTaskOutput(SEMANTIC_TASK.REASONING, { ...emptyReasoning(), clinicalActions: [] }).ok, false);
});

test("Contextual Mentor Interpreter has no clinical command schema", () => {
  const schema = JSON.stringify(MENTOR_RESPONSE_FORMAT.json_schema.schema);
  for (const forbidden of ["clinicalActions", "patientQuestions", "ORDER_TEST", "COMMIT_MANAGEMENT_PLAN"]) assert.equal(schema.includes(forbidden), false);
  assert.equal(validateTaskOutput(SEMANTIC_TASK.MENTOR_ANSWER, { ...emptyMentor(), clinicalActions: [] }).ok, false);
});

test("task requests expose only their own semantic contract", () => {
  const action = buildSemanticTaskRequest({ task: SEMANTIC_TASK.ACTION, text: "ОАК", locale: "ru", turnContext: {}, bundle });
  const reasoning = buildSemanticTaskRequest({ task: SEMANTIC_TASK.REASONING, text: "думаю, аппендицит", locale: "ru", turnContext: {}, bundle });
  const mentor = buildSemanticTaskRequest({
    task: SEMANTIC_TASK.MENTOR_ANSWER,
    text: "ухудшение",
    locale: "ru",
    turnContext: { openMentorQuestion: { id: "change", text: "Что изменит план?", expectedDomains: ["contingency"] } },
    bundle,
  });
  assert.equal(Object.hasOwn(action.exposedContract, "reasoningConceptIds"), false);
  assert.equal(Object.hasOwn(reasoning.exposedContract, "clinicalActionTypes"), false);
  assert.equal(Object.hasOwn(mentor.exposedContract, "clinicalActionTypes"), false);
});

test("unsupported input cannot become a generic action fallback", async () => {
  const result = await runSplitSemanticShadow({
    provider: provider({
      [SEMANTIC_TASK.ACTION]: {
        clinicalActions: [{ type: "ORDER_PROCEDURE", params: {}, evidenceSpans: ["поставьте ЦВК"] }],
        patientQuestions: [], ambiguities: [], unresolvedFragments: [{ evidenceSpan: "поставьте ЦВК", reason: "unsupported_concept" }], meta,
      },
      [SEMANTIC_TASK.REASONING]: emptyReasoning(),
    }),
    text: "поставьте ЦВК", locale: "ru", turnContext: {}, bundle,
  });
  assert.equal(result.acceptedCommands.length, 0);
  assert.equal(result.taskResults[SEMANTIC_TASK.ACTION].status, "concept_validation_failure");
});

test("every accepted action and reasoning claim requires verbatim grounding", async () => {
  const result = await runSplitSemanticShadow({
    provider: provider({
      [SEMANTIC_TASK.ACTION]: {
        clinicalActions: [{ type: "ORDER_TEST", params: { testId: "cbc" }, evidenceSpans: ["общий анализ крови"] }],
        patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta,
      },
      [SEMANTIC_TASK.REASONING]: {
        reasoningDelta: { workingDiagnosis: { conceptId: "acute_appendicitis", evidenceSpan: "это аппендицит" } }, ambiguities: [], meta,
      },
    }),
    text: "ОАК", locale: "ru", turnContext: {}, bundle,
  });
  assert.equal(result.acceptedCommands.length, 0);
  assert.deepEqual(result.taskResults[SEMANTIC_TASK.REASONING].acceptedReasoningDelta, {});
});

test("tentative operation never becomes a committed accepted action", async () => {
  const text = "можно подумать о лапароскопии";
  const result = await runSplitSemanticShadow({
    provider: provider({
      [SEMANTIC_TASK.ACTION]: {
        clinicalActions: [{ type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" }, evidenceSpans: [text] }],
        patientQuestions: [], ambiguities: [{ evidenceSpan: text, reason: "tentative_not_committed" }], unresolvedFragments: [], meta,
      },
      [SEMANTIC_TASK.REASONING]: { reasoningDelta: { managementIntent: { intent: "operative", evidenceSpan: text, tentative: true } }, ambiguities: [], meta },
    }),
    text, locale: "ru", turnContext: {}, bundle,
  });
  assert.equal(result.acceptedCommands.length, 0);
  assert.ok(result.taskResults[SEMANTIC_TASK.REASONING].acceptedReasoningDelta.managementIntent);
});

test("не знаю under an open mentor question produces no clinical action", async () => {
  const result = await runSplitSemanticShadow({
    provider: provider({
      [SEMANTIC_TASK.ACTION]: emptyAction(),
      [SEMANTIC_TASK.MENTOR_ANSWER]: { ...emptyMentor(), mentorAnswerDelta: { domains: [], evidenceSpans: [], completeness: "none", stuck: true } },
    }),
    text: "не знаю", locale: "ru",
    turnContext: { openMentorQuestion: { id: "why", text: "Почему?", expectedDomains: ["rationale"] } }, bundle,
  });
  assert.equal(result.acceptedCommands.length, 0);
  assert.equal(result.taskResults[SEMANTIC_TASK.MENTOR_ANSWER].output.answered, false);
});

test("one task failure does not corrupt another task output", async () => {
  const timeout = new Error("timeout"); timeout.name = "AbortError";
  const result = await runSplitSemanticShadow({
    provider: provider({
      [SEMANTIC_TASK.ACTION]: { clinicalActions: [{ type: "ORDER_TEST", params: { testId: "cbc" }, evidenceSpans: ["ОАК"] }], patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta },
    }, { [SEMANTIC_TASK.REASONING]: timeout }),
    text: "ОАК", locale: "ru", turnContext: {}, bundle,
  });
  assert.equal(result.taskResults[SEMANTIC_TASK.ACTION].status, "valid");
  assert.equal(result.taskResults[SEMANTIC_TASK.REASONING].status, "provider_timeout");
  assert.equal(result.acceptedCommands.length, 1);
  assert.equal(result.clinicalAuthority, "none");
  assert.equal(result.executedSource, "deterministic");
});

test("a proposal whose only problem is an ungrounded identifying concept is turned into a CLARIFY-eligible command, not dropped", async () => {
  const text = "надо бы кровь на воспаление глянуть";
  const result = await interpretSemanticTask({
    task: SEMANTIC_TASK.ACTION,
    provider: provider({
      [SEMANTIC_TASK.ACTION]: {
        clinicalActions: [{ type: "ORDER_TEST", params: { testId: "crp" }, evidenceSpans: [text], statedParameters: [] }],
        patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta,
      },
    }),
    text, locale: "ru", turnContext: {}, bundle,
  });
  assert.equal(result.status, "valid", "an ungrounded-only identifier must not fail the whole turn");
  assert.equal(result.acceptedCommands.length, 0, "the model's specific guess is never silently accepted");
  assert.equal(result.ambiguousCommands.length, 1);
  assert.equal(result.ambiguousCommands[0].type, "ORDER_TEST");
  assert.equal("testId" in result.ambiguousCommands[0].params, false, "the ungrounded concept is stripped, not guessed");
});

test("a high-risk action with an ungrounded target is still rejected outright, never turned into a clarification", async () => {
  const text = "переведите в отделение";
  const result = await interpretSemanticTask({
    task: SEMANTIC_TASK.ACTION,
    provider: provider({
      [SEMANTIC_TASK.ACTION]: {
        clinicalActions: [{ type: "TRANSFER", params: { destination: "icu" }, evidenceSpans: [text], statedParameters: [] }],
        patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta,
      },
    }),
    text, locale: "ru", turnContext: {}, bundle,
  });
  assert.equal(result.ambiguousCommands.length, 0, "high-risk action types never get the ambiguity pass-through");
  assert.equal(result.status, "concept_validation_failure");
  assert.equal(result.acceptedCommands.length, 0);
});

test("a hallucinated action whose TYPE is not in the learner's words is dropped, never turned into a clarification", async () => {
  const text = "Коллеги, проверьте клеточный состав крови";
  const result = await interpretSemanticTask({
    task: SEMANTIC_TASK.ACTION,
    provider: provider({
      [SEMANTIC_TASK.ACTION]: {
        clinicalActions: [{ type: "CALL_STAFF", params: { role: "surgeon" }, evidenceSpans: [text], statedParameters: [] }],
        patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta,
      },
    }),
    text, locale: "ru", turnContext: {}, bundle,
  });
  assert.equal(result.ambiguousCommands.length, 0);
  assert.equal(result.acceptedCommands.length, 0);
});

test("named-test paraphrases ground; category words do not", async () => {
  const ask = async (text, testId) => interpretSemanticTask({
    task: SEMANTIC_TASK.ACTION,
    provider: provider({ [SEMANTIC_TASK.ACTION]: {
      clinicalActions: [{ type: "ORDER_TEST", params: { testId, analytes: [testId] }, evidenceSpans: [text], statedParameters: [] }],
      patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta } }),
    text, locale: "ru", turnContext: {}, bundle, strictAction: true,
  });
  const named = await ask("сделайте ультразвуковое исследование живота", "ultrasound_abdomen");
  assert.equal(named.status, "valid");
  assert.equal(named.acceptedCommands.length, 1, "explicitly named test is accepted, not re-asked");
  const pelvic = await ask("сделайте ультразвуковое исследование малого таза", "ultrasound_abdomen");
  assert.equal(pelvic.acceptedCommands.length, 0, "pelvic ultrasound never grounds an abdominal one");
  const category = await ask("надо бы кровь на воспаление глянуть", "crp");
  assert.equal(category.acceptedCommands.length, 0);
  assert.equal(category.ambiguousCommands.length, 1, "a category word stays a clarification");
});

test("imaging grounds by modality + region in any word order; a pelvic qualifier never grounds the abdominal study", async () => {
  const ask = async (text, testId) => interpretSemanticTask({
    task: SEMANTIC_TASK.ACTION,
    provider: provider({ [SEMANTIC_TASK.ACTION]: {
      clinicalActions: [{ type: "ORDER_TEST", params: { testId }, evidenceSpans: [text], statedParameters: [] }],
      patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta } }),
    text, locale: "ru", turnContext: {}, bundle, strictAction: true,
  });
  assert.equal((await ask("посмотрите брюшную полость ультразвуком", "ultrasound_abdomen")).acceptedCommands.length, 1);
  assert.equal((await ask("отправьте на томографию брюшной полости", "ct_abdomen")).acceptedCommands.length, 1);
  assert.equal((await ask("узи малого таза", "ultrasound_abdomen")).acceptedCommands.length, 0);
  assert.equal((await ask("сонография малого таза", "ultrasound_abdomen")).acceptedCommands.length, 0);
});
