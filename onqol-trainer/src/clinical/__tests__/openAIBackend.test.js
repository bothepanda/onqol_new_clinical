import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAIRequest,
  extractOpenAIResponseText,
  requestOpenAI,
} from "../../../server/openaiGateway.mjs";
import { DISPOSITION_DESTINATIONS, STABILITY_ASSESSMENTS } from "../core/reasoningState.js";
import {
  createOpenAIBackendClient,
  getOpenAIBackendStatus,
} from "../v25/openAIBackendClient.js";

const prompt = { system: "Extract actions.", user: "Назначаю ОАК" };

test("OpenAI router request uses Luna and strict structured output", () => {
  const request = buildOpenAIRequest({ task: "router", prompt });
  assert.equal(request.model, "gpt-5.6-luna");
  assert.equal(request.store, false);
  assert.equal(request.text.format.type, "json_schema");
  assert.equal(request.text.format.strict, true);
  assert.equal(request.text.format.schema.additionalProperties, false);
});

test("the router schema can actually carry the reasoning the prompt asks for", () => {
  // Structured output is strict with additionalProperties:false, so a field the
  // schema does not name cannot be returned however clearly the prompt requests
  // it. Reasoning extraction was silently empty in a live session for exactly
  // this reason: the prompt had been extended and the schema had not.
  const schema = buildOpenAIRequest({ task: "router", prompt }).text.format.schema;
  assert.ok(schema.required.includes("reasoning"));

  const reasoning = schema.properties.reasoning;
  for (const field of [
    "stability",
    "working_diagnosis",
    "differential",
    "test_reasoning",
    "management",
    "observation",
    "contingency_stated",
    "disposition",
    "consultation",
  ]) {
    assert.ok(reasoning.properties[field], `router schema cannot return reasoning.${field}`);
    assert.ok(reasoning.required.includes(field), `reasoning.${field} must be required under strict mode`);
  }

  // Every enum the client normalises against must be expressible.
  for (const value of STABILITY_ASSESSMENTS) {
    assert.ok(reasoning.properties.stability.properties.learner_assessment.enum.includes(value));
  }
  for (const value of DISPOSITION_DESTINATIONS) {
    assert.ok(reasoning.properties.disposition.properties.destination.enum.includes(value));
  }
});

test("OpenAI simulator request uses Terra and a separate response schema", () => {
  const request = buildOpenAIRequest({ task: "simulator", prompt });
  assert.equal(request.model, "gpt-5.6-terra");
  assert.equal(request.text.format.name, "onqol_simulator_envelope");
});

test("OpenAI raw response text is collected from message output items", () => {
  const output = extractOpenAIResponseText({
    output: [
      { type: "reasoning", content: [] },
      { type: "message", content: [{ type: "output_text", text: "{\"intents\":[]}" }] },
    ],
  });
  assert.equal(output, '{"intents":[]}');
});

test("server request keeps the API key in the Authorization header", async () => {
  let captured;
  const result = await requestOpenAI({
    apiKey: "server-secret",
    task: "router",
    prompt,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp_test",
          model: "gpt-5.6-luna",
          output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
        }),
      };
    },
  });
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.Authorization, "Bearer server-secret");
  assert.doesNotMatch(captured.options.body, /server-secret/);
  assert.equal(result.output, "{}");
});

test("browser client sends only task and prompt to the same-origin backend", async () => {
  let captured;
  const client = createOpenAIBackendClient({
    task: "router",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ output: "structured-result" }) };
    },
  });
  assert.equal(await client(prompt), "structured-result");
  assert.equal(captured.url, "/api/v25/openai");
  assert.deepEqual(JSON.parse(captured.options.body), { task: "router", prompt });
});

test("backend status fails closed when the endpoint is unavailable", async () => {
  const status = await getOpenAIBackendStatus(async () => {
    throw new Error("offline");
  });
  assert.equal(status.configured, false);
  assert.equal(status.routerModel, "gpt-5.6-luna");
});
