import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEGACY_TRACKED, assertPrivateOutput, findGovernanceViolations, isPrivatePath, trackedAndStaged } from "./evidenceGovernance.mjs";
import { buildResidentManifest, emptyLedger, emptyReadings, harvestExport, ingest } from "./residentTurnCollection.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("raw resident data and sealed system outputs are forbidden in Git; manifests, adjudication and hashes are not", () => {
  const forbidden = [
    "private/resident-turns/RESIDENT_TURN_LEDGER.json",
    "docs/evidence/resident-turns/RESIDENT_TURN_LEDGER.json",
    "docs/evidence/resident-turns/RESIDENT_TURN_SYSTEM_READINGS.json",
    "resident-exports/session.json",
    "docs/evidence/pilot-failures/onqol-session-session-42.json",
    "onqol-session-session-42.json",
    "docs/evidence/gold-review/BLIND_PACKET_2026-09-21.json",
  ];
  const allowed = [
    "docs/evidence/resident-turns/RESIDENT_TURN_MANIFEST.json",
    "docs/evidence/INTERPRETER_V3_GOLD_ADJUDICATION.json",
    "docs/evidence/gold-review/BLIND_REVIEW_CHECK_Name_2026-09-21.json",
    "docs/evidence/INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-21-run1.json",
    "scripts/collectResidentTurns.mjs",
  ];
  assert.deepEqual(findGovernanceViolations(forbidden, { legacy: {} }).violations.map((v) => v.file), forbidden);
  assert.deepEqual(findGovernanceViolations(allowed, { legacy: {} }).violations, []);
});

test("a pre-ruling file is acknowledged and reported, never silently accepted; a new one is a violation", () => {
  const [legacyFile] = Object.keys(LEGACY_TRACKED);
  const result = findGovernanceViolations([legacyFile, "docs/evidence/pilot-failures/onqol-session-new.json"]);
  assert.deepEqual(result.acknowledged.map((entry) => entry.file), [legacyFile]);
  assert.deepEqual(result.violations.map((entry) => entry.file), ["docs/evidence/pilot-failures/onqol-session-new.json"]);
});

test("outputs that carry resident words or sealed readings must be written under private/", () => {
  assert.equal(isPrivatePath("private/gold-review/x.json", root), true);
  assert.equal(isPrivatePath(path.join(root, "private/x.json"), root), true);
  assert.equal(isPrivatePath("docs/evidence/gold-review/x.json", root), false);
  assert.equal(isPrivatePath("private-copy/x.json", root), false);
  assert.equal(isPrivatePath("../elsewhere/private/x.json", root), false);
  assert.doesNotThrow(() => assertPrivateOutput("private/gold-review/BLIND_PACKET.json", root));
  assert.throws(() => assertPrivateOutput("docs/evidence/gold-review/BLIND_PACKET.json", root, "a blind packet"), /governance/);
});

test("the committed resident manifest holds counts and hashes only: no word a resident typed, no context, no system reading", () => {
  const exported = { export_schema_version: "1.0.0", session: { id: "s-1", purpose: "learner_pilot" }, learner_turns: [
    { rawText: "секретное слово ОАК", intent: "CLINICAL_ACTION", unmatchedFragments: [], interpretedCommands: [{ id: "c0", type: "ORDER_TEST", params: { testId: "cbc" } }], commandOutcomes: [] },
    { rawText: "второй ход", intent: "CLINICAL_ACTION", unmatchedFragments: [], interpretedCommands: [], commandOutcomes: [] },
  ] };
  const { ledger } = ingest({ ledger: emptyLedger(), readings: emptyReadings() }, [harvestExport(exported, { fileName: "a.json", fileHash: "h1" })]);
  const manifest = buildResidentManifest(ledger);
  const text = JSON.stringify(manifest);
  assert.equal(manifest.turnCount, 2);
  assert.equal(manifest.turns.length, 2);
  for (const forbidden of ["секретное", "второй ход", "ORDER_TEST", "cbc", "interpretedCommands", "turnContext", "text\":"]) assert.equal(text.includes(forbidden), false, `manifest must not contain ${forbidden}`);
  assert.ok(manifest.turns.every((turn) => /^[0-9a-f]{64}$/.test(turn.textSha256)));
});

test(".gitignore excludes the private store and the raw / sealed files", () => {
  const ignore = readFileSync(path.join(root, ".gitignore"), "utf8").split("\n").map((line) => line.trim());
  for (const entry of ["private/", "docs/evidence/resident-turns/RESIDENT_TURN_LEDGER.json", "docs/evidence/resident-turns/RESIDENT_TURN_SYSTEM_READINGS.json", "resident-exports/"]) assert.ok(ignore.includes(entry), `.gitignore lists ${entry}`);
  try {
    execFileSync("git", ["check-ignore", "-q", "private/resident-turns/RESIDENT_TURN_LEDGER.json"], { cwd: root });
  } catch (error) {
    if (error.status === 1) assert.fail("git does not ignore private/resident-turns/RESIDENT_TURN_LEDGER.json");
  }
});

test("this repository tracks no un-acknowledged raw resident export or sealed output", (t) => {
  const files = trackedAndStaged(root);
  if (files === null) { t.skip("git is unavailable"); return; }
  assert.deepEqual(findGovernanceViolations(files).violations, []);
});
