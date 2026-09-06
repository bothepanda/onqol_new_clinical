import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../session/createSession.js";
import { applyCommand, applyTimeAdvance } from "../session/applyTurn.js";
import { createCommand } from "../commands/commandTypes.js";
import { reduceEvents } from "./worldState.js";
import bundle from "../../content/generated/appendicitis.json" with { type: "json" };

function freshSession() {
  return createSession({
    sessionId: "replay-test",
    seed: "replay-seed",
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: "2026-08-23T02:15:00+05:00",
  });
}

// Core Runtime Spec §67-§68: current state must be reconstructible from
// the initial seed plus event history alone.
test("replaying the full event log from scratch reproduces the live state exactly", () => {
  let session = freshSession();
  session = applyCommand({ session, command: createCommand({ id: "c1", type: "EXAMINE", params: { region: "abdomen" } }) }).session;
  session = applyCommand({ session, command: createCommand({ id: "c2", type: "ORDER_TEST", params: { testId: "cbc" } }) }).session;
  session = applyTimeAdvance({ session, targetMinutes: 90, cause: { actor: "learner" } }).session;
  session = applyCommand({
    session,
    command: createCommand({ id: "c3", type: "ORDER_MEDICATION", params: { drugId: "ketorolac", dose: "30mg", route: "iv" } }),
  }).session;

  const fresh = freshSession();
  const rebuilt = reduceEvents(fresh.state, session.events.slice(fresh.events.length));
  assert.deepEqual(rebuilt, session.state);
});

test("no path_state field exists anywhere on world state; workflow.label is derived and non-authoritative", () => {
  const { state } = freshSession();
  assert.equal(state.path_state, undefined);
  assert.equal(state.phase, undefined);
  assert.ok(typeof state.workflow.label === "string");
});

test("a repeat examination is not suppressed as a duplicate of an earlier one", () => {
  let session = freshSession();
  session = applyCommand({ session, command: createCommand({ id: "c1", type: "EXAMINE", params: { region: "abdomen" } }) }).session;
  session = applyCommand({ session, command: createCommand({ id: "c2", type: "EXAMINE", params: { region: "abdomen" } }) }).session;
  assert.equal(session.state.observations.examinations.length, 2);
});

test("committing an operative plan does not by itself make the patient preop-ready", () => {
  let session = freshSession();
  session = applyCommand({
    session,
    command: createCommand({ id: "c1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  assert.equal(session.state.managementPlan.intent, "operative");
  assert.equal(session.state.preop.ready, false);
});
