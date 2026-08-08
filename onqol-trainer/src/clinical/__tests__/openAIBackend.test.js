import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAIRequest,
  extractOpenAIResponseText,
  requestOpenAI,
} from "../../../server/openaiGateway.mjs";
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
