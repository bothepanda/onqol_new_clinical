import test from "node:test";
import assert from "node:assert/strict";
import { createSpeechInput, bindSpeech, renderFlexibleSpeech, acceptSpeechResult, validSpeechInput } from "./flexiblePatient.js";
import { renderPatientDialogue, exportPatientTranscript } from "../../app/session/renderPatientDialogue.js";
const input = (text = "Боль сейчас 6/10. ЧСС 109/мин. АД 99/61 мм рт.ст.") => createSpeechInput({ message: { role: "env", speakerRu: "Пациент", textRu: text } });
const proposal = { variant: 0, opening: "none", closing: "none" };
const review = { grounded: true, issues: [] };
function provider(...responses) { const calls = []; return { calls, async complete(request) {
  calls.push(request); const value = responses.shift(); if (value instanceof Error) throw value;
  return { text: typeof value === "string" ? value : JSON.stringify(value), meta: { model: "fixture" } };
} }; }

for (const [label, unsupported] of Object.entries({ BP: "АД 120/75", HR: "ЧСС 88", dose: "100 мг", unit: "6 г", lab: "Hb 120 г/л", timing: "через 5 минут", RR: "ЧДД 16", SpO2: "SpO₂ 99%", temperature: "36.6 °C", urine: "Диурез 100 мл", drain: "Дренаж 50 мл", volume: "Введено 1000 мл", rate: "100 мл/ч", normal: "Осмотр без особенностей", resource: "КТ нет в больнице", improvement: "После лечения боль прошла", diagnosis: "У вас подтверждён скрытый диагноз" })) {
  test(`guard rejects unsupported ${label} even with a permissive verifier`, async () => {
    const p = provider({ ...proposal, text: unsupported }, { ...proposal, text: unsupported });
    const result = await renderFlexibleSpeech({ input: input(), provider: p });
    assert.equal(result.audit.fallbackUsed, true);
    assert.equal(result.text, input().allowedFacts[0].text);
    assert.ok(result.audit.attempts.every((x) => x.verifier === null));
    assert.equal(p.calls.length, 2);
  });
}
test("numeric clauses are bound whole: cannot swap dose/rate, round or replace ranges", () => {
  const i = input("Доза 0,5 мг, скорость 2 мл/ч, ожидается 15–30 минут.");
  assert.equal(bindSpeech(i, proposal), i.allowedFacts[0].text);
  assert.throws(() => bindSpeech(i, { ...proposal, facts: [{ value: 1 }] }), /unsupported/);
});
test("natural equivalent paraphrase and conversational framing retain every fact", async () => {
  const result = await renderFlexibleSpeech({ input: input(), provider: provider({ variant: 1, opening: "answer", closing: "listening" }, review) });
  assert.equal(result.text, "Отвечу на ваш вопрос. Сейчас боль 6/10. ЧСС 109/мин. АД 99/61 мм рт.ст. Я вас слушаю.");
  assert.equal(result.audit.fallbackUsed, false);
});
test("bounded retry preserves rejected raw output and accepts only subsequent grounded slots", async () => {
  const result = await renderFlexibleSpeech({ input: input(), provider: provider({ text: "new fact" }, proposal, review) });
  assert.equal(result.audit.retryCount, 1); assert.equal(result.audit.fallbackUsed, false);
  assert.match(result.audit.attempts[0].calls[0].raw, /new fact/);
  assert.equal(result.text.includes("new fact"), false);
});
test("verifier can veto but never repair/authorize clinical text", async () => {
  const result = await renderFlexibleSpeech({ input: input(), provider: provider(proposal, { grounded: false, issues: ["contradiction"] }, proposal, { ...review, facts: ["normal"] }) });
  assert.equal(result.audit.fallbackUsed, true); assert.equal(result.audit.attempts.length, 2);
});
test("malformed response, missing reviewer, provider error fall back within two attempts", async () => {
  for (const responses of [["{", "{"], [proposal, new Error("timeout"), new Error("offline")], [new Error("offline"), new Error("offline")]]) {
    const result = await renderFlexibleSpeech({ input: input(), provider: provider(...responses) });
    assert.equal(result.text, input().allowedFacts[0].text); assert.equal(result.audit.fallbackUsed, true);
    assert.equal(result.audit.attempts.length, 2);
  }
});
test("client binds its own facts even if a compromised gateway sends new text or facts", () => {
  assert.equal(acceptSpeechResult(input(), { text: "HALLUCINATION", audit: { acceptedProposal: proposal, visibleFacts: ["HALLUCINATION"] } }), input().allowedFacts[0].text);
  assert.equal(acceptSpeechResult(input(), { audit: { acceptedProposal: { ...proposal, text: "bad" } } }), input().allowedFacts[0].text);
});
test("renderer boundary rejects hidden state and has no mentor speaker", () => {
  assert.equal(validSpeechInput({ ...input(), patient: { truth: "hidden" } }), false);
  assert.equal(validSpeechInput({ ...input(), speaker: "mentor" }), false);
  assert.equal(createSpeechInput({ message: { role: "mentor", textRu: "Advice" } }), null);
});
test("projection selects visible fields and excludes mentor from context", () => {
  const i = createSpeechInput({ message: { role: "env", speakerRu: "Пациент", textRu: "Ответ", hiddenDiagnosis: "secret" }, context: [{ role: "mentor", textRu: "hint" }, { role: "learner", textRu: "Вопрос" }] });
  assert.equal(JSON.stringify(i).includes("secret"), false); assert.equal(JSON.stringify(i).includes("hint"), false);
});
test("no renderer output mutates state, clock, events or mentor; local audit does not leak into learner export", async () => {
  const session = { sessionId: "fixture", state: { turn: 1, physiology: { heartRate: 109 }, truth: { diagnosis: "SECRET" }, clock: { elapsedMinutes: 30 }, session: { status: "active" } }, events: [{ seq: 2, payload: {} }] };
  const before = structuredClone(session);
  let payload;
  const result = await renderPatientDialogue({ session, messages: [], rendered: [{ role: "env", speakerRu: "Пациент", textRu: "ЧСС 109/мин" }, { role: "mentor", textRu: "Подумайте" }],
    fetchImpl: async (_, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ text: "BAD", audit: { acceptedProposal: proposal, attempts: [{ raw: "SECRET" }] } }) }; } });
  assert.deepEqual(session, before); assert.deepEqual(result.session.state, before.state); assert.deepEqual(result.session.events, before.events);
  assert.equal(JSON.stringify(payload).includes("SECRET"), false);
  assert.equal(result.messages[1].role, "mentor"); assert.equal(result.messages[0].textRu, "ЧСС 109/мин");
  assert.equal(JSON.stringify(exportPatientTranscript({ session: result.session, messages: result.messages })).includes("SECRET"), false);
});
test("transport failure preserves already executed clinical action and returns original truth", async () => {
  const s = { sessionId: "s", state: { turn: 1 }, events: [] };
  const result = await renderPatientDialogue({ session: s, messages: [], rendered: [{ role: "env", speakerRu: "Медсестра", textRu: "Введено 100 мг." }], fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(result.messages[0].textRu, "Введено 100 мг."); assert.equal(result.session.patientDialogue[0].fallbackUsed, true);
});
test("repeated question cannot contradict facts and next reply uses changed current truth", async () => {
  for (const pain of [6, 6, 4, 4]) {
    const result = await renderFlexibleSpeech({ input: input(`Боль сейчас ${pain}/10.`), provider: provider({ ...proposal, variant: 1 }, review) });
    assert.equal(result.text, `Сейчас боль ${pain}/10.`);
  }
});
