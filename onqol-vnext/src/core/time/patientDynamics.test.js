import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../session/createSession.js";
import { submitLearnerTurn } from "../session/submitLearnerTurn.js";
import { withShared } from "../content/loadBundle.js";
import { evaluateBoundedStateTransition } from "./boundedStateTransitions.js";
import { createRng } from "../rng.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const baseBundle = withShared(diseaseBundle, sharedBundle);
const cloneBundle = () => structuredClone(baseBundle);
function make(bundle, seed = "dynamics") {
  return createSession({ sessionId: seed, seed, mode: "reference", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle, locale: "ru", startIso: "2026-08-30T08:00:00.000Z" });
}
function say(session, text) { return submitLearnerTurn({ session, text }); }

test("approved bounded natural-course content changes state and emits traceable deterioration", () => {
  const bundle = cloneBundle();
  const trajectory = bundle.trajectories.trajectories["TRJ-STABLE"];
  trajectory.provenance.review_status = "approved_for_training";
  trajectory.provenance.reviewed_by = "test-fixture";
  trajectory.natural_course_model = {
    kind: "bounded_state_transitions", initial_state_id: "initial",
    transitions: [{ id: "worse-1", from: "initial", to: "worse", eligible_after_minutes: 30, probability: 1,
      effects: { physiology: { heartRate: { delta: 5 } }, truth: { marker: { set: "reviewed-transition" } } },
      deterioration: { cause_id: "worse-1", text_ru: "fixture" }, rule_ids: ["RULE-FIXTURE"], source_ids: ["SRC-WSES-2025"] }],
  };
  const initial = make(bundle);
  const before = initial.state.physiology.heartRate;
  const turn = say(initial, "переоценю витальные через час");
  assert.equal(turn.session.state.physiology.heartRate, before + 5);
  assert.equal(turn.session.state.truth.marker, "reviewed-transition");
  assert.ok(turn.session.events.some((event) => event.type === "DETERIORATION_DETECTED" && event.cause.ruleIds.includes("RULE-FIXTURE")));
});

test("pending natural course remains inert and never fabricates deterioration", () => {
  const pendingBundle = cloneBundle();
  pendingBundle.trajectories.trajectories["TRJ-STABLE"].provenance.review_status = "pending";
  const initial = make(pendingBundle, "pending-course");
  const before = structuredClone(initial.state.physiology);
  const turn = say(initial, "переоценю витальные через час");
  assert.deepEqual(turn.session.state.physiology, before);
  assert.equal(turn.session.events.some((event) => event.type === "DETERIORATION_DETECTED"), false);
  assert.ok(turn.session.events.some((event) => event.type === "SIMULATOR_LIMITATION_NOTED"));
});

test("approved per-drug response envelope is deterministic and pending envelope is inert", () => {
  const approved = cloneBundle();
  const effect = approved.trajectories.treatment_effects.analgesia_ketoprofen_im;
  effect.provenance.review_status = "approved_for_training";
  effect.provenance.reviewed_by = "test-fixture";
  effect.response_envelope = { onset_minutes: 10, pain_score_delta_range: [-2, -1] };
  let a = make(approved, "effect-same");
  let b = make(approved, "effect-same");
  a = say(say(a, "кетопрофен 100 мг в/м").session, "переоценю боль через 10 минут").session;
  b = say(say(b, "кетопрофен 100 мг в/м").session, "переоценю боль через 10 минут").session;
  const eventA = a.events.find((event) => event.type === "TREATMENT_EFFECT_APPLIED");
  const eventB = b.events.find((event) => event.type === "TREATMENT_EFFECT_APPLIED");
  assert.ok(eventA);
  assert.deepEqual(eventA, eventB);

  let pending = make(baseBundle, "pending-effect");
  pending = say(say(pending, "кетопрофен 100 мг в/м").session, "переоценю боль через 10 минут").session;
  assert.equal(pending.events.some((event) => event.type === "TREATMENT_EFFECT_APPLIED"), false);
});

test("postoperative recovery evaluator is disease-neutral and bounded", () => {
  const model = { kind: "bounded_state_transitions", initial_state_id: "early", transitions: [
    { id: "recover", from: "early", to: "ready", eligible_after_minutes: 60, probability: 1,
      conditions: [{ path: "postop.disposition", operator: "equals", value: "recovery" }], effects: { postop: { oralIntake: { set: "liquids" } } } },
  ] };
  const state = { postop: { disposition: "recovery", oralIntake: "nil_by_mouth" } };
  const step = evaluateBoundedStateTransition({ model, state, currentStateId: null, enteredAtMinutes: 0, targetMinutes: 60, rng: createRng("recovery"), streamName: "postop" });
  assert.equal(step.to, "ready");
  assert.equal(step.effects.postop.oralIntake, "liquids");
});
