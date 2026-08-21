/**
 * The harness must fail when it did not measure anything.
 *
 * On 20.08.2026 `ab:mentor --live` reported "no regressions" for a run in which
 * every mentor turn had failed in transit and fallen back to a template. The
 * summary counted those templates as the result, and the acceptance that day
 * rested on it. The bug that caused it was one line; this file is about the
 * property that let it pass unnoticed.
 *
 * The distinction being locked in: a transport failure is a MISSING measurement,
 * not a bad one, and neither may exit zero.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DETERMINISTIC_SHARE_LIMIT,
  harnessVerdict,
} from "../../../scripts/abMentorVerdict.mjs";

/** Shape of buildMentorTelemetry()'s summary, trimmed to what the verdict reads. */
function telemetry({ spoke = 7, fromModel = 7, fromTemplate = 0, reasons = {} } = {}) {
  return {
    turns: [],
    summary: {
      mentor_turns: spoke,
      from_model: fromModel,
      from_template: fromTemplate,
      repaired: 0,
      rejection_reasons: reasons,
      policy_agreement: 0,
    },
  };
}

// --- the run that actually happened -----------------------------------------

test("a run where every turn failed in transit does not pass", () => {
  // Exactly 20.08.2026: seven turns, seven templates, mentor_agent_error×7.
  const verdict = harnessVerdict({
    telemetry: telemetry({ fromModel: 0, fromTemplate: 7, reasons: { mentor_agent_error: 7 } }),
    live: true,
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.exitCode, 1);
  assert.ok(verdict.failures.some((failure) => failure.code === "transport_failure"));
  // And it is named as a non-measurement, not as a bad mentor.
  assert.match(
    verdict.failures.find((failure) => failure.code === "transport_failure").detail,
    /несостоявшийся замер/
  );
});

test("one transport failure is enough, even offline", () => {
  // Offline nothing calls a model, so this reason cannot arise honestly. If it
  // does, the run is broken in some other way and must not report success.
  const verdict = harnessVerdict({
    telemetry: telemetry({ fromModel: 6, fromTemplate: 1, reasons: { mentor_agent_error: 1 } }),
    live: false,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.failures[0].code, "transport_failure");
});

test("transport detail appended to the category still fails the run", () => {
  const verdict = harnessVerdict({
    telemetry: telemetry({
      fromModel: 0,
      fromTemplate: 0,
      reasons: { "mentor_agent_error: fetch failed": 7 },
    }),
    live: true,
  });

  assert.equal(verdict.ok, false);
  assert.ok(verdict.failures.some((failure) => failure.code === "transport_failure"));
  assert.match(verdict.failures[0].detail, /fetch failed/);
});

// --- the two outcomes it must keep apart -------------------------------------

test("a measured run that stopped exercising the voice also fails", () => {
  // No transport error: the model answered and was rejected on content. That is
  // a real measurement, and a bad one - a different failure, still non-zero.
  const verdict = harnessVerdict({
    telemetry: telemetry({
      fromModel: 2,
      fromTemplate: 5,
      reasons: { uncited_numeric_fact: 5 },
    }),
    live: true,
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.exitCode, 1);
  assert.deepEqual(
    verdict.failures.map((failure) => failure.code),
    ["deterministic_share_exceeded"]
  );
  assert.equal(verdict.share, 5 / 7);
});

test("a live run with no mentor turns measured nothing", () => {
  const verdict = harnessVerdict({
    telemetry: telemetry({ spoke: 0, fromModel: 0, fromTemplate: 0 }),
    live: true,
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.failures.some((failure) => failure.code === "no_mentor_turns"));
});

// --- what must keep passing ---------------------------------------------------

test("the run observed on the fixture passes", () => {
  // Seven turns, seven from the model, nothing rejected: the real 20.08 result
  // once the model name reached the request.
  const verdict = harnessVerdict({ telemetry: telemetry(), live: true });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.exitCode, 0);
  assert.deepEqual(verdict.failures, []);
  assert.equal(verdict.share, 0);
});

test("an offline run is all templates and still passes", () => {
  // Offline every reply is deterministic by construction. Failing on that would
  // make the offline mode unusable rather than honest - it still exercises the
  // engine, the loop and the telemetry.
  const verdict = harnessVerdict({
    telemetry: telemetry({ fromModel: 0, fromTemplate: 7 }),
    live: false,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.exitCode, 0);
});

test("the ceiling is a tripwire above the observed floor, not a budget", () => {
  // Observed rate with a reachable model is zero, so the limit sits just above
  // it. Anything that makes this generous should be a deliberate decision.
  assert.ok(DETERMINISTIC_SHARE_LIMIT > 0 && DETERMINISTIC_SHARE_LIMIT <= 0.5);

  const under = harnessVerdict({
    telemetry: telemetry({ spoke: 8, fromModel: 7, fromTemplate: 1 }),
    live: true,
    limit: 0.25,
  });
  assert.equal(under.ok, true, "one template in eight is under the ceiling");

  const over = harnessVerdict({
    telemetry: telemetry({ spoke: 8, fromModel: 5, fromTemplate: 3 }),
    live: true,
    limit: 0.25,
  });
  assert.equal(over.ok, false, "three in eight is over it");
});
