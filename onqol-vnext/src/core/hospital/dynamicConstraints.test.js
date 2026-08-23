import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../session/createSession.js";
import { submitLearnerTurn } from "../session/submitLearnerTurn.js";
import { buildLearnerVisibleState } from "../state/learnerView.js";
import { rollDynamicConstraints } from "./dynamicConstraints.js";
import { createRng } from "../rng.js";
import { withShared } from "../content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);

function newSession({ mode = "real", realProfileId = "KZ-R2-URBAN", seed = "constraint-seed" } = {}) {
  return createSession({
    sessionId: "constraints",
    seed,
    mode,
    realProfileId,
    casePresetId: "APP-004",
    bundle,
    locale: "ru",
    startIso: "2026-08-23T02:15:00+05:00",
  });
}

test("Reference mode never draws a dynamic resource constraint", () => {
  for (const seed of ["a", "b", "c", "d", "e", "f"]) {
    assert.deepEqual(rollDynamicConstraints({ mode: "reference", rng: createRng(seed) }), []);
  }
});

test("dynamic constraints are seeded: the same seed reproduces the same hospital problem", () => {
  const first = rollDynamicConstraints({ mode: "real", rng: createRng("same-seed") });
  const second = rollDynamicConstraints({ mode: "real", rng: createRng("same-seed") });
  assert.deepEqual(first, second);
});

test("across seeds, Real mode produces both constrained and unconstrained sessions", () => {
  const draws = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map(
    (seed) => rollDynamicConstraints({ mode: "real", rng: createRng(seed) }).length,
  );
  assert.ok(draws.some((count) => count === 1), "some sessions must have a constraint");
  assert.ok(draws.some((count) => count === 0), "not every session should be broken");
});

test("a constraint is hidden until the learner runs into it, then becomes visible", () => {
  // KZ-R1-DISTRICT has no CT at all - a static profile limitation, which
  // behaves the same way: not announced up front, disclosed on contact.
  const session = newSession({ realProfileId: "KZ-R1-DISTRICT" });
  assert.deepEqual(buildLearnerVisibleState(session.state).revealedConstraints, []);

  const turn = submitLearnerTurn({ session, text: "КТ ОБП" });
  assert.deepEqual(
    turn.outcomes.map((result) => result.outcome),
    ["UNAVAILABLE_RESOURCE"],
  );
  const visible = buildLearnerVisibleState(turn.session.state);
  assert.equal(visible.revealedConstraints.length, 1);
  assert.equal(visible.revealedConstraints[0].capabilityKey, "ct");
});

test("an unavailable resource is never reported as unsupported simulator content", () => {
  const session = newSession({ realProfileId: "KZ-R1-DISTRICT" });
  const turn = submitLearnerTurn({ session, text: "КТ ОБП" });
  assert.equal(
    turn.outcomes.some((result) => result.outcome === "UNSUPPORTED_CONTENT"),
    false,
  );
});

test("the learner view exposes disclosed constraints only, never the full active set", () => {
  const session = newSession({ seed: "hidden-constraint" });
  const visible = buildLearnerVisibleState(session.state);
  assert.deepEqual(visible.revealedConstraints, []);
  assert.equal("dynamicConstraints" in visible, false);
  assert.equal(JSON.stringify(visible).includes("dynamicConstraints"), false);
});
