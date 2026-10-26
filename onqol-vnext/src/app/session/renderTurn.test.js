import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTurnMessages } from "./renderTurn.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import { withShared } from "../../core/content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);

function shown(text, sessionPurpose = "learner_pilot") {
  const session = createSession({ sessionId: "render-turn", seed: "render-turn", mode: "reference", casePresetId: "APP-004", bundle, locale: "ru", startIso: "2026-10-01T10:00:00+05:00", sessionPurpose });
  const learnerVisibleBefore = buildLearnerVisibleState(session.state);
  const turn = submitLearnerTurn({ session, text });
  return renderTurnMessages({ turn, bundle, learnerVisibleBefore, interpreted: turn.interpreted }).filter(Boolean);
}

test("a question nothing answers still gets a visible reply, and it executes nothing", () => {
  const messages = shown("почему нельзя оперировать?");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, "system_notice", "a simulator notice, never a fact for the mentor");
  assert.match(messages[0].textRu, /действий не выполнено/i);
});

test("an executed action is never followed by the empty-turn notice", () => {
  const messages = shown("ОАК");
  assert.ok(messages.length >= 1);
  assert.equal(messages.some((m) => /Ответа на эту реплику/.test(m.textRu)), false);
});

test("a stated hypothesis alone is acknowledged as recorded reasoning", () => {
  const messages = shown("думаю, это острый аппендицит");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].textRu, "Рассуждение записано. Действий не выполнено.");
});

test("a quiet wait reports the elapsed time, not «nothing was done»", () => {
  const messages = shown("подожду 30 минут");
  assert.equal(messages.length, 1);
  assert.equal(messages[0].textRu, "Прошло 30 мин. Новых событий нет.");
});

test("ending the case gets no empty-turn notice (the debrief follows)", () => {
  const messages = shown("конец кейса");
  assert.equal(messages.some((m) => /действий не выполнено|Новых событий нет/.test(m.textRu)), false);
});
