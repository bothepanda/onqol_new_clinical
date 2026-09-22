import { test } from "node:test";
import assert from "node:assert/strict";
import library from "../../content/mentor/app004-library.json" with { type: "json" };
import { runGroundedDialogue, FALLBACK, DIALOGUE_VERSION } from "./groundedDialogue.js";

const context = { ...library.scope, text: "Почему меняется место боли?", history: [], facts: [], historyTruncated: false };
const good = () => ({ mode: "TEACH", sentences: [{ kind: "clinical", text: "Миграцию боли можно объяснить вовлечением париетальной брюшины.", cardIds: ["K01"], factIds: [] }], question: null });
const verdict = () => ({ supported: true, patientGrounded: true, noNewManagement: true, noHiddenDiagnosis: true, appropriateQuestion: true, allSentencesClassified: true, noFalseAttribution: true, reasons: [] });
function mock(outputs) {
  const requests = [];
  return { requests, complete: async (r) => { requests.push(r); const value = outputs.shift(); if (value instanceof Error) throw value; return { text: typeof value === "string" ? value : JSON.stringify(value), meta: { model: "test", costUsd: 0 } }; } };
}
test("approved explanation gets two passes, provenance and raw responses", async () => {
  const provider = mock([good(), verdict()]);
  const result = await runGroundedDialogue({ context, library, provider });
  assert.equal(result.audit.status, "accepted");
  assert.deepEqual(result.audit.cardIds, ["K01"]);
  assert.deepEqual(result.audit.sourceIds, ["CAM14", "DV3"]);
  assert.equal(result.audit.calls.length, 2);
  assert.equal(result.audit.sources.length, 2);
  assert.equal(provider.requests[1].responseFormat.json_schema.name, "mentor_verification");
  assert.equal(result.audit.version, DIALOGUE_VERSION);
  const policy = provider.requests[0].messages[0].content;
  assert.match(policy, /старший хирург рядом с резидентом/);
  assert.match(policy, /Короткий ответ трактуй в контексте последнего вопроса/);
  assert.match(policy, /прекрати перефразировать тот же вопрос/);
});
test("draft and wrong-scope libraries do not call provider", async () => {
  for (const changes of [{ sessionPurpose: "learner_pilot" }, { casePresetId: "OTHER" }, { locale: "kk" }]) {
    const provider = mock([]);
    const result = await runGroundedDialogue({ context: { ...context, ...changes }, library, provider });
    assert.equal(result.audit.errorCode, "scope_not_approved"); assert.equal(provider.requests.length, 0);
  }
  const copy = structuredClone(library); copy.cards[0].review_status = "draft";
  const provider = mock([]);
  assert.equal((await runGroundedDialogue({ context, library: copy, provider })).audit.errorCode, "unapproved_library");
  assert.equal(provider.requests.length, 0);
});
test("source IDs alone cannot authorize unsupported claims", async () => {
  const draft = good(); draft.sentences[0].text = "Операция обязательна немедленно.";
  const provider = mock([draft, { ...verdict(), supported: false, noNewManagement: false, reasons: ["unsupported_management"] }]);
  const result = await runGroundedDialogue({ context, library, provider });
  assert.equal(result.text, FALLBACK); assert.equal(result.audit.errorCode, "grounding_rejected");
  assert.ok(result.audit.calls[0].raw.includes("немедленно")); assert.equal(result.audit.output, null);
});
test("numeric dosing, invented references, hidden facts and pedagogical-only clinical support fail", async () => {
  for (const mutate of [
    (d) => { d.sentences[0].text = "Введите 2 г."; },
    (d) => { d.sentences[0].cardIds = ["K09"]; },
    (d) => { d.sentences[0].cardIds = ["K12"]; },
    (d) => { d.sentences[0].kind = "patient_fact"; d.sentences[0].factIds = ["hidden-result"]; },
    (d) => { d.commands = ["ORDER_MEDICATION"]; },
  ]) {
    const draft = good(); mutate(draft); const provider = mock([draft]);
    const result = await runGroundedDialogue({ context, library, provider });
    assert.equal(result.audit.errorCode, "candidate_rejected"); assert.equal(provider.requests.length, 1);
  }
});
test("clinical claims disguised as conversation and diagnostic leakage require verifier rejection", async () => {
  const d = good(); d.sentences[0] = { kind: "conversation", text: "У пациента уже установлен диагноз.", cardIds: [], factIds: [] };
  const result = await runGroundedDialogue({ context, library, provider: mock([d, { ...verdict(), noHiddenDiagnosis: false, allSentencesClassified: false, reasons: ["hidden_diagnosis"] }]) });
  assert.equal(result.audit.errorCode, "grounding_rejected");
});
test("duplicate question is not shown; one question retains expected-answer contract", async () => {
  const d = { mode: "CLARIFY", sentences: [], question: { text: "Что в уже полученных данных больше всего поддерживает твоё заключение?", expects: "синтез данных" } };
  const result = await runGroundedDialogue({ context, library, provider: mock([d, verdict()]) });
  assert.deepEqual(result.question, d.question);
  const next = { ...context, history: [{ role: "mentor", text: result.text }] };
  assert.equal((await runGroundedDialogue({ context: next, library, provider: mock([d]) })).audit.errorCode, "candidate_rejected");
});
test("a question misplaced in sentences is removed before verification instead of showing the generic fallback", async () => {
  const d = {
    mode: "CLARIFY",
    sentences: [
      { kind: "conversation", text: "Какую неопределённость вы хотите уменьшить?", cardIds: [], factIds: [] },
      { kind: "conversation", text: "Цель — исключить альтернативную причину.", cardIds: [], factIds: [] },
    ],
    question: { text: "Какую альтернативную гипотезу вы хотите проверить первой?", expects: "одна альтернативная гипотеза" },
  };
  const provider = mock([d, verdict()]);
  const result = await runGroundedDialogue({ context: { ...context, text: "исключить другое" }, library, provider });
  assert.equal(result.audit.status, "accepted");
  assert.deepEqual(result.audit.repairs, ["removed_sentence_questions"]);
  assert.equal((result.text.match(/\?/g) ?? []).length, 1);
  assert.doesNotMatch(result.text, /Не удалось проверить/);
  const verifierInput = JSON.parse(provider.requests[1].messages[1].content);
  assert.equal(verifierInput.candidate.sentences.length, 1);
});
test("provider, malformed JSON, verifier error and timeout retain typed fallback", async () => {
  for (const outputs of [[new Error("offline")], ["not json"], [good(), new Error("offline")]]) {
    const r = await runGroundedDialogue({ context, library, provider: mock(outputs) });
    assert.equal(r.text, FALLBACK); assert.equal(r.audit.status, "fallback");
  }
  const r = await runGroundedDialogue({ context, library, provider: { complete: () => new Promise(() => {}) }, timeoutMs: 5 });
  assert.equal(r.audit.errorCode, "provider_timeout");
});
