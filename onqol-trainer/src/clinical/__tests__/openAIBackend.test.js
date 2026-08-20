import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAIRequest,
  extractOpenAIResponseText,
  requestOpenAI,
} from "../../../server/openaiGateway.mjs";
import { DISPOSITION_DESTINATIONS, STABILITY_ASSESSMENTS } from "../core/reasoningState.js";
import { ROUTER_JSON_SCHEMA, ROUTER_SCHEMA_VERSION } from "../schemas/routerSchema.js";
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

test("the gateway ships the one router contract, not a copy of it", () => {
  // The prompt, the normaliser and the provider schema used to be three
  // separate descriptions of the same object, and they had drifted: the prompt
  // asked for ranked hypotheses with evidence, the schema allowed a bare list of
  // ids. Under strict mode the richer half simply could not come back.
  const shipped = buildOpenAIRequest({ task: "router", prompt }).text.format.schema;
  assert.deepEqual(shipped, ROUTER_JSON_SCHEMA, "шлюз должен отдавать ровно тот же контракт");
  assert.equal(ROUTER_SCHEMA_VERSION, "router-v3");
  assert.ok(shipped.properties.intents.items.required.includes("requested_fragment"));
});

test("the router schema can actually carry the reasoning the prompt asks for", () => {
  const schema = buildOpenAIRequest({ task: "router", prompt }).text.format.schema;
  assert.ok(schema.required.includes("reasoning"));

  const reasoning = schema.properties.reasoning;
  for (const field of [
    "stability",
    "problem_representation_stated",
    "problem_representation_verbatim",
    "working_diagnosis",
    "differential",
    "test_reasoning",
    "management",
    "observation",
    "reassessment_stated",
    "contingency",
    "disposition",
    "consultation",
  ]) {
    assert.ok(reasoning.properties[field], `router schema cannot return reasoning.${field}`);
    assert.ok(reasoning.required.includes(field), `reasoning.${field} must be required under strict mode`);
  }

  // The four fields the drift had removed, checked by shape and not by name.
  const item = reasoning.properties.differential.properties.items.items;
  for (const field of ["concept_id", "rank", "dangerous", "evidence_for", "evidence_against"]) {
    assert.ok(item.properties[field], `гипотеза не может нести ${field}`);
  }
  assert.ok(reasoning.properties.test_reasoning.items.properties.justification);
  for (const field of ["stated", "trigger_concept_ids", "trigger_verbatim"]) {
    assert.ok(reasoning.properties.contingency.properties[field]);
  }

  // Treatment parameters travel beside the intents, never inside reasoning.
  const parameters = schema.properties.action_parameters.items;
  for (const field of ["concept_id", "verbatim", "dose_value", "dose_unit", "route", "volume_ml"]) {
    assert.ok(parameters.properties[field], `параметры назначения не несут ${field}`);
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

test("OpenAI mentor schema carries intervention mode and selected issue", () => {
  const request = buildOpenAIRequest({
    task: "mentor",
    prompt: { system: "mentor", user: "{}" },
  });
  const schema = request.text.format.schema;
  assert.deepEqual(schema.properties.mode.enum, [
    "CONTINUE",
    "REINFORCE",
    "CLARIFY",
    "CHALLENGE",
    "TEACH",
    "SAFETY_STOP",
  ]);
  assert.deepEqual(schema.properties.issue_id.type, ["string", "null"]);
  assert.ok(schema.required.includes("mode"));
  assert.ok(schema.required.includes("issue_id"));
  assert.ok(schema.required.includes("question_domain"));
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
          usage: {
            input_tokens: 120,
            output_tokens: 30,
            total_tokens: 150,
            input_tokens_details: { cached_tokens: 20 },
            output_tokens_details: { reasoning_tokens: 10 },
          },
          output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
        }),
      };
    },
  });
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.Authorization, "Bearer server-secret");
  assert.doesNotMatch(captured.options.body, /server-secret/);
  assert.equal(result.output, "{}");
  assert.equal(result.telemetry.usage.total_tokens, 150);
  assert.equal(result.telemetry.usage.cached_tokens, 20);
});

test("browser client sends task, prompt and a quota-scoped session header", async () => {
  let captured;
  const client = createOpenAIBackendClient({
    task: "router",
    sessionId: "session-backend-0001",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        json: async () => ({
          output: "structured-result",
          telemetry: { task: "router", latency_ms: 75, usage: { total_tokens: 44 } },
        }),
      };
    },
  });
  assert.equal(await client(prompt), "structured-result");
  assert.equal(captured.url, "/api/v25/openai");
  assert.equal(captured.options.headers["X-ONQOL-Session-Id"], "session-backend-0001");
  assert.deepEqual(JSON.parse(captured.options.body), { task: "router", prompt });
  assert.equal(client.telemetry[0].usage.total_tokens, 44);
});

test("backend status fails closed when the endpoint is unavailable", async () => {
  const status = await getOpenAIBackendStatus(async () => {
    throw new Error("offline");
  });
  assert.equal(status.configured, false);
  assert.equal(status.accessGranted, false);
  assert.equal(status.routerModel, "gpt-5.6-luna");
});

test("backend status sends the pilot code for preflight verification", async () => {
  let captured;
  const status = await getOpenAIBackendStatus({
    accessToken: "pilot-access-code",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        json: async () => ({ configured: true, accessRequired: true, accessGranted: true }),
      };
    },
  });
  assert.equal(status.accessGranted, true);
  assert.equal(captured.options.headers.Authorization, "Bearer pilot-access-code");
});
