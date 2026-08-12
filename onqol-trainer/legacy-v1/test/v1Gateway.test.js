import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnthropicRequest,
  createV1Gateway,
  requestAnthropic,
} from "../server/v1Gateway.mjs";

const SYSTEM = "x".repeat(120);
const MESSAGES = [{ role: "user", content: "Начать кейс" }];

test("V1 provider request has a fixed model envelope and no browser credential", () => {
  const request = buildAnthropicRequest({ system: SYSTEM, messages: MESSAGES });
  assert.equal(request.max_tokens, 2048);
  assert.deepEqual(request.messages, MESSAGES);
  assert.equal("apiKey" in request, false);
});

test("V1 server sends the provider key only in the server-side header", async () => {
  let captured;
  const result = await requestAnthropic({
    apiKey: "server-secret",
    system: SYSTEM,
    messages: MESSAGES,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: "test-model",
          content: [{ type: "text", text: "Ответ" }],
        }),
      };
    },
  });
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  assert.equal(captured.options.headers["x-api-key"], "server-secret");
  assert.doesNotMatch(captured.options.body, /server-secret/);
  assert.equal(result.output, "Ответ");
});

test("V1 rejects malformed message history before calling the provider", () => {
  assert.throws(
    () => buildAnthropicRequest({ system: SYSTEM, messages: [{ role: "system", content: "x" }] }),
    /Invalid V1 message history/,
  );
});

test("V1 gateway rejects an invalid internal access code before provider use", async () => {
  let providerCalled = false;
  let responseBody;
  const response = {
    setHeader() {},
    end(body) {
      responseBody = JSON.parse(body);
    },
  };
  const gateway = createV1Gateway({
    apiKey: "server-secret",
    accessToken: "expected-code",
    fetchImpl: async () => {
      providerCalled = true;
      throw new Error("must not be called");
    },
  });

  await gateway(
    {
      method: "POST",
      url: "/api/anthropic",
      headers: { authorization: "Bearer wrong-code" },
      socket: { remoteAddress: "127.0.0.1" },
    },
    response,
  );

  assert.equal(response.statusCode, 401);
  assert.equal(responseBody.error, "Invalid V1 access code.");
  assert.equal(providerCalled, false);
});
