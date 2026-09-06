import { test } from "node:test";
import assert from "node:assert/strict";
import { EVENT } from "../events/eventTypes.js";
import { createEvent } from "../events/eventLog.js";
import { applyEvent } from "./worldState.js";
import { activePainScore, PAIN_STATE } from "./painState.js";
import { createSession } from "../session/createSession.js";
import { applyCommand, applyTimeAdvance } from "../session/applyTurn.js";
import { createCommand } from "../commands/commandTypes.js";
import { withShared } from "../content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

/**
 * PAIN PROVENANCE (remediation task §2, §23.1-3, §23.38).
 *
 * The clinical review asked how pain could have moved from 4.3 to 7.6 in the
 * manual smoke session while both the disease trajectory and the analgesia
 * effect were governance-blocked - and required that any hidden producer be
 * treated as a P0 release blocker.
 *
 * The causal trace is written up in
 * docs/review/APP004_PAIN_CAUSAL_TRACE_2026-08-25.md. Short version: there was
 * no hidden producer and no such transition. The recorded replay carries
 * painScore 7.6 at every one of its six vitals snapshots, from minute 0 to
 * minute 730; "4.3" appears nowhere in it. The smoke NOTE was wrong, not the
 * runtime. Two genuine defects were found while proving that, and both are
 * fixed and pinned here:
 *
 *   - the reducer ignored `DISEASE_PROGRESSED.payload.symptoms` while
 *     `advanceTime` was emitting it, so the event log recorded a pain value
 *     that never reached state;
 *   - `TIME_ADVANCED` applied `payload.physiology` and `payload.symptoms`, an
 *     ungoverned write path into patient truth that nothing produced but
 *     anything could have.
 *
 * These tests exist so the answer stays true, rather than being re-derived by
 * hand the next time somebody asks.
 */

const bundle = withShared(diseaseBundle, sharedBundle);
const START_ISO = "2026-08-23T02:15:00+05:00";

function newSession(seed = "pain-provenance") {
  return createSession({
    sessionId: "pain-provenance",
    seed,
    mode: "reference",
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle,
    locale: "ru",
    startIso: START_ISO,
  });
}

// --- 1. Governance-blocked trajectory cannot change pain --------------------

test("the approved qualitative stable trajectory has no numeric pain or physiology drift", () => {
  const session = newSession();
  const before = activePainScore(session.state.symptoms);
  assert.equal(typeof before, "number");

  // Three separate advances totalling 24 hours - a single advance could hide a
  // producer that only fires on a repeat.
  let current = session;
  for (const hours of [3, 9, 12]) {
    current = applyTimeAdvance({
      session: current,
      targetMinutes: current.state.clock.elapsedMinutes + hours * 60,
      cause: { actor: "learner", source: "stated_wait" },
    }).session;
  }

  assert.equal(current.state.clock.elapsedMinutes, 24 * 60);
  assert.equal(activePainScore(current.state.symptoms), before, "pain must not drift while the trajectory is unapproved");
  assert.deepEqual(current.state.physiology, session.state.physiology, "nor may any other physiology value");
  assert.equal(
    current.state.simulatorLimitations.some((entry) => entry.kind === "trajectory"),
    false,
    "the no-transition contract must not be misreported as withheld progression",
  );
});

// --- 2. Governance-blocked treatment effect cannot change pain --------------

test("an unapproved analgesia effect leaves the drug given and the pain unchanged", () => {
  const session = newSession();
  const before = activePainScore(session.state.symptoms);

  const given = applyCommand({
    session,
    command: createCommand({
      id: "analgesia",
      type: "ORDER_MEDICATION",
      params: { drugId: "ketoprofen", dose: "100мг", doseMg: 100, route: "im" },
    }),
  }).session;
  assert.equal(given.state.treatments.administered.at(-1).drugId, "ketoprofen", "the medication IS given");

  const later = applyTimeAdvance({ session: given, targetMinutes: 240, cause: { actor: "learner" } }).session;
  assert.equal(activePainScore(later.state.symptoms), before);
  assert.equal(
    later.events.some((event) => event.type === EVENT.TREATMENT_EFFECT_APPLIED),
    false,
    "no effect may be applied from unapproved content",
  );
});

test("a per-route effect is matched by route, so no drug inherits another route's response", () => {
  // Matrix M04: the withdrawn `analgesia_iv_nsaid` applied one magnitude to
  // ketorolac and ketoprofen by any route. Every (drug, route) pair is now its
  // own content object; all of them currently carry a null response envelope.
  const effects = bundle.trajectories.treatment_effects;
  for (const [id, effect] of Object.entries(effects)) {
    if (!effect.applies_to) continue;
    assert.ok(effect.applies_to_routes?.length, `${id} must declare the route(s) it applies to`);
    assert.equal(effect.response_envelope, null, `${id} must not carry an unreviewed response envelope`);
  }
  assert.equal("analgesia_iv_nsaid" in effects, false, "the withdrawn combined NSAID effect must not return");
});

// --- 3. No hidden producer bypasses governance ------------------------------

/**
 * EXHAUSTIVE, not a grep.
 *
 * Every event type in the vocabulary is fed to the reducer carrying a payload
 * that TRIES to write patient truth. Whatever mutates is, by definition, a
 * producer. Asserting the exact set means a new event type that quietly gains
 * the ability to write pain fails this test on the day it is added - which is
 * the guarantee the review asked for.
 */
const EVENTS_ALLOWED_TO_WRITE_SYMPTOMS = [
  "DISEASE_PROGRESSED", "POSTOPERATIVE_RECOVERY_UPDATED", "TREATMENT_EFFECT_APPLIED", "SOURCE_CONTROL_COMPLETED",
];
const EVENTS_ALLOWED_TO_WRITE_PHYSIOLOGY = [
  "DISEASE_PROGRESSED",
  "POSTOPERATIVE_RECOVERY_UPDATED",
  "TREATMENT_EFFECT_APPLIED",
  "DETERIORATION_DETECTED",
  "COMPLICATION_OCCURRED",
];

test("only the allowlisted event types can write pain or physiology at all", () => {
  const session = newSession();
  const baseline = session.state;
  const symptomWriters = [];
  const physiologyWriters = [];

  for (const type of Object.values(EVENT)) {
    const probe = createEvent({
      type,
      atMinutes: baseline.clock.elapsedMinutes,
      atIso: START_ISO,
      payload: {
        symptoms: { preSourceControlPainScore: 99, postSourceControlPainScore: 99 },
        physiology: { heartRate: 999, temperatureC: 42, crp: 999 },
      },
      cause: { actor: "system", source: "provenance_probe" },
    });
    const next = applyEvent(baseline, probe);
    if (activePainScore(next.symptoms) !== activePainScore(baseline.symptoms)) symptomWriters.push(type);
    if (JSON.stringify(next.physiology) !== JSON.stringify(baseline.physiology)) physiologyWriters.push(type);
  }

  assert.deepEqual(symptomWriters.sort(), [...EVENTS_ALLOWED_TO_WRITE_SYMPTOMS].sort());
  assert.deepEqual(physiologyWriters.sort(), [...EVENTS_ALLOWED_TO_WRITE_PHYSIOLOGY].sort());
});

test("TIME_ADVANCED carries no patient truth, whatever is attached to it", () => {
  // Regression: the reducer used to apply `payload.physiology` and
  // `payload.symptoms` on a clock tick. Nothing produced such a payload, but
  // any future producer would have bypassed the governance gate entirely just
  // by attaching values to time passing.
  const session = newSession();
  const tick = createEvent({
    type: EVENT.TIME_ADVANCED,
    atMinutes: 60,
    atIso: START_ISO,
    payload: { physiology: { heartRate: 200 }, symptoms: { preSourceControlPainScore: 10 } },
    cause: { actor: "system", source: "provenance_probe" },
  });
  const next = applyEvent(session.state, tick);
  assert.deepEqual(next.physiology, session.state.physiology);
  assert.equal(activePainScore(next.symptoms), activePainScore(session.state.symptoms));
});

test("a DISEASE_PROGRESSED event's symptoms payload actually reaches state", () => {
  // The other half of the same defect: `advanceTime` emitted
  // `payload.symptoms` and the reducer dropped it, so the log claimed a pain
  // value the world never had. Fixing only the write path would have left an
  // approved trajectory unable to move pain at all.
  const session = newSession();
  const progressed = createEvent({
    type: EVENT.DISEASE_PROGRESSED,
    atMinutes: 60,
    atIso: START_ISO,
    payload: { symptoms: { preSourceControlPainScore: 6.5 }, stage: "untreated" },
    cause: { actor: "system", source: "trajectory:test" },
  });
  const next = applyEvent(session.state, progressed);
  assert.equal(activePainScore(next.symptoms), 6.5);
});

// --- 38. Pre-source-control pain becomes a distinct post-source-control state

test("source control transitions pain to a separate state rather than decrementing the old one", () => {
  // Matrix PO01 / task §18.1. The pre-source-control value is retained as
  // history; the new state has NO value. The criteria-based recovery model
  // (APP004 Numeric Calibration Review, POSTOP) is now approved_for_training
  // after the focused clock-anchor re-review (Sarina T.T., 2026-09-01), but it
  // still invents no curve: it carries no numeric pain field, and postoperative
  // pain remains a qualitative bounded state only.
  const course = bundle.trajectories.post_source_control_course;
  assert.equal(course.provenance.review_status, "approved_for_training");
  assert.deepEqual(course.postop_pain_states, ["significant", "improving", "controlled_on_oral_analgesia"]);
  const modelJson = JSON.stringify(course.model);
  assert.equal(/per_hour|delta_range|"delta"|pain_score/.test(modelJson), false, "no numeric pain/vital arithmetic in the model");

  const session = newSession();
  const painBefore = activePainScore(session.state.symptoms);
  assert.equal(session.state.symptoms.painState, PAIN_STATE.PRE_SOURCE_CONTROL);

  const controlled = applyEvent(
    session.state,
    createEvent({
      type: EVENT.SOURCE_CONTROL_COMPLETED,
      atMinutes: 120,
      atIso: START_ISO,
      payload: {},
      cause: { actor: "learner" },
    }),
  );

  assert.equal(controlled.symptoms.painState, PAIN_STATE.POST_SOURCE_CONTROL);
  assert.equal(controlled.symptoms.preSourceControlPainScore, null, "the old pain is not carried forward");
  assert.equal(controlled.symptoms.preSourceControlPainScoreAtSourceControl, painBefore, "it is retained as history");
  assert.equal(activePainScore(controlled.symptoms), null, "no post-source-control pain value is invented");
  assert.equal(controlled.symptoms.postSourceControlPainModeled, false);
});
