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
    sessionPurpose: "internal_development",
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

// ---- Resolution (KNOWN_GAPS §7): constraints end during a case ----------

function seedFor(constraintId) {
  for (let i = 0; i < 500; i += 1) {
    const rolled = rollDynamicConstraints({ mode: "real", rng: createRng(`resolve-${i}`) });
    if (rolled[0]?.id === constraintId) return `resolve-${i}`;
  }
  throw new Error(`no seed rolls ${constraintId}`);
}

test("a resolvable constraint gets a seeded end time inside its authored window; CT repair and the delayed surgeon have none", () => {
  for (let i = 0; i < 200; i += 1) {
    const [rolled] = rollDynamicConstraints({ mode: "real", rng: createRng(`window-${i}`) });
    if (!rolled) continue;
    if (rolled.resolvesAfterMinutes) {
      assert.ok(rolled.resolvesAtMinutes >= rolled.resolvesAfterMinutes[0] && rolled.resolvesAtMinutes <= rolled.resolvesAfterMinutes[1]);
    } else {
      assert.equal(rolled.resolvesAtMinutes, null);
      assert.ok(["ct_scanner_down", "senior_surgeon_delayed"].includes(rolled.id));
    }
  }
});

test("no ICU bed: the transfer is refused and disclosed, the bed frees at its seeded minute, then the transfer succeeds", () => {
  let session = newSession({ seed: seedFor("icu_no_bed") });
  const resolvesAt = session.state.hospital.dynamicConstraints[0].resolvesAtMinutes;
  let turn = submitLearnerTurn({ session, text: "перевожу в ОРИТ" });
  assert.equal(turn.outcomes[0].outcome, "UNAVAILABLE_RESOURCE");
  session = turn.session;
  assert.deepEqual(buildLearnerVisibleState(session.state).revealedConstraints.map((c) => c.id), ["icu_no_bed"]);
  session = submitLearnerTurn({ session, text: "жду 6 часов" }).session;
  const resolved = session.events.find((e) => e.type === "RESOURCE_BECAME_AVAILABLE");
  assert.equal(resolved.atMinutes, resolvesAt);
  assert.equal(resolved.payload.constraintId, "icu_no_bed");
  assert.deepEqual(buildLearnerVisibleState(session.state).revealedConstraints, []);
  assert.equal(session.state.hospital.capabilities.icuBed.available, true);
  turn = submitLearnerTurn({ session, text: "перевожу в ОРИТ" });
  assert.equal(turn.outcomes[0].outcome, "EXECUTED");
});

test("an operating room occupied by another patient blocks the operation until it frees", () => {
  const session = newSession({ seed: seedFor("or_occupied") });
  assert.equal(session.state.hospital.capabilities.operatingRoom.available, false);
  const resolvesAt = session.state.hospital.dynamicConstraints[0].resolvesAtMinutes;
  const later = submitLearnerTurn({ session, text: "жду 3 часа" }).session;
  assert.ok(later.state.clock.elapsedMinutes >= resolvesAt);
  assert.equal(later.state.hospital.capabilities.operatingRoom.available, true);
  assert.equal(later.state.hospital.capabilities.operatingRoom.etaMinutes, 50, "back to the profile baseline");
});

test("a constraint the learner never met ends silently, so its existence is not disclosed", async () => {
  const { renderEvent } = await import("../../ai/renderer/renderEvent.js");
  const session = submitLearnerTurn({ session: newSession({ seed: seedFor("icu_no_bed") }), text: "жду 6 часов" }).session;
  const resolved = session.events.find((e) => e.type === "RESOURCE_BECAME_AVAILABLE");
  assert.ok(resolved);
  assert.equal(renderEvent({ event: resolved, bundle, patient: session.patient, state: session.state }), null);
});

test("Russian hour agreement in content templates", async () => {
  const { agreeHours } = await import("../../ai/renderer/renderEvent.js");
  assert.equal(agreeHours("воды — 1 часов назад, еды — 22 часов, 12 часов, 5 часов"), "воды — 1 час назад, еды — 22 часа, 12 часов, 5 часов");
});
