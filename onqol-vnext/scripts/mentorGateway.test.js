import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createMentorGateway } from "../server/mentorGateway.mjs";
const context = { casePresetId: "APP-004", sessionPurpose: "internal_development", locale: "ru", text: "Объясни миграцию боли", history: [], facts: [], truth: "HIDDEN_CANARY", cards: [{ id: "EVIL_CARD" }] };
const draft = { mode: "TEACH", sentences: [{ text: "Миграцию боли можно объяснить вовлечением париетальной брюшины.", kind: "clinical", cardIds: ["K01"], factIds: [] }], question: null };
const verdict = { supported: true, patientGrounded: true, noNewManagement: true, noHiddenDiagnosis: true, appropriateQuestion: true, allSentencesClassified: true, noFalseAttribution: true, reasons: [] };
function invoke(middleware, body = { sessionId: "mentor-ci", context }, origin) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([JSON.stringify(body)]); req.method = "POST"; req.url = "/api/mentor/dialogue"; req.headers = { origin }; req.socket = { remoteAddress: "ci" };
    const headers = {};
    middleware(req, { statusCode: 200, setHeader(k, v) { headers[k] = v; }, end(raw) { resolve({ status: this.statusCode, body: JSON.parse(raw), headers }); } }, () => reject(new Error("unhandled")));
  });
}
const store = () => ({ load: () => ({ sessions: {}, pilotReservedUsd: 0 }), save() {} });
test("mentor gateway owns prompts/cards, strips injected fields and reserves both calls", async () => {
  const requests = []; const saves = [];
  const middleware = createMentorGateway({ env: { ONQOL_EXPERIMENTAL_MENTOR: "true", OPENAI_API_KEY: "test-only" }, budgetStore: { ...store(), save: (x) => saves.push(structuredClone(x)) },
    fetchImpl: async (_url, options) => {
      const request = JSON.parse(options.body); requests.push(request);
      return { ok: true, status: 200, json: async () => ({ model: "mock", choices: [{ message: { content: JSON.stringify(requests.length === 1 ? draft : verdict) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) };
    } });
  const r = await invoke(middleware);
  assert.equal(r.body.audit.status, "accepted"); assert.equal(requests.length, 2);
  assert.equal(requests[0].store, false);
  const serialized = JSON.stringify(requests);
  for (const forbidden of ["HIDDEN_CANARY", "EVIL_CARD", '"id":"K09"']) assert.equal(serialized.includes(forbidden), false);
  assert.equal(saves.at(-1).sessions['mentor-ci'].calls, 2);
  assert.equal(r.body.audit.librarySha256.length, 64);
  assert.equal(r.headers['Cache-Control'], "private, no-store");
});
test("disabled route, wrong origin, missing key and unsupported scope do not reach provider", async () => {
  let calls = 0;
  const make = (env) => createMentorGateway({ env, budgetStore: store(), fetchImpl: async () => { calls++; throw new Error("unexpected"); }, logger: { error() {} } });
  assert.equal((await invoke(make({}))).status, 404);
  assert.equal((await invoke(make({ ONQOL_EXPERIMENTAL_MENTOR: "true", ONQOL_ALLOWED_ORIGIN: "https://allowed" }), undefined, "https://wrong")).status, 403);
  const r = await invoke(make({ ONQOL_EXPERIMENTAL_MENTOR: "true" }));
  assert.equal(r.body.audit.errorCode, "no_provider_configured");
  assert.equal((await invoke(make({ ONQOL_EXPERIMENTAL_MENTOR: "true" }), { sessionId: "x", context: { ...context, sessionPurpose: "learner_pilot" } })).body.audit.errorCode, "scope_not_approved");
  assert.equal(calls, 0);
});
