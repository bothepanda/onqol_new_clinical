import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiagnostics, diagnosticsEnabled } from "./devDiagnostics.js";
import { caseEntry } from "../../content/caseCatalog.js";
import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";

test("the diagnostics panel needs a dev build, a non-pilot build and an explicit ?diag=1", () => {
  assert.equal(diagnosticsEnabled({ dev: true, pilot: false, search: "?diag=1" }), true);
  assert.equal(diagnosticsEnabled({ dev: true, pilot: false, search: "" }), false);
  assert.equal(diagnosticsEnabled({ dev: false, pilot: false, search: "?diag=1" }), false, "never in a production build");
  assert.equal(diagnosticsEnabled({ dev: true, pilot: true, search: "?diag=1" }), false, "never in a pilot build");
});

test("diagnostics expose seed, hidden truth, queue and recent events without changing the session", () => {
  const entry = caseEntry("APP-004");
  let session = createSession({ sessionId: "diag", seed: "diag-seed", mode: "real", realProfileId: "KZ-R2-URBAN", casePresetId: "APP-004", sessionPurpose: "internal_development", bundle: entry.bundle, locale: "ru", startIso: "2026-09-25T02:10:00+05:00" });
  session = submitLearnerTurn({ session, text: "ОАК" }).session;
  const before = JSON.stringify(session.events);
  const diagnostics = buildDiagnostics(session);
  assert.equal(diagnostics.session.seed, "diag-seed");
  assert.equal(diagnostics.session.casePresetId, "APP-004");
  assert.ok(diagnostics.truth.trajectoryId);
  assert.ok(diagnostics.pending.length >= 1, "the CBC result is queued");
  assert.ok(diagnostics.events.some((event) => event.type === "TEST_ORDERED"));
  assert.equal(JSON.stringify(session.events), before);
  assert.equal(buildDiagnostics(null), null);
});
