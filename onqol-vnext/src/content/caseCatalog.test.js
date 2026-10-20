import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, DEFAULT_CASE_ID, caseEntry, resolveCaseId } from "./caseCatalog.js";
import { createSession } from "../core/session/createSession.js";
import { submitLearnerTurn } from "../core/session/submitLearnerTurn.js";
import { caseStorageKey, createPersistedSession, loadPersistedSession, savePersistedSession, SESSION_STORAGE_KEY } from "../app/session/sessionPersistence.js";

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

function start(caseId, mode = "reference") {
  const entry = caseEntry(caseId);
  return createSession({
    sessionId: `catalog-${caseId}`,
    seed: "catalog-seed",
    mode,
    realProfileId: mode === "real" ? "KZ-R2-URBAN" : undefined,
    casePresetId: entry.casePresetId,
    sessionPurpose: "internal_development",
    interactionFlags: { ...entry.interactionFlags },
    bundle: entry.bundle,
    locale: "ru",
    startIso: "2026-09-25T02:10:00+05:00",
  });
}

test("no ?case= or an unknown case starts the default unknown-patient game", () => {
  assert.equal(resolveCaseId(""), DEFAULT_CASE_ID);
  assert.equal(resolveCaseId("?seed=x"), DEFAULT_CASE_ID);
  assert.equal(resolveCaseId("?case=NOPE"), DEFAULT_CASE_ID);
  assert.equal(resolveCaseId("?case=__proto__"), DEFAULT_CASE_ID);
});

test("?case=FLUIDS-01 opens the second case internally, and a pilot build refuses it", () => {
  assert.equal(resolveCaseId("?case=FLUIDS-01"), "FLUIDS-01");
  assert.equal(resolveCaseId("?case=fluids-01"), "FLUIDS-01");
  assert.equal(resolveCaseId("?case=FLUIDS-01", { pilot: true }), DEFAULT_CASE_ID);
  assert.equal(resolveCaseId("?case=APP-004", { pilot: true }), "APP-004");
});

test("every catalog case starts in both hospital modes with its own bundle", () => {
  for (const caseId of Object.keys(CASES)) {
    for (const mode of ["reference", "real"]) {
      const session = start(caseId, mode);
      assert.equal(session.events.find((e) => e.type === "SESSION_STARTED").payload.casePresetId, caseId);
      assert.ok(session.events.some((e) => e.type === "PATIENT_ARRIVED"));
    }
  }
  assert.notEqual(caseEntry("FLUIDS-01").bundle.disease.disease_id, caseEntry("APP-004").bundle.disease.disease_id);
});

test("APP-004 keeps the original storage key so earlier saves remain resumable; cases never share a key", () => {
  assert.equal(caseStorageKey(DEFAULT_CASE_ID, DEFAULT_CASE_ID), SESSION_STORAGE_KEY);
  const keys = Object.keys(CASES).map((id) => caseStorageKey(id, DEFAULT_CASE_ID));
  assert.equal(new Set(keys).size, keys.length);
});

test("a FLUIDS-01 session persists under its own key and restores with its own bundle", () => {
  const storage = memoryStorage();
  const entry = { ...caseEntry("FLUIDS-01"), storageKey: caseStorageKey("FLUIDS-01", DEFAULT_CASE_ID) };
  let session = start("FLUIDS-01");
  session = submitLearnerTurn({ session, text: "Измерьте давление и пульс" }).session;
  assert.ok(savePersistedSession(storage, createPersistedSession({ session, messages: [] }), entry.storageKey));
  assert.equal(loadPersistedSession(storage, caseEntry("APP-004").bundle, SESSION_STORAGE_KEY), null);
  assert.equal(loadPersistedSession(storage, caseEntry("APP-004").bundle, entry.storageKey), null, "wrong bundle never restores");
  const restored = loadPersistedSession(storage, entry.bundle, entry.storageKey);
  assert.ok(restored);
  assert.deepEqual(restored.session.events, session.events);
});

test("FLUIDS-01 starts at the hour its handoff names; APP-004 keeps the seeded start", () => {
  const fluids = caseEntry("FLUIDS-01");
  assert.ok(fluids.bundle && fluids.fixedStartIso.includes("T02:10"));
  const handoff = start("FLUIDS-01").events.find((e) => e.type === "PATIENT_ARRIVED").payload.handoffRu;
  assert.match(handoff, /02:10/);
  assert.equal(caseEntry("APP-004").fixedStartIso, null);
  assert.ok(!/аппендицит|гиповолем|перегруз/i.test(fluids.presentationRu), "the case bar never names a diagnosis");
});
