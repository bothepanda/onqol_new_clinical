// All v2 numbers below are SYNTHETIC TEST FIXTURES, never production clinical content.
import test from "node:test";
import assert from "node:assert/strict";
import { scheduleGovernedTreatmentEffect, materializeTreatmentSpecs, validEnvelope } from "./treatmentCalibration.js";
import { createRng } from "../rng.js";
import { advanceTime } from "../time/advanceTime.js";
import { createSession } from "../session/createSession.js";
import { submitLearnerTurn } from "../session/submitLearnerTurn.js";
import { reduceEvents } from "../state/worldState.js";
import { withShared } from "../content/loadBundle.js";
import { createPersistedSession, loadPersistedSession, savePersistedSession } from "../../app/session/sessionPersistence.js";
import { FLEXIBLE_STORAGE_KEY } from "../../app/session/flexibleSessionStorage.js";
import disease from "../../content/generated/appendicitis.json" with { type: "json" };
import shared from "../../content/generated/shared.json" with { type: "json" };
const baseBundle = withShared(disease, shared);
const make = (bundle = baseBundle, seed = "v2") => createSession({ sessionId: `fixture-${seed}`, seed, mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", locale: "ru", startIso: "2026-09-25T00:00:00Z", bundle });
const say = (s, text) => submitLearnerTurn({ session: s, text }).session;
const spec = (field, delta_range, constraints, units = "fixture-unit") => ({ domain: "physiology", field, delta_range, constraints, units, distribution: "uniform", decimals: 1 });
const fixture = (status = "approved_for_training", stacking = "additive") => ({
  applies_to: ["fixture_drug"], applies_to_routes: ["iv"], version: "synthetic-v2", source_ids: ["SYNTHETIC-NOT-CLINICAL"],
  provenance: { id: "FIXTURE-EFFECT", review_status: status, reviewed_by: "TEST ONLY" },
  response_envelope: { schema_version: 2, onset_minutes: 10, interaction: { stacking, window_minutes: 20 },
    effects: [spec("systolicBp", [5, 18], { max: 109, cannot_cross: [110, 140] }), spec("heartRate", [-15, -3], { min: 105 })],
    dependencies: [{ path: "physiology.systolicBp", operator: "lte", value: 109 }, { path: "physiology.heartRate", operator: "gte", value: 105 }] },
});
function arrange(status, stacking) {
  const bundle = structuredClone(baseBundle); bundle.trajectories.treatment_effects = { fixture: fixture(status, stacking) };
  const session = make(bundle); session.state = { ...session.state, physiology: { ...session.state.physiology, systolicBp: 92, heartRate: 120 } };
  return { bundle, session };
}
function schedule(bundle, session, seed = "v2", id = "c1") { return scheduleGovernedTreatmentEffect({ bundle, state: session.state, command: { id }, matchKey: "drugId", matchValue: "fixture_drug", route: "iv", rng: createRng(seed) }); }
function drain(session, bundle, pending, targetMinutes) {
  const state = { ...session.state, pending };
  const result = advanceTime({ state, clockRoot: session.clockRoot, bundle, rng: createRng("v2"), targetMinutes, cause: { actor: "learner", source: "fixture_wait" } });
  return { events: result.events, state: reduceEvents(state, result.events) };
}
for (const status of ["draft", "reviewed", "pending", "deprecated"]) test(`${status} calibration is inert for new actions`, () => {
  const { bundle, session } = arrange(status); assert.deepEqual(schedule(bundle, session), []);
});
test("approved effect applied by engine only at simulated onset with causal before/after", () => {
  const { bundle, session } = arrange(); const pending = schedule(bundle, session);
  assert.equal(drain(session, bundle, pending, 9).events.some((x) => x.type === "TREATMENT_EFFECT_APPLIED"), false);
  const result = drain(session, bundle, pending, 10), event = result.events.find((x) => x.type === "TREATMENT_EFFECT_APPLIED");
  assert.ok(event); assert.equal(event.cause.commandId, "c1"); assert.equal(event.atMinutes, 10);
  assert.equal(event.payload.calibration.id, "FIXTURE-EFFECT"); assert.equal(event.payload.calibration.version, "synthetic-v2");
  assert.equal(event.payload.calibration.before.physiology.systolicBp, 92);
  assert.equal(event.payload.calibration.after.physiology.systolicBp, result.state.physiology.systolicBp);
  assert.equal(event.payload.calibration.draws.length, 2);
});
test("100 seeds: all effects remain bounded, cannot normalize, reproduce full events and vary", () => {
  const values = new Set();
  for (let n = 0; n < 100; n++) {
    const { bundle, session } = arrange(); const a = schedule(bundle, session, `seed-${n}`), b = schedule(bundle, session, `seed-${n}`);
    assert.deepEqual(a, b);
    const first = drain(session, bundle, a, 10), again = drain(session, bundle, b, 10);
    assert.deepEqual(first, again);
    const { systolicBp, heartRate } = first.state.physiology;
    assert.ok(systolicBp >= 97 && systolicBp <= 109); assert.ok(heartRate >= 105 && heartRate <= 117);
    values.add(`${systolicBp}/${heartRate}`);
  }
  assert.ok(values.size > 10);
});
test("forbidden normalization and impossible combinations reject atomic effect", () => {
  const { bundle, session } = arrange(); const [item] = schedule(bundle, session);
  item.specs[0].constraints = { cannot_cross: [95, 140] };
  assert.equal(materializeTreatmentSpecs(item, session.state), null);
  const result = drain(session, bundle, [item], 10);
  assert.deepEqual(result.state.physiology, session.state.physiology);
  assert.equal(result.events.find((e) => e.type === "SIMULATOR_LIMITATION_NOTED").payload.reason, "constraint_rejected");
});
test("once and no-overlap reject repeats while additive allows reviewed repeats", () => {
  for (const policy of ["once", "no_overlap", "additive"]) {
    const { bundle, session } = arrange(undefined, policy); const pending = schedule(bundle, session);
    const whilePending = schedule(bundle, { ...session, state: { ...session.state, pending } }, "v2", "c2");
    assert.equal(whilePending.length, policy === "additive" ? 1 : 0);
    const after = drain(session, bundle, pending, 10);
    const repeated = schedule(bundle, { ...session, state: after.state }, "v2", "c3");
    assert.equal(repeated.length, policy === "additive" ? 1 : 0);
    const later = schedule(bundle, { ...session, state: { ...after.state, clock: { ...after.state.clock, elapsedMinutes: 31 } } }, "v2", "c4");
    assert.equal(later.length, policy === "once" ? 0 : 1);
  }
});
test("simultaneous competing effects fold sequentially and retain separate command causes", () => {
  const { bundle, session } = arrange();
  const a = schedule(bundle, session, "v2", "c1")[0], b = schedule(bundle, session, "v2", "c2")[0];
  a.specs = [spec("heartRate", [-3, -3], {})]; a.specs[0].delta = -3;
  b.specs = [spec("heartRate", [5, 5], {})]; b.specs[0].delta = 5;
  a.dependencies = []; b.dependencies = [];
  const result = drain(session, bundle, [a, b], 10);
  assert.equal(result.state.physiology.heartRate, 122);
  const events = result.events.filter((e) => e.type === "TREATMENT_EFFECT_APPLIED");
  assert.deepEqual(events.map((e) => e.cause.commandId), ["c1", "c2"]);
  assert.equal(events[1].payload.calibration.before.physiology.heartRate, 117);
});
test("multiple approved effects for one action are all scheduled, pending match cannot shadow approved", () => {
  const { bundle, session } = arrange(); bundle.trajectories.treatment_effects = { pending: fixture("pending"), first: fixture(), second: fixture() };
  assert.deepEqual(schedule(bundle, session).map((x) => x.effectId), ["first", "second"]);
});
test("missing onset/range/interaction calibration never invents medical defaults", () => {
  for (const mutate of [(e) => delete e.onset_minutes, (e) => { e.effects[0].delta_range = [18, 5]; }, (e) => { e.interaction.stacking = "invented"; }]) {
    const { bundle, session } = arrange(); mutate(bundle.trajectories.treatment_effects.fixture.response_envelope);
    const pending = schedule(bundle, session);
    assert.equal(pending[0].kind, "treatment_effect_unavailable");
    assert.equal(drain(session, bundle, pending, 10).events.some((x) => x.type === "TREATMENT_EFFECT_APPLIED"), false);
  }
});
test("wrong route and false applicability cannot trigger treatment response", () => {
  const { bundle, session } = arrange(); bundle.trajectories.treatment_effects.fixture.conditions = [{ path: "truth.fixtureApplicable", operator: "truthy" }];
  assert.deepEqual(schedule(bundle, session), []);
});
test("v2 distribution and units must be explicit; range cannot be malformed", () => {
  for (const change of [(e) => delete e.effects[0].units, (e) => { e.effects[0].distribution = "gaussian"; }, (e) => { e.effects[0].delta = 3; }]) {
    const e = fixture().response_envelope; change(e); assert.equal(validEnvelope(e), false);
  }
});
test("APP-004 treatment gaps do not fabricate improvement and are auditable limitations", () => {
  const start = make(); let session = say(start, "кетопрофен 100 мг в/м"); session = say(session, "переоценю боль через 30 минут");
  assert.equal(session.events.some((x) => x.type === "TREATMENT_EFFECT_APPLIED"), false);
  assert.deepEqual(session.state.physiology, start.state.physiology);
  assert.ok(session.events.some((x) => x.type === "SIMULATOR_LIMITATION_NOTED"));
});
test("approved synthetic integrated effect persists and replays, retired content remains event-replayable", () => {
  const bundle = structuredClone(baseBundle), effect = bundle.trajectories.treatment_effects.analgesia_ketoprofen_im;
  effect.provenance.review_status = "approved_for_training"; effect.provenance.reviewed_by = "TEST ONLY";
  effect.response_envelope = { onset_minutes: 10, pain_score_delta_range: [-2, -1] };
  let session = make(bundle); const initial = structuredClone(session.state), initialCount = session.events.length;
  session = say(say(session, "кетопрофен 100 мг в/м"), "переоценю боль через 10 минут");
  session.patientDialogue = [{ attempts: [{ raw: "REJECTED" }], fallbackUsed: true }];
  const store = new Map(), storage = { setItem: (k, v) => store.set(k, v), getItem: (k) => store.get(k) };
  savePersistedSession(storage, createPersistedSession({ session, messages: [] }), FLEXIBLE_STORAGE_KEY);
  const restored = loadPersistedSession(storage, bundle, FLEXIBLE_STORAGE_KEY);
  assert.ok(restored); assert.deepEqual(restored.session.state, session.state); assert.deepEqual(restored.session.patientDialogue, session.patientDialogue);
  effect.provenance.review_status = "deprecated";
  assert.deepEqual(reduceEvents(initial, session.events.slice(initialCount)), session.state);
  assert.equal(say(say(make(bundle), "кетопрофен 100 мг в/м"), "переоценю боль через 10 минут").events.some((e) => e.type === "TREATMENT_EFFECT_APPLIED"), false);
});

test("dependency between variables rejects an impossible multivariable result", () => {
  const { bundle, session } = arrange(); const [item] = schedule(bundle, session);
  item.dependencies = [{ path: "physiology.systolicBp", operator: "gte", value_path: "physiology.heartRate" }];
  item.specs[0].delta = 5; item.specs[1].delta = -3;
  assert.equal(materializeTreatmentSpecs(item, session.state), null);
});
