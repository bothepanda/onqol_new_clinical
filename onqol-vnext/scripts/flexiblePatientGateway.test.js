import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createFlexiblePatientGateway } from "../server/flexiblePatientGateway.mjs";
import { createSpeechInput } from "../src/ai/patient/flexiblePatient.js";

function request(gateway, body, headers = {}) {
  return new Promise((resolve) => {
    const req = Readable.from([JSON.stringify(body)]); req.url = "/api/flexible/turn"; req.method = "POST"; req.headers = headers;
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(raw) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(raw) }); } };
    gateway(req, res, () => resolve({ status: 404 }));
  });
}
test("flexible gateway is opt-in, rejects pilot/origin mismatch, and fails without a provider", async () => {
  const input = createSpeechInput({ message: { role: "env", speakerRu: "Пациент", textRu: "Боль 6/10" } });
  const body = { sessionId: "flex-http", input };
  for (const env of [{}, { ONQOL_FLEXIBLE_PATIENT: "true", VITE_ONQOL_PILOT: "true" }]) {
    assert.equal((await request(createFlexiblePatientGateway({ env }), body)).status, 404);
  }
  const env = { ONQOL_FLEXIBLE_PATIENT: "true", ONQOL_ALLOWED_ORIGIN: "http://localhost" };
  assert.equal((await request(createFlexiblePatientGateway({ env }), body, { origin: "http://elsewhere" })).status, 403);
  const result = await request(createFlexiblePatientGateway({ env }), body);
  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  assert.equal(result.body.audit.fallbackUsed, true);
  assert.equal(result.body.text, input.allowedFacts[0].text);
  assert.equal((await request(createFlexiblePatientGateway({ env }), { ...body, session: { truth: "hidden" } })).status, 400);
});
