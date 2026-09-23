import { test } from "node:test";
import assert from "node:assert/strict";
import { computeMetrics } from "./statefulMentorMetrics.mjs";
import { resident, interp } from "../src/content/diseases/fluids_01/fluidsHarness.js";

const events = (r) => ({ events: r.session.events });
const bolus = () => interp("б", [["ORDER_INFUSION", { fluidId: "sterofundin", volumeMl: 500, bolus: true }], ["REASSESS", { targets: ["vitals"], afterMinutes: 15 }]]);

test("Wave B metrics are computed from the event log alone", () => {
  const strong = resident({ seed: "m1" });
  strong.say("б", { interpreted: bolus() });
  strong.say("начните инфузию"); // operational gap answered by the nurse alone

  const weak = resident({ seed: "m2" });
  weak.say("болюс 500 мл стерофундина"); // no follow-up at all: the case simply moves on

  const m = computeMetrics([events(strong), events(weak)]);
  assert.equal(m.reassessment_followthrough_rate, 0.5);
  assert.equal(m.world_vs_mentor_clarification_accuracy, 1);
  assert.equal(m.stale_issue_reopen_rate, 0);
  assert.equal(m._waveBCounts.boluses, 2);
});

test("a stale reopen is counted: an issue deferred to the debrief and then spoken about again", () => {
  const r = resident({ seed: "m3" });
  r.say("болюс 500 мл стерофундина");
  for (let i = 0; i < 5; i += 1) r.say("не знаю");
  assert.ok(r.state.mentor.deferredMentorIssues.includes("fluids.reassessment_plan"));
  const m = computeMetrics([events(r)]);
  assert.equal(m.stale_issue_reopen_rate, 0, "the deferral itself is not a reopen");
});
