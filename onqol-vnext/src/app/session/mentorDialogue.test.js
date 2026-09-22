import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDialogueContext, requestMentorDialogue } from "./mentorDialogue.js";
import { createSession } from "../../core/session/createSession.js";
import { withShared } from "../../core/content/loadBundle.js";
import disease from "../../content/generated/appendicitis.json" with { type: "json" };
import shared from "../../content/generated/shared.json" with { type: "json" };
import { createPersistedSession, loadPersistedSession } from "./sessionPersistence.js";
import { exportSession } from "../../core/replay/exportSession.js";
const bundle = withShared(disease, shared);
const make = () => createSession({ sessionId: "mentor-test", seed: "mentor-seed", mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", locale: "ru", startIso: "2026-09-21T08:00:00Z", bundle });
test("only displayed environment text is fact evidence; hidden truth never crosses boundary", () => {
  const session = make(); session.state.truth.secret = "HIDDEN_CANARY";
  const messages = [{ id: "f1", role: "env", textRu: "Результаты ожидаются." }, { id: "l1", role: "learner", textRu: "Я думаю о диагнозе." }, { id: "m1", role: "mentor", textRu: "Гипотеза требует обоснования." }];
  const before = JSON.stringify(session);
  const context = buildDialogueContext({ session, messages, text: "Объясни" });
  assert.deepEqual(context.facts, [{ id: "f1", text: "Результаты ожидаются." }]);
  assert.equal(JSON.stringify(context).includes("HIDDEN_CANARY"), false);
  assert.equal(JSON.stringify(session), before);
});
test("discussion survives save/resume/export without changing events, clock or state", () => {
  const session = make(); const before = structuredClone({ state: session.state, events: session.events });
  session.mentorDialogue = [{ status: "accepted", textShown: "Ответ", question: { text: "Почему?", expects: "reasoning" }, calls: [{ raw: "raw evidence" }] }];
  const messages = [{ id: "m1", role: "mentor", textRu: "Ответ" }];
  const saved = createPersistedSession({ session, messages });
  const restored = loadPersistedSession({ getItem: () => JSON.stringify(saved) }, bundle);
  assert.ok(restored);
  assert.deepEqual(restored.session.mentorDialogue, session.mentorDialogue);
  assert.deepEqual(restored.session.events, before.events);
  assert.deepEqual(restored.session.state, before.state);
  assert.deepEqual(exportSession({ session: restored.session }).mentor_dialogue, session.mentorDialogue);
});
test("network outage preserves discussion context for audit", async () => {
  const r = await requestMentorDialogue({ session: make(), messages: [], text: "Вопрос", fetchImpl: async () => { throw new Error("offline"); } });
  assert.equal(r.audit.status, "fallback"); assert.equal(r.audit.context.text, "Вопрос");
});
