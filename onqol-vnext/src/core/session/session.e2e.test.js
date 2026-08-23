import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "./createSession.js";
import { applyCommand, applyCommands, applyTimeAdvance } from "./applyTurn.js";
import { createCommand } from "../commands/commandTypes.js";
import { buildLearnerVisibleState } from "../state/learnerView.js";
import { withShared } from "../content/loadBundle.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);
const START_ISO = "2026-08-23T02:15:00+05:00";

function newSession({ mode = "reference", realProfileId, seed = "e2e-seed" } = {}) {
  return createSession({
    sessionId: "e2e",
    seed,
    mode,
    realProfileId,
    casePresetId: "APP-004",
    bundle,
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
  current = applyCommand({ session: current, command: createCommand({ id: "pre-npo", type: "SET_NPO", params: {} }) }).session;
  current = applyCommand({ session: current, command: createCommand({ id: "pre-iv", type: "ESTABLISH_IV_ACCESS", params: {} }) }).session;
  current = applyCommand({
    session: current,
    command: createCommand({ id: "pre-abx", type: "GIVE_ANTIBIOTIC_PROPHYLAXIS", params: { drugId: "cefazolin", dose: "2г", doseMg: 2000 } }),
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

// --- Resource three-way distinction (Foundation Spec §50, behavioral
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

test("a recognized drug executes in both hospital modes", () => {
  for (const mode of [{ mode: "reference" }, { mode: "real", realProfileId: "KZ-R2-URBAN" }]) {
    const session = newSession(mode);
    const { result } = applyCommand({
      session,
      command: createCommand({ id: "m1", type: "ORDER_MEDICATION", params: { drugId: "ketorolac", dose: "30mg", route: "iv" } }),
    });
    assert.equal(result.outcome, "EXECUTED");
  }
});

// --- Safety model (Foundation Spec §57, Mentor Spec §6.6) -------------------

test("an irreversible step cannot start before its hard prerequisites are actually met", () => {
  // Core Foundation Spec §58: readiness is real tracked state. Note this is a
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
  // RULE-CONSENT-BEFORE-PROCEDURE is `reviewed_internal`. Its conditions hold
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
  let session = newSession();
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
  assert.equal(blocked.reviewStatus, "reviewed_internal");
});

test("an unapproved trajectory does not silently alter patient truth over time", () => {
  // TRJ-STABLE is `review_status: pending`. Advancing three hours must not
  // move physiology, and must leave an auditable note that progression was
  // withheld rather than pretending the patient was biologically static.
  const session = newSession();
  const before = { ...session.state.physiology };
  const { session: after } = applyTimeAdvance({ session, targetMinutes: 180, cause: { actor: "learner" } });
  assert.deepEqual(after.state.physiology, before);
  assert.ok(after.state.simulatorLimitations.some((entry) => entry.kind === "trajectory" && entry.id === "TRJ-STABLE"));
});

test("an unapproved complication probability is never rolled, and never reported as cleared", () => {
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
  assert.equal(newEvents.some((e) => e.type === "COMPLICATION_CHECK_CLEARED"), false);
  assert.equal(newEvents.some((e) => e.type === "COMPLICATION_OCCURRED"), false);
  assert.ok(after.state.simulatorLimitations.some((entry) => entry.kind === "complication" && entry.id === "superficial_ssi"));
});

test("an unapproved treatment effect leaves the order executed but the patient unchanged", () => {
  // The medication IS administered - a governance gap must never make the
  // simulator refuse a legitimate clinical action, only withhold the modeled
  // physiological consequence (task §21).
  const session = newSession();
  const painBefore = session.state.symptoms.painScore;
  const { session: after, result } = applyCommand({
    session,
    command: createCommand({ id: "m1", type: "ORDER_MEDICATION", params: { drugId: "ketorolac", dose: "30mg", route: "iv" } }),
  });
  assert.equal(result.outcome, "EXECUTED");
  const { session: later } = applyTimeAdvance({ session: after, targetMinutes: 120, cause: { actor: "learner" } });
  assert.equal(later.state.symptoms.painScore, painBefore);
});

// --- Mentor hidden-truth boundary (Foundation Spec §51-52) ------------------

test("the learner-visible projection never contains the hidden patient truth", () => {
  const session = newSession();
  const visible = buildLearnerVisibleState(session.state);
  assert.equal(JSON.stringify(visible).includes(session.state.truth.operativeTruthRu), false);
  assert.equal("truth" in visible, false);
});

// --- Parallel orders in one turn (Foundation Spec §9, Contract §8.1) -------

test("several orders from one learner message all execute without forced sequential waiting", () => {
  const session = newSession();
  const commands = [
    createCommand({ id: "a", type: "ORDER_TEST", params: { testId: "cbc" } }),
    createCommand({ id: "b", type: "ORDER_TEST", params: { testId: "crp" } }),
    createCommand({ id: "c", type: "ORDER_MEDICATION", params: { drugId: "ketorolac", dose: "30mg", route: "iv" } }),
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
        params: { drugId: "ketorolac", dose: "30mg", route: "iv" },
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
