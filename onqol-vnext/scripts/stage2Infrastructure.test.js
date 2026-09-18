import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAiGateway } from "../server/aiGateway.mjs";
import { createGatewayProviderClient } from "../src/ai/providerClient.js";
import { interpretHybrid } from "../src/ai/interpreter/hybridInterpreter.js";
import { interpretDeterministically } from "../src/ai/interpreter/deterministicInterpreter.js";
import { buildSemanticTaskRequest } from "../src/ai/interpreter/splitSemanticInterpreter.js";
import { stage2ActionFormat } from "../src/ai/interpreter/stage2ActionSchema.js";
import { SEMANTIC_TASK, WAVE23_SCHEMA_VERSION } from "../src/ai/interpreter/semanticTaskSchemas.js";
import { createSession } from "../src/core/session/createSession.js";
import { submitLearnerTurn } from "../src/core/session/submitLearnerTurn.js";
import { exportSession } from "../src/core/replay/exportSession.js";
import { reduceEvents } from "../src/core/state/worldState.js";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

const bundle = withShared(disease, shared);
const text = "оак и гляньте желчный на ультразвуке";
const empty = { clinicalActions: [], patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta: { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 1 } };
test("Anthropic gateway translates strict schema, headers and usage without OpenAI fields", async () => {
  let sent;
  const gateway = createAiGateway({ env: { ONQOL_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fixture" }, fetchImpl: async (url, options) => {
    assert.equal(url, "https://api.anthropic.com/v1/messages");
    assert.equal(options.headers["x-api-key"], "fixture");
    assert.equal(options.headers.Authorization, undefined);
    sent = JSON.parse(options.body);
    return Response.json({ model: "claude-haiku-4-5-20251001", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(empty) }], usage: { input_tokens: 100, output_tokens: 10 } });
  } });
  const result = await interpretHybrid({ text, bundle, provider: createGatewayProviderClient({ fetchImpl: transport(gateway), sessionId: "anthropic-test" }) });
  assert.equal(sent.output_config.format.type, "json_schema");
  assert.equal(sent.output_config.format.schema.properties.meta.properties.confidence.minimum, undefined);
  // Anthropic compiles the response schema into a grammar and rejects the
  // per-command-type anyOf outright, so the adapter collapses it into one
  // object. Per-type parameter legality is enforced locally, not on the wire.
  const items = sent.output_config.format.schema.properties.clinicalActions.items;
  assert.equal(items.anyOf, undefined);
  assert.ok(items.properties.type.enum.length > 20);
  assert.deepEqual(items.properties.params.required, []);
  assert.ok(Object.values(items.properties.params.properties).every((field) => typeof field.type === "string"));
  assert.ok(!Object.keys(items.properties.params.properties).some((key) => ["dose", "doseMg", "route", "volumeMl"].includes(key)));
  assert.ok(JSON.stringify(sent.output_config.format.schema).length < 6000);
  assert.equal(typeof sent.system, "string");
  assert.ok(sent.messages.every((m) => m.role !== "system"));
  assert.equal(sent.store, undefined);
  assert.equal(result.semanticTelemetry.costUsd, 0.00015);
  assert.equal(result.semanticTelemetry.status, "valid");
});

// The flattened Anthropic wire schema no longer says which parameter belongs to
// which command type, so the local layer has to be the one that refuses.
test("a cross-type parameter the flattened schema permits is still rejected locally", async () => {
  const invented = { ...empty, clinicalActions: [{ type: "ORDER_TEST", params: { testId: "cbc", drugId: "morphine" }, evidenceSpans: ["оак"], statedParameters: [] }] };
  const gateway = createAiGateway({ env: { ONQOL_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fixture" },
    fetchImpl: async () => Response.json({ model: "claude-haiku-4-5-20251001", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(invented) }], usage: { input_tokens: 100, output_tokens: 10 } }) });
  const result = await interpretHybrid({ text, bundle, provider: createGatewayProviderClient({ fetchImpl: transport(gateway), sessionId: "anthropic-crosstype" }) });
  assert.ok(result.semanticTelemetry.conceptErrors.some((error) => error.includes("params.drugId_not_allowlisted")));
  assert.ok(result.commands.every((command) => command.params?.drugId === undefined));
  assert.equal(result.semanticTelemetry.added, 0);
});

for (const stop of ["max_tokens", "refusal", "tool_use"]) {
  test(`Anthropic ${stop} fails closed`, async () => {
    const gateway = createAiGateway({ env: { ONQOL_AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "fixture" }, logger: { error() {} },
      fetchImpl: async () => Response.json({ stop_reason: stop, content: [{ type: "text", text: JSON.stringify(empty) }] }) });
    const result = await interpretHybrid({ text, bundle, provider: createGatewayProviderClient({ fetchImpl: transport(gateway) }) });
    assert.equal(result.mode, "hybrid_fallback_deterministic");
    assert.deepEqual(result.commands, interpretDeterministically({ text, bundle }).commands);
  });
}
function transport(gateway) {
  return async (url, options) => new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { url, method: "POST", headers: {}, socket: { remoteAddress: "127.0.0.1" }, destroy() {} });
    const res = { statusCode: 200, setHeader() {}, end(body) { resolve(new Response(body, { status: this.statusCode })); } };
    gateway(req, res, () => { res.statusCode = 404; res.end("{}"); });
    req.emit("data", options.body); req.emit("end");
  });
}

test("Stage2 strict schema recursively closes every object and requires every property", () => {
  const request = buildSemanticTaskRequest({ task: SEMANTIC_TASK.ACTION, text, locale: "ru", bundle });
  const format = stage2ActionFormat(request.allowlist);
  assert.equal(format.json_schema.strict, true);
  function check(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "object") { assert.equal(node.additionalProperties, false); assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort()); }
    for (const value of Object.values(node)) if (value && typeof value === "object") check(value);
  }
  check(format.json_schema.schema);
});

test("Stage2 provider request excludes hidden patient and future-state sentinels", async () => {
  let captured;
  const result = await interpretHybrid({ text, bundle: { ...bundle, patient: "SECRET_PATIENT", hiddenState: "SECRET_FUTURE" },
    turnContext: { patient: "SECRET_PATIENT", hiddenState: "SECRET_FUTURE", openClarification: { commandType: "ORDER_TEST", patient: "SECRET_PATIENT", params: { hiddenState: "SECRET_FUTURE", testId: "cbc" } } },
    provider: { isConfigured: true, async complete(request) { captured = request; return { text: JSON.stringify(empty) }; } },
  });
  assert.equal(result.mode, "hybrid");
  assert.ok(captured);
  assert.doesNotMatch(JSON.stringify(captured), /SECRET_PATIENT|SECRET_FUTURE/);
  assert.deepEqual(Object.keys(JSON.parse(captured.messages[1].content)).sort(), ["allowlist", "locale", "openStaffClarification", "rawLearnerText"]);
});

test("Stage2 forwards strict format end to end and records cost without provider extras", async () => {
  let sent;
  const gateway = createAiGateway({ env: { OPENAI_API_KEY: "fixture" }, fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ model: "fixture-model", choices: [{ message: { content: JSON.stringify(empty) } }], usage: { prompt_tokens: 100, completion_tokens: 10 }, privateDetail: "PRIVATE" });
  } });
  const result = await interpretHybrid({ text, bundle, provider: createGatewayProviderClient({ fetchImpl: transport(gateway), sessionId: "fixture-session" }) });
  assert.equal(sent.response_format.json_schema.strict, true);
  assert.equal(sent.store, false);
  assert.equal(result.semanticTelemetry.model, "fixture-model");
  assert.equal(result.semanticTelemetry.costUsd, 0.000045);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

for (const [status, upstreamCode, expected] of [[401, "bad_key", "provider_auth"], [429, "insufficient_quota", "provider_quota"], [429, "rate_limit", "rate_limited"], [500, "internal", "provider_error"]]) {
  test(`Stage2 ${status}/${upstreamCode} is normalized and preserves the deterministic turn`, async () => {
    const gateway = createAiGateway({ env: { OPENAI_API_KEY: "fixture" }, logger: { error() {} },
      fetchImpl: async () => Response.json({ error: { code: upstreamCode, message: "PRIVATE_DETAILS" } }, { status }) });
    const result = await interpretHybrid({ text, bundle, provider: createGatewayProviderClient({ fetchImpl: transport(gateway) }) });
    assert.equal(result.mode, "hybrid_fallback_deterministic");
    assert.equal(result.semanticTelemetry.errorCode, expected);
    assert.deepEqual(result.commands, interpretDeterministically({ text, bundle }).commands);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_DETAILS/);
  });
}

test("Stage2 broken JSON and timeout preserve commands", async () => {
  for (const complete of [async () => ({ text: "{" }), async () => { throw Object.assign(new Error("timeout"), { code: "provider_timeout" }); }]) {
    const result = await interpretHybrid({ text, bundle, provider: { isConfigured: true, complete } });
    assert.equal(result.mode, "hybrid_fallback_deterministic");
    assert.deepEqual(result.commands, interpretDeterministically({ text, bundle }).commands);
  }
});

test("Stage2 browser DOMException timeout is normalized without mutating read-only code", async () => {
  const client = createGatewayProviderClient({ fetchImpl: async () => { throw new DOMException("aborted", "AbortError"); } });
  await assert.rejects(client.complete({ messages: [], responseFormat: {} }), { code: "provider_timeout" });
});

test("Stage2 merge cannot add a second chemistry panel with different analytes", async () => {
  const result = await interpretHybrid({ text: "оак, бхак и сделай процедуру Z", bundle, provider: { isConfigured: true }, runSemantic: async () => ({ status: "valid",
    acceptedCommands: [{ type: "ORDER_TEST", params: { testId: "chemistry", analytes: ["creatinine"] }, evidence: "бхак" }] }) });
  assert.equal(result.commands.filter((c) => c.params.testId === "chemistry").length, 1);
  assert.ok(result.semanticTelemetry.rejected.some((r) => r.reason === "duplicate_primary_concept"));
});

test("Stage2 gateway enforces session call budget before another paid request", async () => {
  let calls = 0;
  const gateway = createAiGateway({ env: { OPENAI_API_KEY: "fixture", ONQOL_RATE_LIMIT_PER_MIN: "1000" }, logger: { error() {} },
    fetchImpl: async () => { calls++; return Response.json({ choices: [{ message: { content: "{}" } }] }); } });
  const provider = createGatewayProviderClient({ fetchImpl: transport(gateway), sessionId: "budget-test" });
  for (let i = 0; i < 40; i++) await provider.complete({ messages: [{ role: "user", content: "test" }], responseFormat: {} });
  await assert.rejects(provider.complete({ messages: [{ role: "user", content: "test" }], responseFormat: {} }), { code: "provider_quota" });
  assert.equal(calls, 40);
});

test("Stage2 hybrid event export replays with a provider that throws on every call", async () => {
  const session = createSession({ sessionId: "stage2-replay", seed: "stage2", mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle, locale: "ru", startIso: "2026-09-08T08:00:00+05:00" });
  const interpreted = await interpretHybrid({ text, bundle, provider: { isConfigured: true, async complete() { return { text: JSON.stringify(empty), meta: { model: "fixture-model" } }; } } });
  const turn = submitLearnerTurn({ session, text, interpreted });
  const exported = exportSession({ session: turn.session, generatedAtIso: "2026-09-08T12:00:00Z" });
  const bomb = { async complete() { assert.fail("replay called provider"); } };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = () => bomb.complete();
    const rebuilt = reduceEvents(session.state, exported.events.slice(session.events.length));
    assert.deepEqual(rebuilt, exported.current_state);
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(exported.interpreter.telemetryByTurn[0].model, "fixture-model");
  assert.equal("rawOutput" in exported.interpreter.telemetryByTurn[0], false);
});
