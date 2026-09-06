import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { withShared } from "../../core/content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { createPersistedSession, loadPersistedSession, savePersistedSession } from "./sessionPersistence.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const make = () => createSession({
  sessionId: "persist-test", seed: "persist-seed", mode: "reference", casePresetId: "APP-004",
  sessionPurpose: "internal_development", locale: "ru", startIso: "2026-08-30T08:00:00.000Z", bundle,
});
const memoryStorage = () => ({ value: null, getItem() { return this.value; }, setItem(_k, v) { this.value = v; }, removeItem() { this.value = null; } });

test("resume reconstructs the causal log and preserves the next deterministic outcome", () => {
  let uninterrupted = make();
  for (const text of ["опрошу пациента", "осмотрю живот", "ОАК", "переоценю боль и витальные через час"]) {
    uninterrupted = submitLearnerTurn({ session: uninterrupted, text }).session;
  }
  const storage = memoryStorage();
  savePersistedSession(storage, createPersistedSession({ session: uninterrupted, messages: [{ role: "env", textRu: "журнал" }] }));
  const restored = loadPersistedSession(storage, bundle);
  assert.ok(restored);
  assert.deepEqual(restored.session.events, uninterrupted.events);
  const nextA = submitLearnerTurn({ session: uninterrupted, text: "что с пациентом сейчас?" }).session;
  const nextB = submitLearnerTurn({ session: restored.session, text: "что с пациентом сейчас?" }).session;
  assert.deepEqual(nextB.events, nextA.events);
  assert.deepEqual(nextB.state, nextA.state);
});

test("corrupt and incompatible artifacts fail closed", () => {
  const storage = memoryStorage();
  storage.value = "{broken";
  assert.equal(loadPersistedSession(storage, bundle), null);
  storage.value = JSON.stringify({ schemaVersion: 999 });
  assert.equal(loadPersistedSession(storage, bundle), null);
});
