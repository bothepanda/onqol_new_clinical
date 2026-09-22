import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";
import { withShared } from "../../core/content/loadBundle.js";
import { STATEFUL_GROUNDED_MENTOR_V1 } from "../interaction/featureFlags.js";
import { buildMentorBrief } from "./mentorBrief.js";
import { buildLearnerVisibleState } from "../../core/state/learnerView.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import library from "../../content/mentor/app004-library.json" with { type: "json" };

const bundle = withShared(diseaseBundle, sharedBundle);
const START_ISO = "2026-08-23T09:15:00+05:00";

function newSession(seed, groundedOn) {
  return createSession({
    sessionId: "brief-test", seed, mode: "reference", casePresetId: "APP-004",
    sessionPurpose: "internal_development", bundle, locale: "ru", startIso: START_ISO,
    interactionFlags: { [STATEFUL_GROUNDED_MENTOR_V1]: groundedOn === true },
  });
}

// The exact sequence of turns that reaches the MOST hidden-truth-adjacent
// state this case models: an operative decision, revealed findings, and a
// mentor question open - if anything is going to leak, it leaks here.
const DEEP_TURNS = [
  "живот", "анамнез", "ОАК и СРБ", "КТ ОБП",
  "идём на операцию", "венозный доступ",
  "антибиотикопрофилактика цефазолин 2 г в/в, антибиотикопрофилактика метронидазол 500 мг в/в",
  "вызываю анестезиолога на осмотр", "переоценю витальные через 40 минут", "получаю согласие",
  "иду открытым доступом",
];

test("STATEFUL_GROUNDED_MENTOR_V1 off: state.mentor never grows the new working-memory fields beyond their initial defaults", () => {
  let session = newSession("flag-off", false);
  for (const text of DEEP_TURNS) session = submitLearnerTurn({ session, text }).session;
  assert.equal(session.state.mentor.pendingMentorQuestion, null);
  assert.equal(session.state.mentor.probingStreak, 0);
  assert.deepEqual(session.state.mentor.recentMentorQuestions, []);
  assert.deepEqual(session.state.mentor.deferredMentorIssues, []);
  // And the pre-existing fields behave exactly as before: a real open
  // question from the deterministic engine still gets recorded.
  assert.equal(session.state.mentor.openQuestion?.issueId, "open_approach_rationale");
});

test("the mentor brief carries no field absent from the learner-visible projection - the hidden-truth boundary holds", () => {
  let session = newSession("brief-boundary", true);
  let turn;
  for (const text of DEEP_TURNS) { turn = submitLearnerTurn({ session, text }); session = turn.session; }
  const brief = buildMentorBrief({ session, turn, history: [], text: "иду открытым доступом", library });
  // Every patient-shaped field in the brief must come from EXACTLY the
  // learner-visible projection - same reference discipline `learnerView.js`
  // itself documents (Core Runtime Spec §51-52).
  assert.deepEqual(brief.learnerVisiblePatientState, buildLearnerVisibleState(session.state));
  // Spot-check: nothing in the brief mentions the hidden truth's own keys
  // (phenotype/morphology ids, `state.truth`) - serialize and search, the
  // same technique coreRuntimeContract.test.js uses for this boundary.
  const serialized = JSON.stringify(brief);
  for (const hiddenKey of ["retrocecal", "uncomplicated_inflammation", "\"truth\""]) {
    assert.equal(serialized.includes(hiddenKey), false, `brief must not contain "${hiddenKey}"`);
  }
  // Card selection stays bounded to approved cards only.
  assert.ok(brief.approvedClinicalCards.every((c) => c.review_status === "approved_for_training"));
});
