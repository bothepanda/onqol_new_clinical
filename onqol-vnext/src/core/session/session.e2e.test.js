import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "./createSession.js";
import { applyCommand, applyCommands, applyTimeAdvance } from "./applyTurn.js";
import { createCommand } from "../commands/commandTypes.js";
import { buildLearnerVisibleState } from "../state/learnerView.js";
import { withShared } from "../content/loadBundle.js";
import { EVENT } from "../events/eventTypes.js";
import { createEvent } from "../events/eventLog.js";
import { applyEvent } from "../state/worldState.js";
import { advanceTime } from "../time/advanceTime.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);
const START_ISO = "2026-08-23T02:15:00+05:00";

function newSession({ mode = "reference", realProfileId, seed = "e2e-seed", contentBundle = bundle } = {}) {
  return createSession({
    sessionId: "e2e",
    seed,
    mode,
    realProfileId,
    casePresetId: "APP-004",
    sessionPurpose: "internal_development",
    bundle: contentBundle,
    locale: "ru",
    startIso: START_ISO,
  });
}

/**
 * Satisfying every BLOCKING preoperative requirement through the real
 * learner-facing commands - never through a synthetic "mark item done"
 * shortcut, which no longer exists in the command vocabulary at all
 * (task brief §7.1).
 */
function completeBlockingPreop(session) {
  let current = session;
  current = applyCommand({ session: current, command: createCommand({ id: "pre-iv", type: "ESTABLISH_IV_ACCESS", params: {} }) }).session;
  current = applyCommand({
    session: current,
    // Matrix AB03: drug, dose AND route. An order missing any of the three is
    // a nurse clarification, not a completed preoperative item.
    command: createCommand({
      id: "pre-abx",
      type: "GIVE_ANTIBIOTIC_PROPHYLAXIS",
      params: { drugId: "cefazolin", dose: "2г", doseMg: 2000, route: "iv" },
    }),
  }).session;
  current = applyCommand({
    session: current,
    command: createCommand({
      id: "pre-abx-anaerobic",
      type: "GIVE_ANTIBIOTIC_PROPHYLAXIS",
      params: { drugId: "metronidazole", dose: "500мг", doseMg: 500, route: "iv" },
    }),
  }).session;
  current = applyCommand({ session: current, command: createCommand({ id: "pre-anes", type: "REQUEST_ANESTHESIA_REVIEW", params: {} }) }).session;
  // The anesthesiologist genuinely has to arrive - that preop item completes
  // on arrival, not on the request (Contract §13).
  current = applyTimeAdvance({
    session: current,
    targetMinutes: current.state.clock.elapsedMinutes + 30,
    cause: { actor: "system", source: "consultant_travel" },
  }).session;
  current = applyCommand({ session: current, command: createCommand({ id: "pre-consent", type: "OBTAIN_CONSENT", params: {} }) }).session;
  return current;
}

// --- Resource three-way distinction (Core Runtime Spec §50, behavioral
// regression #17: "Simulator limitation is not reported as learner clinical
// error") ------------------------------------------------------------------

test("recognized + available: CT in Reference Hospital resolves and schedules a result", () => {
  const session = newSession();
  const { result } = applyCommand({ session, command: createCommand({ id: "t1", type: "ORDER_TEST", params: { testId: "ct_abdomen" } }) });
  assert.equal(result.outcome, "EXECUTED");
});

test("recognized + unavailable in this hospital: CT in KZ-R1-DISTRICT is UNAVAILABLE_RESOURCE, not UNSUPPORTED_CONTENT", () => {
  const session = newSession({ mode: "real", realProfileId: "KZ-R1-DISTRICT" });
  const { result } = applyCommand({ session, command: createCommand({ id: "t1", type: "ORDER_TEST", params: { testId: "ct_abdomen" } }) });
  assert.equal(result.outcome, "UNAVAILABLE_RESOURCE");
});

test("not supported by current content: an unrecognized drug is UNSUPPORTED_CONTENT, never phrased as a stock-out", () => {
  const session = newSession();
  const { result } = applyCommand({
    session,
    command: createCommand({ id: "m1", type: "ORDER_MEDICATION", params: { drugId: "not_a_real_drug", dose: "1mg", route: "iv" } }),
  });
  assert.equal(result.outcome, "UNSUPPORTED_CONTENT");
});

test("a reviewed recognized drug executes in both hospital modes", () => {
  for (const mode of [{ mode: "reference" }, { mode: "real", realProfileId: "KZ-R2-URBAN" }]) {
    const session = newSession(mode);
    const { result } = applyCommand({
      session,
      command: createCommand({ id: "m1", type: "ORDER_MEDICATION", params: { drugId: "ketoprofen", dose: "100mg", doseMg: 100, route: "im" } }),
    });
    assert.equal(result.outcome, "EXECUTED");
  }
});

// --- Safety model (Core Runtime Spec §57, Mentor Spec §6.6) -------------------

test("an irreversible step cannot start before its hard prerequisites are actually met", () => {
  // Core Runtime Spec §58: readiness is real tracked state. Note this is a
  // STRUCTURAL gate, not the consent clinical rule - that rule is currently
  // governance-blocked (see the governance tests below), and the architecture
  // must still refuse to open an abdomen on an unprepared patient regardless.
  let session = newSession();
  session = applyCommand({
    session,
    command: createCommand({ id: "p1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  const { result } = applyCommand({
    session,
    command: createCommand({ id: "p2", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }),
  });
  assert.equal(result.outcome, "PREOP_NOT_READY");
  assert.ok(result.missingItems.includes("consent"));
});

test("after every blocking prerequisite is satisfied by real actions, the procedure executes", () => {
  let session = newSession();
  session = applyCommand({
    session,
    command: createCommand({ id: "p1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  session = completeBlockingPreop(session);
  const { result } = applyCommand({
    session,
    command: createCommand({ id: "p9", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }),
  });
  assert.equal(result.outcome, "EXECUTED");
});

// --- Runtime governance gate (task brief P0-5, Governance Spec §7-8) --------

test("a clinically eligible but not-approved_for_training rule never becomes authoritative", () => {
  // RULE-CONSENT-BEFORE-PROCEDURE is `pending`. Its conditions hold
  // here (START_PROCEDURE + consent not obtained), but it must not produce a
  // SAFETY_STOP, because unapproved content cannot create an authoritative
  // safety stop (Governance Spec §7, §8.2).
  let session = newSession();
  session = applyCommand({
    session,
    command: createCommand({ id: "p1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  const { result } = applyCommand({
    session,
    command: createCommand({ id: "p2", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }),
  });
  assert.notEqual(result.outcome, "SAFETY_STOP");
});

test("governance-blocked rules are recorded as simulator limitations, never silently dropped", () => {
  const contentBundle = structuredClone(bundle);
  contentBundle.rules.rules.find((rule) => rule.id === "RULE-CONSENT-BEFORE-PROCEDURE").provenance.review_status = "pending";
  let session = newSession({ contentBundle });
  session = applyCommand({
    session,
    command: createCommand({ id: "p1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  // Consent deliberately NOT obtained, so the consent rule's conditions hold
  // and it is a genuinely eligible rule that governance - not clinical
  // logic - is what excludes.
  const { result } = applyCommand({
    session,
    command: createCommand({ id: "p2", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }),
  });
  const blocked = result.governanceBlocked.find((entry) => entry.id === "RULE-CONSENT-BEFORE-PROCEDURE");
  assert.ok(blocked, "the eligible-but-unapproved rule must appear in the audit trail");
  assert.equal(blocked.reason, "not_approved_for_training");
  // `pending` since the 2026-08-25 remediation: the rule was also downgraded
  // from LEVEL_4_CATASTROPHIC, because absence of consent is a procedural
  // readiness failure, not modelled patient harm (matrix PR05).
  assert.equal(blocked.reviewStatus, "pending");
});

test("an approved no-transition trajectory leaves physiology unchanged without a false limitation", () => {
  // TRJ-STABLE is `review_status: pending`. Advancing three hours must not
  // move physiology, and must leave an auditable note that progression was
  // withheld rather than pretending the patient was biologically static.
  const session = newSession();
  const before = { ...session.state.physiology };
  const { session: after } = applyTimeAdvance({ session, targetMinutes: 180, cause: { actor: "learner" } });
  assert.deepEqual(after.state.physiology, before);
  assert.equal(after.state.simulatorLimitations.some((entry) => entry.kind === "trajectory" && entry.id === "TRJ-STABLE"), false);
});

test("the first APP-004 slice schedules NO postoperative complication at all", () => {
  let session = newSession();
  session = applyCommand({
    session,
    command: createCommand({ id: "p1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  session = completeBlockingPreop(session);
  session = applyCommand({ session, command: createCommand({ id: "p9", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }) }).session;
  session = applyCommand({
    session,
    command: createCommand({
      id: "d1",
      type: "OPERATIVE_DECISION",
      params: { decisionId: session.state.operative.pendingDecision, choice: "appendectomy_plus_aspiration" },
    }),
  }).session;

  const { session: after, newEvents } = applyTimeAdvance({
    session,
    targetMinutes: session.state.clock.elapsedMinutes + 72 * 60,
    cause: { actor: "learner" },
  });
  // Matrix T06 / task §4.7: `superficial_ssi` was REMOVED from the first
  // approved APP-004 and NOT replaced. So there is nothing to roll, nothing to
  // clear, and - unlike the previous build - not even a complication-shaped
  // simulator limitation, because no complication is scheduled in the first
  // place. `withdrawn_complications` in the content records what was removed
  // and what a reinstatement would need.
  assert.equal(newEvents.some((e) => e.type === "COMPLICATION_CHECK_CLEARED"), false);
  assert.equal(newEvents.some((e) => e.type === "COMPLICATION_OCCURRED"), false);
  assert.equal(after.state.pending.some((item) => item.kind === "complication_check"), false);
  assert.equal(after.state.simulatorLimitations.some((entry) => entry.kind === "complication"), false);
  assert.deepEqual(bundle.complications.postoperative_course.complications, []);
});

// ---------------------------------------------------------------------------
// Postoperative recovery clock anchor (Second Clinical Reviewer Decision,
// 2026-09-01, Sarina T.T.: REVISE on TRJ-POSTOP-RECOVERY). SOURCE_CONTROL_
// COMPLETED can precede completion of the operation, anaesthetic maintenance
// and surgical closure, so it is not a valid recovery-clock anchor. The clock
// (`postop.recovery.enteredAtMinutes`) now starts at PROCEDURE_COMPLETED, the
// operation-complete event (`core/state/worldState.js`, `core/time/advanceTime.js`).
// ---------------------------------------------------------------------------

/** State right after START_PROCEDURE, before the source-control decision. */
function reachStartedProcedure(seed = "clock-anchor") {
  let session = newSession({ seed });
  session = applyCommand({
    session,
    command: createCommand({ id: "p1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  session = completeBlockingPreop(session);
  session = applyCommand({ session, command: createCommand({ id: "p9", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }) }).session;
  return session;
}

test("A: SOURCE_CONTROL_COMPLETED alone does not start the postoperative recovery clock", () => {
  const session = reachStartedProcedure();
  assert.equal(session.state.operative.sourceControl, false);
  assert.equal(session.state.operative.completed, false);
  assert.equal(session.state.postop.recovery.enteredAtMinutes, null);

  const sourceControlAt = session.state.clock.elapsedMinutes;
  const afterSourceControl = applyEvent(
    session.state,
    createEvent({
      type: EVENT.SOURCE_CONTROL_COMPLETED,
      atMinutes: sourceControlAt,
      atIso: session.state.clock.startIso,
      payload: {},
      cause: { actor: "learner" },
    }),
  );
  assert.equal(afterSourceControl.operative.sourceControl, true);
  assert.equal(afterSourceControl.operative.completed, false);
  assert.equal(afterSourceControl.postop.recovery.enteredAtMinutes, null, "source control alone must not anchor the recovery clock");
});

test("B: the recovery clock begins only at PROCEDURE_COMPLETED, anchored to its own timestamp", () => {
  const session = reachStartedProcedure();
  const sourceControlAt = session.state.clock.elapsedMinutes;
  const afterSourceControl = applyEvent(
    session.state,
    createEvent({
      type: EVENT.SOURCE_CONTROL_COMPLETED,
      atMinutes: sourceControlAt,
      atIso: session.state.clock.startIso,
      payload: {},
      cause: { actor: "learner" },
    }),
  );

  // Closure takes real time in this scenario: PROCEDURE_COMPLETED lands 25
  // minutes after source control, proving the anchor is decoupled from it.
  const procedureCompletedAt = sourceControlAt + 25;
  const afterCompletion = applyEvent(
    afterSourceControl,
    createEvent({
      type: EVENT.PROCEDURE_COMPLETED,
      atMinutes: procedureCompletedAt,
      atIso: session.state.clock.startIso,
      payload: { closureStatementRu: null, scheduledPending: [] },
      cause: { actor: "system", source: "operative_sequence" },
    }),
  );
  assert.equal(afterCompletion.operative.completed, true);
  assert.equal(afterCompletion.postop.recovery.enteredAtMinutes, procedureCompletedAt);
  assert.notEqual(afterCompletion.postop.recovery.enteredAtMinutes, sourceControlAt);
});

test("C: advancing time between SOURCE_CONTROL_COMPLETED and PROCEDURE_COMPLETED does not advance postoperative recovery", () => {
  const session = reachStartedProcedure();
  const sourceControlAt = session.state.clock.elapsedMinutes;
  const afterSourceControl = applyEvent(
    session.state,
    createEvent({
      type: EVENT.SOURCE_CONTROL_COMPLETED,
      atMinutes: sourceControlAt,
      atIso: session.state.clock.startIso,
      payload: {},
      cause: { actor: "learner" },
    }),
  );

  const { events } = advanceTime({
    state: afterSourceControl,
    clockRoot: session.clockRoot,
    bundle: session.bundle,
    rng: session.rng,
    targetMinutes: sourceControlAt + 60,
    cause: { actor: "learner" },
  });
  assert.equal(events.some((e) => e.type === "POSTOPERATIVE_RECOVERY_UPDATED"), false);
  assert.equal(
    events.some((e) => e.type === "SIMULATOR_LIMITATION_NOTED" && e.payload.kind === "postoperative_recovery"),
    false,
    "the gate must not even attempt the (dormant) postoperative course while the operation is not yet complete",
  );
  const afterAdvance = events.reduce((state, event) => applyEvent(state, event), afterSourceControl);
  assert.equal(afterAdvance.postop.recovery.enteredAtMinutes, null);
  assert.equal(afterAdvance.operative.completed, false);
});

test("D: the recovery model's transitions only set qualitative pain/phase flags - the 6-12h/12-24h windows never carry a discharge effect", () => {
  const course = bundle.trajectories.post_source_control_course;
  assert.equal(course.discharge_readiness_contract.window_end_effect, "expectation_only_never_override");
  assert.deepEqual(course.recovery_variants.map((v) => v.recovery_window_hours), [[6, 12], [12, 24]]);
  for (const transition of course.model.transitions) {
    const effectDomains = Object.keys(transition.effects ?? {}).sort();
    assert.deepEqual(effectDomains, ["symptoms", "truth"], `${transition.id} must only touch qualitative pain/phase state`);
    assert.deepEqual(Object.keys(transition.effects.symptoms), ["postopPainStage"]);
    assert.deepEqual(Object.keys(transition.effects.truth), ["recoveryPhase"]);
  }
});

test("E: even once the recovery model is approved and both windows fully elapse, discharge criteria stay governed by their own review status - never silently satisfied by elapsed time", () => {
  const approvedBundle = structuredClone(bundle);
  approvedBundle.trajectories.post_source_control_course.provenance.review_status = "approved_for_training";

  let session = newSession({ seed: "clock-e", contentBundle: approvedBundle });
  session = applyCommand({
    session,
    command: createCommand({ id: "p1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  session = completeBlockingPreop(session);
  session = applyCommand({ session, command: createCommand({ id: "p9", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }) }).session;
  session = applyCommand({
    session,
    command: createCommand({
      id: "d1",
      type: "OPERATIVE_DECISION",
      params: { decisionId: session.state.operative.pendingDecision, choice: "appendectomy_plus_aspiration" },
    }),
  }).session;
  assert.equal(session.state.operative.completed, true);
  session = applyCommand({ session, command: createCommand({ id: "m1", type: "MOVE_PATIENT", params: { to: "surgical_ward" } }) }).session;

  // Two sequential advances, matching how `advanceTime` resolves one bounded
  // transition per call: past the pacu_emergence -> early_ward_recovery gate
  // (90/120 min), then past the early_ward_recovery -> recovered_uncomplicated
  // gate (360/720 min) - well beyond both authored windows, for either seeded
  // variant.
  session = applyTimeAdvance({ session, targetMinutes: session.state.clock.elapsedMinutes + 150, cause: { actor: "learner" } }).session;
  session = applyTimeAdvance({ session, targetMinutes: session.state.clock.elapsedMinutes + 750, cause: { actor: "learner" } }).session;
  assert.equal(session.state.truth.recoveryPhase, "recovered_uncomplicated");
  assert.equal(session.state.symptoms.postopPainStage, "controlled_on_oral_analgesia");

  const { result } = applyCommand({ session, command: createCommand({ id: "dc1", type: "DISCHARGE", params: {} }) });
  const withheldClinical = (result.events ?? []).filter(
    (e) => e.type === "SIMULATOR_LIMITATION_NOTED" && e.payload.kind === "discharge_runtime_fact",
  );
  assert.ok(
    withheldClinical.length > 0,
    "clinical discharge criteria must still be recorded as withheld, never as silently met, however much recovery-window time has elapsed",
  );
});

test("F/I/J: with TRJ-POSTOP-RECOVERY authoritative, elapsed time and recoveryPhase still satisfy NO clinical discharge criterion, and no numeric threshold was introduced", () => {
  // The approved model is now runtime-authoritative in shipped content, so this
  // runs on the real bundle (no fixture override). The five functional
  // discharge criteria have no approved patient-state to evaluate them from,
  // so each must still be emitted as an unmet `discharge_runtime_fact`
  // simulator limitation - never flipped to "met" because a window elapsed or
  // because truth.recoveryPhase advanced.
  let session = newSession({ seed: "postop-discharge-invariant" });
  session = applyCommand({
    session,
    command: createCommand({ id: "p1", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;
  session = completeBlockingPreop(session);
  session = applyCommand({ session, command: createCommand({ id: "p9", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }) }).session;
  session = applyCommand({
    session,
    command: createCommand({
      id: "d1",
      type: "OPERATIVE_DECISION",
      params: { decisionId: session.state.operative.pendingDecision, choice: "appendectomy_plus_aspiration" },
    }),
  }).session;
  session = applyCommand({ session, command: createCommand({ id: "m1", type: "MOVE_PATIENT", params: { to: "surgical_ward" } }) }).session;

  // Drive time past BOTH milestone gates for either seeded variant (90/120 then
  // 360/720 min) and well beyond the 24 h upper window.
  session = applyTimeAdvance({ session, targetMinutes: session.state.clock.elapsedMinutes + 200, cause: { actor: "learner" } }).session;
  session = applyTimeAdvance({ session, targetMinutes: session.state.clock.elapsedMinutes + 1500, cause: { actor: "learner" } }).session;
  assert.equal(session.state.truth.recoveryPhase, "recovered_uncomplicated", "model reached its terminal phase on elapsed time");

  const { result } = applyCommand({ session, command: createCommand({ id: "dc1", type: "DISCHARGE", params: {} }) });
  assert.equal(result.outcome, "EXECUTED");

  const withheldIds = (result.events ?? [])
    .filter((e) => e.type === "SIMULATOR_LIMITATION_NOTED" && e.payload.kind === "discharge_runtime_fact")
    .map((e) => e.payload.id)
    .sort();
  assert.deepEqual(
    withheldIds,
    ["haemodynamically_stable", "mobile", "no_significant_persistent_vomiting", "pain_controlled_on_oral_regimen", "tolerating_oral_intake"],
    "all five functional criteria remain unmeasured simulator-limited facts - none became evaluable from elapsed time or recoveryPhase",
  );

  // No discharge blocker was raised FROM a clinical criterion (they are not
  // wired), and none was silently marked met either.
  assert.equal(result.events.some((e) => e.type === "PATIENT_DISCHARGED"), true);

  // J: the criteria still carry no numeric threshold, and the recovery model
  // still contains no per-hour / numeric pain or vital arithmetic.
  for (const c of bundle.complications.discharge_criteria) {
    if ("threshold" in c) assert.equal(c.threshold, null, `${c.id} must not have acquired a numeric threshold`);
  }
  const modelJson = JSON.stringify(bundle.trajectories.post_source_control_course.model);
  assert.equal(/per_hour|delta_range|"delta"|pain_score|mmhg|bpm/i.test(modelJson), false, "no numeric medical thresholds in the recovery model");
});

test("the withdrawn SSI complication and its monitoring multiplier are gone from content and code", () => {
  // Matrix T07/PO09: "inadequate monitoring raises the biological incidence of
  // SSI" was removed as an unsupported causal claim. Asserting on the content
  // AND on the source keeps a future edit from quietly restoring either half.
  const withdrawn = bundle.complications.postoperative_course.withdrawn_complications ?? [];
  assert.ok(withdrawn.some((entry) => entry.id === "superficial_ssi"));
  assert.equal(JSON.stringify(bundle.complications).includes("probability_with_inadequate_monitoring:"), false);
  const advanceTimeSource = readFileSync(new URL("../time/advanceTime.js", import.meta.url), "utf8");
  assert.equal(/const probability\s*=[^;]*inadequate/.test(advanceTimeSource), false);
});

test("an unapproved treatment effect leaves the order executed but the patient unchanged", () => {
  // The medication IS administered - a governance gap must never make the
  // simulator refuse a legitimate clinical action, only withhold the modeled
  // physiological consequence (task §21).
  const session = newSession();
  const painBefore = session.state.symptoms.painScore;
  const { session: after, result } = applyCommand({
    session,
    command: createCommand({ id: "m1", type: "ORDER_MEDICATION", params: { drugId: "ketoprofen", dose: "100mg", doseMg: 100, route: "im" } }),
  });
  assert.equal(result.outcome, "EXECUTED");
  const { session: later } = applyTimeAdvance({ session: after, targetMinutes: 120, cause: { actor: "learner" } });
  assert.equal(later.state.symptoms.painScore, painBefore);
});

// --- Mentor hidden-truth boundary (Core Runtime Spec §51-52) ------------------

test("the learner-visible projection never contains the hidden patient truth", () => {
  const session = newSession();
  const visible = buildLearnerVisibleState(session.state);
  assert.equal(JSON.stringify(visible).includes(session.state.truth.operativeTruthRu), false);
  assert.equal("truth" in visible, false);
});

// --- Parallel orders in one turn (Core Runtime Spec §9, Contract §8.1) -------

test("several orders from one learner message all execute without forced sequential waiting", () => {
  const session = newSession();
  const commands = [
    createCommand({ id: "a", type: "ORDER_TEST", params: { testId: "cbc" } }),
    createCommand({ id: "b", type: "ORDER_TEST", params: { testId: "crp" } }),
      createCommand({ id: "c", type: "ORDER_MEDICATION", params: { drugId: "ketoprofen", dose: "100mg", doseMg: 100, route: "im" } }),
    createCommand({ id: "d", type: "ORDER_INFUSION", params: { fluidId: "crystalloid", volumeMl: 500, durationMinutes: 60 } }),
  ];
  const { session: after, results } = applyCommands({ session, commands });
  assert.ok(results.every((r) => r.outcome === "EXECUTED"));
  assert.equal(after.state.clock.elapsedMinutes, 0); // no time passed just from issuing orders
  assert.equal(Object.keys(after.state.investigations).length, 2);
});

// --- Current-status is a read, not reasoning or a clinical action ----------

test("REQUEST_STATUS never mutates state or the event log", () => {
  const session = newSession();
  const { session: after, result } = applyCommand({ session, command: createCommand({ id: "s1", type: "REQUEST_STATUS", params: {} }) });
  assert.equal(result.outcome, "EXECUTED");
  assert.equal(after.events.length, session.events.length);
});

// --- Full vertical-slice journey -------------------------------------------

test("EMS handoff through safe discharge: the full appendicitis journey runs end to end", () => {
  let session = newSession({ seed: "journey-seed" });

  session = applyCommand({ session, command: createCommand({ id: "1", type: "TAKE_HISTORY", params: {} }) }).session;
  session = applyCommand({ session, command: createCommand({ id: "2", type: "EXAMINE", params: { region: "abdomen" } }) }).session;
  session = applyCommands({
    session,
    commands: [
      createCommand({ id: "3", type: "ORDER_TEST", params: { testId: "cbc" } }),
      createCommand({ id: "4", type: "ORDER_TEST", params: { testId: "crp" } }),
      createCommand({ id: "5", type: "ORDER_TEST", params: { testId: "ct_abdomen" } }),
      createCommand({
        id: "6",
        type: "ORDER_MEDICATION",
        params: { drugId: "ketoprofen", dose: "100mg", doseMg: 100, route: "im" },
      }),
    ],
  }).session;

  session = applyTimeAdvance({ session, targetMinutes: 140, cause: { actor: "learner", source: "workup_wait" } }).session;
  assert.equal(session.state.investigations.cbc.status, "resulted");
  assert.equal(session.state.investigations.ct_abdomen.status, "resulted");

  session = applyCommand({
    session,
    command: createCommand({ id: "7", type: "STATE_REASONING", params: { workingDiagnosis: "acute_appendicitis", stability: true } }),
  }).session;
  session = applyCommand({
    session,
    command: createCommand({ id: "8", type: "COMMIT_MANAGEMENT_PLAN", params: { intent: "operative" } }),
  }).session;

  // Preop readiness is DERIVED from real actions (task brief P0-4), never set.
  assert.equal(session.state.preop.ready, false);
  session = completeBlockingPreop(session);
  assert.equal(session.state.preop.ready, true);

  session = applyCommand({
    session,
    command: createCommand({ id: "start-op", type: "START_PROCEDURE", params: { approach: "laparoscopic" } }),
  }).session;
  assert.equal(session.state.operative.started, true);
  assert.ok(session.state.operative.pendingDecision);

  session = applyCommand({
    session,
    command: createCommand({
      id: "decision-1",
      type: "OPERATIVE_DECISION",
      params: { decisionId: session.state.operative.pendingDecision, choice: "appendectomy_plus_aspiration" },
    }),
  }).session;
  assert.equal(session.state.operative.sourceControl, true);
  assert.equal(session.state.operative.completed, true);

  session = applyCommand({
    session,
    command: createCommand({ id: "disposition", type: "DISPOSITION", params: { destination: "surgical_ward" } }),
  }).session;
  assert.equal(session.state.location, "surgical_ward");

  // 60 hours postop - past the authored complication window - to a safe endpoint.
  session = applyTimeAdvance({ session, targetMinutes: session.state.clock.elapsedMinutes + 60 * 60, cause: { actor: "learner" } }).session;

  session = applyCommand({
    session,
    command: createCommand({ id: "discharge", type: "DISCHARGE", params: {} }),
  }).session;

  assert.equal(session.state.session.status, "complete");
  assert.equal(session.state.session.endpoint.type, "PATIENT_DISCHARGED");
});
