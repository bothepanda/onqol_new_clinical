import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenAIRequest,
  createOpenAIGateway,
  requestOpenAI,
} from "../../../server/openaiGateway.mjs";
import { createOpenAIBackendClient } from "../v25/openAIBackendClient.js";

const PROMPT = { system: "System boundary", user: "{}" };

function responseRecorder() {
  let body = null;
  return {
    response: {
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(value) {
        body = JSON.parse(value);
      },
    },
    body: () => body,
  };
}

function request(overrides = {}) {
  return {
    method: "POST",
    url: "/api/v25/openai",
    headers: {
      origin: "https://pilot.onqol.kz",
      host: "pilot.onqol.kz",
      authorization: "Bearer pilot-code",
      "x-onqol-session-id": "session-test-0001",
      ...(overrides.headers || {}),
    },
    socket: { remoteAddress: "127.0.0.1" },
    body: { task: "router", prompt: PROMPT },
    ...overrides,
  };
}

test("OpenAI request keeps the provider key out of the browser payload", () => {
  const payload = buildOpenAIRequest({ task: "router", prompt: PROMPT });
  assert.equal(payload.store, false);
  assert.equal(payload.instructions, PROMPT.system);
  assert.equal(payload.input, PROMPT.user);
  assert.equal("apiKey" in payload, false);
});

test("provider credential is sent only in the server-side Authorization header", async () => {
  let captured;
  const result = await requestOpenAI({
    apiKey: "provider-secret",
    task: "router",
    prompt: PROMPT,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: "resp_test",
          model: "test-model",
          output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
        }),
      };
    },
  });
  assert.equal(captured.url, "https://api.openai.com/v1/responses");
  assert.equal(captured.options.headers.Authorization, "Bearer provider-secret");
  assert.doesNotMatch(captured.options.body, /provider-secret/);
  assert.equal(result.output, "{}");
});

test("production gateway fails closed when access control is not configured", async () => {
  const gateway = createOpenAIGateway({ apiKey: "provider-secret", requireAccessControl: true });
  const recorder = responseRecorder();
  await gateway(request(), recorder.response);
  assert.equal(recorder.response.statusCode, 503);
  assert.match(recorder.body().error, /access control is not configured/i);
});

test("production gateway rejects wrong origin and access code before provider use", async () => {
  let providerCalls = 0;
  const gateway = createOpenAIGateway({
    apiKey: "provider-secret",
    accessToken: "pilot-code",
    allowedOrigin: "https://pilot.onqol.kz",
    requireAccessControl: true,
    fetchImpl: async () => {
      providerCalls += 1;
      throw new Error("must not run");
    },
  });

  const wrongOrigin = responseRecorder();
  await gateway(
    request({ headers: { origin: "https://attacker.example", authorization: "Bearer pilot-code" } }),
    wrongOrigin.response
  );
  assert.equal(wrongOrigin.response.statusCode, 403);

  const wrongToken = responseRecorder();
  await gateway(
    request({ headers: { origin: "https://pilot.onqol.kz", authorization: "Bearer wrong" } }),
    wrongToken.response
  );
  assert.equal(wrongToken.response.statusCode, 401);
  assert.equal(providerCalls, 0);
});

test("gateway applies client and per-session quotas after authentication", async () => {
  let providerCalls = 0;
  const gateway = createOpenAIGateway({
    apiKey: "provider-secret",
    accessToken: "pilot-code",
    allowedOrigin: "https://pilot.onqol.kz",
    requireAccessControl: true,
    requestsPerMinute: 1,
    fetchImpl: async () => {
      providerCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
        }),
      };
    },
  });

  const first = responseRecorder();
  await gateway(request(), first.response);
  assert.equal(first.response.statusCode, 200);

  const second = responseRecorder();
  await gateway(request(), second.response);
  assert.equal(second.response.statusCode, 429);
  assert.equal(providerCalls, 1);
});

test("one resident hitting their quota does not lock out the rest of the cohort", async () => {
  // The pilot runs eight residents from one building on one access code, so
  // every request resolves to the same client bucket. Before 20.08.2026 that
  // bucket used the per-session numbers, which made the room share one
  // resident's allowance.
  let providerCalls = 0;
  const gateway = createOpenAIGateway({
    apiKey: "provider-secret",
    accessToken: "pilot-code",
    allowedOrigin: "https://pilot.onqol.kz",
    requireAccessControl: true,
    requestsPerMinute: 2,
    pilotCohortSize: 4,
    fetchImpl: async () => {
      providerCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
        }),
      };
    },
  });

  // The helper's spread lets `overrides` replace `headers` wholesale, so the
  // full set is restated here rather than relying on a merge.
  const call = async (sessionId) => {
    const recorder = responseRecorder();
    await gateway(
      request({
        headers: {
          origin: "https://pilot.onqol.kz",
          host: "pilot.onqol.kz",
          authorization: "Bearer pilot-code",
          "x-onqol-session-id": sessionId,
        },
      }),
      recorder.response
    );
    return recorder.response.statusCode;
  };

  // One resident burns their own two and is cut off, as intended.
  assert.equal(await call("session-resident-a01"), 200);
  assert.equal(await call("session-resident-a01"), 200);
  assert.equal(await call("session-resident-a01"), 429);

  // The others are untouched: same address, same code, different sessions.
  for (const sessionId of ["session-resident-b01", "session-resident-c01", "session-resident-d01"]) {
    assert.equal(await call(sessionId), 200, `${sessionId} was locked out`);
    assert.equal(await call(sessionId), 200, `${sessionId} was locked out`);
  }
  assert.equal(providerCalls, 8);

  // The cohort ceiling still exists: 2 x 4 requests are spent, so the next
  // session on this address is refused however fresh its own quota is.
  assert.equal(await call("session-resident-e01"), 429);
});

test("browser client sends the pilot code, never the provider credential", async () => {
  let captured;
  const client = createOpenAIBackendClient({
    task: "simulator",
    accessToken: "pilot-code",
    sessionId: "session-test-0001",
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, json: async () => ({ output: "{}" }) };
    },
  });
  await client(PROMPT);
  assert.equal(captured.url, "/api/v25/openai");
  assert.equal(captured.options.headers.Authorization, "Bearer pilot-code");
  assert.equal(captured.options.headers["X-ONQOL-Session-Id"], "session-test-0001");
  assert.doesNotMatch(captured.options.body, /pilot-code|provider-secret/);
});

test("status declares gateway and strict schema versions without credentials", async () => {
  const gateway = createOpenAIGateway({
    apiKey: "provider-secret",
    accessToken: "pilot-code",
    allowedOrigin: "https://pilot.onqol.kz",
    requireAccessControl: true,
  });
  const recorder = responseRecorder();
  await gateway(request({ method: "GET", url: "/api/v25/openai/status" }), recorder.response);
  assert.equal(recorder.response.statusCode, 200);
  assert.equal(recorder.body().accessGranted, true);
  assert.ok(recorder.body().gatewayVersion);
  assert.equal(recorder.body().schemas.router.ready, true);
  assert.equal(recorder.body().schemas.mentor.version, "mentor-minimal-context-v4.1");
  assert.doesNotMatch(JSON.stringify(recorder.body()), /provider-secret|pilot-code/);
});

test("status preflight grants only the correct pilot code", async () => {
  const gateway = createOpenAIGateway({
    apiKey: "provider-secret",
    accessToken: "pilot-code",
    allowedOrigin: "https://pilot.onqol.kz",
    requireAccessControl: true,
  });
  const wrong = responseRecorder();
  await gateway(
    request({
      method: "GET",
      url: "/api/v25/openai/status",
      headers: { authorization: "Bearer wrong-code" },
    }),
    wrong.response
  );
  assert.equal(wrong.body().accessGranted, false);

  const correct = responseRecorder();
  await gateway(
    request({
      method: "GET",
      url: "/api/v25/openai/status",
      headers: { authorization: "Bearer pilot-code" },
    }),
    correct.response
  );
  assert.equal(correct.body().accessGranted, true);
});

test("model POST fails before provider use when session id is missing", async () => {
  let providerCalls = 0;
  const gateway = createOpenAIGateway({
    apiKey: "provider-secret",
    accessToken: "pilot-code",
    allowedOrigin: "https://pilot.onqol.kz",
    requireAccessControl: true,
    fetchImpl: async () => { providerCalls += 1; },
  });
  const recorder = responseRecorder();
  await gateway(
    request({ headers: { origin: "https://pilot.onqol.kz", authorization: "Bearer pilot-code" } }),
    recorder.response
  );
  assert.equal(recorder.response.statusCode, 400);
  assert.equal(providerCalls, 0);
});
