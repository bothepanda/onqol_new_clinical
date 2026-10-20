import test from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import { withShared } from "../../core/content/loadBundle.js";
import { renderTurnMessages } from "./renderTurn.js";
import { renderPatientDialogue } from "./renderPatientDialogue.js";
import { createPersistedSession, loadPersistedSession, savePersistedSession } from "./sessionPersistence.js";
import disease from "../../content/generated/appendicitis.json" with { type: "json" };
import shared from "../../content/generated/shared.json" with { type: "json" };
const bundle = withShared(disease, shared);
const start = () => createSession({ sessionId: "v2-journey", seed: "full-journey", mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", clinicalContentPolicy: "approved_only", bundle, locale: "ru", startIso: "2026-09-25T09:00:00+05:00" });

test("V2 full approved-content APP-004 route: patient questions, treatment gap, surgery, recovery, status, restore", async () => {
  let session = start(), messages = [];
  assert.equal(session.state.session.patientTruthApproved, true);
  const script = ["Была рвота?", "Была рвота?", "осмотрю пациента", "живот", "опрошу пациента", "ОАК, ОАМ и БХАК",
    "кетопрофен 100 мг в/м", "500 мл физраствора за час", "переоценю боль и живот через 30 минут", "что с пациентом сейчас?", "КТ ОБП", "переоценю витальные через 2 часа",
    "думаю, это аппендицит. идём на операцию", "когда последний раз ел и пил?", "венозный доступ", "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
    "вызываю анестезиолога на осмотр", "переоценю витальные через 40 минут", "получаю согласие", "иду лапароскопически", "удалю аппендикс, аспирирую жидкость из малого таза, дренаж не ставлю",
    "в отделение", "vitals каждые 4 часа", "можно пить", "переоценю витальные утром", "переоценю витальные через 24 часа", "что с пациентом сейчас?", "выписываю"];
  for (const text of script) {
    const before = buildLearnerVisibleState(session.state), turn = submitLearnerTurn({ session, text });
    const clinical = structuredClone(turn.session.state), events = structuredClone(turn.session.events);
    const rendered = renderTurnMessages({ turn, bundle, learnerVisibleBefore: before });
    const speech = await renderPatientDialogue({ session: turn.session, rendered, messages, fetchImpl: async (_, options) => {
      const payload = JSON.parse(options.body);
      assert.equal(Object.hasOwn(payload, "state"), false); assert.equal(Object.hasOwn(payload, "patient"), false);
      return { ok: true, json: async () => ({ audit: { acceptedProposal: { variant: 0, opening: "none", closing: "none" }, fallbackUsed: false } }) };
    } });
    session = speech.session; messages.push({ role: "learner", textRu: text }, ...speech.messages);
    assert.deepEqual(session.state, clinical); assert.deepEqual(session.events, events);
  }
  assert.equal(session.state.operative.completed, true);
  assert.ok(session.events.some((e) => e.type === "POSTOPERATIVE_RECOVERY_UPDATED"));
  assert.equal(session.events.some((e) => e.type === "TREATMENT_EFFECT_APPLIED"), false);
  assert.equal(session.state.session.status, "complete");
  assert.ok(session.patientDialogue.every((x) => x.sessionId && x.stateVersion > 0 && Array.isArray(x.calibrationIds)));
  let value; const storage = { setItem: (_, v) => { value = v; }, getItem: () => value };
  savePersistedSession(storage, createPersistedSession({ session, messages }));
  const restored = loadPersistedSession(storage, bundle);
  assert.ok(restored); assert.deepEqual(restored.session.events, session.events); assert.deepEqual(restored.session.state, session.state);
  assert.deepEqual(restored.messages, messages);
});
test("approved-only mode refuses draft patient truth instead of starting an improvised patient", () => {
  const changed = structuredClone(bundle); changed.disease.inflammatory_profiles.moderate.provenance.review_status = "draft";
  assert.throws(() => createSession({ sessionId: "blocked", seed: "s", mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", clinicalContentPolicy: "approved_only", bundle: changed, locale: "ru", startIso: "2026-09-25T00:00:00Z" }));
});

test("historical postoperative artifacts can add audit metadata but cannot change clinical effects", () => {
  let session = start();
  for (const text of ["идём на операцию", "венозный доступ", "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в", "вызываю анестезиолога на осмотр", "переоценю витальные через 40 минут", "получаю согласие", "иду лапароскопически", "удалю аппендикс, аспирирую жидкость из малого таза", "переоценю витальные через 24 часа"]) session = submitLearnerTurn({ session, text }).session;
  const old = structuredClone(createPersistedSession({ session, messages: [] })); delete old.runtimeRevision;
  for (const event of old.expectedEvents) {
    delete event.payload.calibration;
    if (event.type === "LEARNER_TURN_RECEIVED") delete event.payload.recordedInterpretation;
  }
  let raw = JSON.stringify(old); const storage = { getItem: () => raw };
  const restored = loadPersistedSession(storage, bundle);
  assert.ok(restored); assert.deepEqual(restored.session.state, session.state);
  assert.equal(restored.session.persistenceMigration, "additive_calibration_audit");
  const recovery = old.expectedEvents.find((e) => e.type === "POSTOPERATIVE_RECOVERY_UPDATED");
  recovery.payload.symptoms.postopPainStage = "invented"; raw = JSON.stringify(old);
  assert.equal(loadPersistedSession(storage, bundle), null);
});
