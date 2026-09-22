import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { effectiveGold, goldAdjudicationTemplate, holdoutFingerprint, splitOfGroup, suiteRows, v3Corpus } from "./v3Corpus.mjs";
import { matchesGold, rowExact, v3FreezeEligibility, v3Metrics } from "./v3Metrics.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const holdoutManifest = JSON.parse(readFileSync(new URL("../docs/evidence/INTERPRETER_V3_HOLDOUT_MANIFEST.json", import.meta.url), "utf8"));

test("the clean holdout matches its manifest, holds no resident-derived row, and never reuses a retired id", () => {
  const fingerprint = holdoutFingerprint();
  assert.equal(fingerprint.hash, holdoutManifest.fingerprint.hash);
  assert.equal(fingerprint.rows, 41);
  assert.equal(holdoutManifest.fingerprint.rows, 41);
  assert.equal(holdoutManifest.consumed, false);
  assert.deepEqual(holdoutManifest.runs, [], "sealing the fingerprint never ran the holdout");
  if (holdoutManifest.frozen) {
    assert.equal(holdoutManifest.status, "FROZEN_NOT_RUN");
    assert.equal(holdoutManifest.frozen.fingerprintSha256, fingerprint.hash, "a frozen fingerprint is the corpus fingerprint, or it is a different holdout");
    assert.equal(holdoutManifest.frozen.run, false);
  }
  assert.notEqual(fingerprint.hash, holdoutManifest.supersedes.hash, "the superseded fingerprint is not preserved");
  const rows = v3Corpus();
  assert.ok(rows.every((row) => row.provenance.kind === "synthetic"), "no row is derived from resident language");
  for (const id of holdoutManifest.retiredRowIds) assert.equal(rows.some((row) => row.id === id), false, `${id} is retired`);
  assert.deepEqual(holdoutManifest.rowIds, suiteRows(rows, "HOLDOUT").map((row) => row.id));
  assert.equal(JSON.stringify(holdoutManifest).includes("pilot-session"), false);
});

test("every row added for v3 is development-only; original rows keep their Stage 2 split", () => {
  const rows = v3Corpus();
  const added = rows.filter((row) => row.corpusVersion === "v3");
  assert.ok(added.length >= 30);
  assert.ok(added.every((row) => row.split === "DEVELOPMENT"));
  assert.ok(rows.filter((row) => row.corpusVersion === "stage2").every((row) => row.split === splitOfGroup(row.group)));
  assert.equal(suiteRows(rows, "HOLDOUT").length, 41, "no v3 row leaks into the holdout");
});

test("surface variants of one base intent always share a split and a group", () => {
  const byGroup = new Map();
  for (const row of v3Corpus()) byGroup.set(row.group, new Set([...(byGroup.get(row.group) ?? []), row.split]));
  assert.ok([...byGroup.values()].every((splits) => splits.size === 1));
});

test("adjudication is a separate artifact that never rewrites draft gold", () => {
  const rows = v3Corpus().slice(0, 3);
  const template = goldAdjudicationTemplate(rows);
  assert.equal(template.status, "PENDING_CLINICIAN_ADJUDICATION");
  assert.ok(Object.values(template.rows).every((entry) => entry.decision === null && entry.adjudicator === null));
  assert.equal(effectiveGold(rows[0], template).source, "draft_linguistic");
  const amended = { rows: { [rows[0].id]: { decision: "amend", amendedGold: { commands: [], disposition: "no_action" } } } };
  assert.equal(effectiveGold(rows[0], amended).source, "adjudicated_amended");
  assert.notDeepEqual(rows[0].gold, amended.rows[rows[0].id].amendedGold, "the original label is untouched");
  assert.equal(effectiveGold(rows[0], { rows: { [rows[0].id]: { decision: "exclude" } } }).gold, null);
});

const cmd = (type, params = {}) => ({ type, params });
const reading = (commands, extra = {}) => ({ commands, unmatchedFragments: [], clarified: false, ...extra });
const row = (id, group, gold, deterministic, hybrid, extra = {}) => ({
  id, group, category: "paraphrase", corpusVersion: "stage2", text: id, turnContext: {}, gold, deterministic, hybrid,
  deterministicExecuted: deterministic.commands.filter((c) => c.type !== "STATE_REASONING"), executedCommands: hybrid.commands, elapsedMs: 10, deterministicMs: 1, costUsd: 0.001, ...extra,
});

test("metrics: exact set, precision, recall, false execution and groups counted once", () => {
  const cbc = cmd("ORDER_TEST", { testId: "cbc" });
  const crp = cmd("ORDER_TEST", { testId: "crp" });
  const gold = (commands, disposition = "commands") => ({ commands, disposition });
  const rows = [
    row("a1", "g1", gold([cbc]), reading([]), reading([cbc])),
    row("a2", "g1", gold([cbc]), reading([]), reading([crp])),
    row("b1", "g2", gold([cbc]), reading([cbc]), reading([cbc])),
  ];
  const { v3, deterministicOnly } = v3Metrics(rows);
  assert.equal(v3.exactFinalCommandSetAccuracy, 2 / 3);
  assert.equal(v3.exactSetAccuracyByGroup, 1 / 2, "group g1 is one example, and it failed");
  assert.equal(deterministicOnly.exactFinalCommandSetAccuracy, 1 / 3);
  assert.equal(v3.commandPrecision, 2 / 3);
  assert.equal(v3.falseExecutionCount, 1);
  assert.equal(v3.falseExecutionRate, 1 / 3);
  assert.equal(deterministicOnly.commandRecall, 1 / 3);
  assert.equal(v3.commandRecall, 2 / 3);
  assert.equal(v3.groups, 2);
});

test("metrics: inappropriate clarification, conflict accuracy, patient questions and fallback rate", () => {
  const ask = cmd("ASK_PATIENT", { topic: "allergies" });
  const conflicted = reading([ask], { semanticTelemetry: { called: true, conflicts: [{ resolution: "semantic_override" }], finalCommands: [{ resolution: "semantic_override" }] } });
  const fallback = reading([], { mode: "hybrid_fallback_deterministic", semanticTelemetry: { called: true, conflicts: [], finalCommands: [] } });
  const clarified = reading([], { clarified: true });
  const rows = [
    row("q1", "q1", { commands: [ask], disposition: "commands" }, reading([]), conflicted),
    row("n1", "n1", { commands: [], disposition: "no_action" }, reading([]), clarified),
    row("f1", "f1", { commands: [cmd("ORDER_TEST", { testId: "cbc" })], disposition: "commands" }, reading([]), fallback),
  ];
  const { v3 } = v3Metrics(rows);
  assert.equal(v3.patientQuestionAccuracy, 1);
  assert.equal(v3.semanticConflictResolutionAccuracy, 1);
  assert.equal(v3.inappropriateClarificationRate, 1 / 3);
  assert.equal(v3.providerFallbackRate, 1 / 2);
  assert.equal(v3.costUsd.total, 0.003);
  assert.equal(v3.costUsd.projectedPerSession, 0.001 * 30);
});

test("metrics: an absent-key gold catches a guessed parameter on an incomplete command", () => {
  const goldCommand = { type: "ORDER_TEST", params: {}, absent: ["testId"] };
  assert.equal(matchesGold(cmd("ORDER_TEST", {}), goldCommand), true);
  assert.equal(matchesGold(cmd("ORDER_TEST", { testId: "crp" }), goldCommand), false);
  const gold = { commands: [goldCommand], disposition: "clarify" };
  assert.equal(rowExact(row("c", "c", gold, reading([]), reading([cmd("ORDER_TEST", {})], { clarified: true })), "v3", gold), true);
  assert.equal(rowExact(row("c", "c", gold, reading([]), reading([cmd("ORDER_TEST", { testId: "crp" })])), "v3", gold), false);
});

test("freeze eligibility cannot be earned by metric values, and holdout stays blocked while gold is unadjudicated", () => {
  const template = goldAdjudicationTemplate(v3Corpus());
  const result = v3FreezeEligibility({ adjudication: template, realPilotTurns: 9, independentGoldReview: false, frozen: false });
  assert.equal(result.eligible, false);
  assert.equal(result.holdoutVerdict, "NO-GO");
  assert.ok(result.blockers.some((b) => b.startsWith("gold_adjudication_incomplete")));
  assert.ok(result.blockers.includes("independent_gold_review_missing"));
  assert.ok(result.blockers.some((b) => b.startsWith("real_resident_turns")));
});

test("the v3 runner refuses the holdout suite", () => {
  const run = spawnSync(process.execPath, ["scripts/runV3Corpus.mjs", "--suite", "holdout"], { cwd: root, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /v3_holdout_blocked/);
});

test("the v3 budget ceiling can only lower the gateway cap, never raise it", async () => {
  const { EventEmitter } = await import("node:events");
  const { createAiGateway } = await import("../server/aiGateway.mjs");
  const { createGatewayProviderClient } = await import("../src/ai/providerClient.js");
  const transport = (gateway) => async (url, options) => new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { url, method: "POST", headers: {}, socket: { remoteAddress: "127.0.0.1" }, destroy() {} });
    const res = { statusCode: 200, setHeader() {}, end(body) { resolve(new Response(body, { status: this.statusCode })); } };
    gateway(req, res, () => { res.statusCode = 404; res.end("{}"); });
    req.emit("data", options.body); req.emit("end");
  });
  const calls = { n: 0 };
  const gatewayWith = (limits) => createAiGateway({
    env: { OPENAI_API_KEY: "fixture", ONQOL_RATE_LIMIT_PER_MIN: "1000" }, logger: { error() {} }, limits,
    fetchImpl: async () => { calls.n += 1; return Response.json({ choices: [{ message: { content: "{}" } }] }); },
  });
  const ask = (gateway, id) => createGatewayProviderClient({ fetchImpl: transport(gateway), sessionId: id }).complete({ messages: [{ role: "user", content: "x" }], responseFormat: {} });
  // A ceiling below one call's reservation refuses before any paid request.
  await assert.rejects(ask(gatewayWith({ pilotMaxUsd: 0.001 }), "tiny"), { code: "provider_quota" });
  assert.equal(calls.n, 0);
  // A ceiling ABOVE the configured cap changes nothing: the ledger still stops at the production $5 cap.
  const raised = gatewayWith({ pilotMaxUsd: 500 });
  const source = readFileSync(new URL("../server/aiGateway.mjs", import.meta.url), "utf8");
  assert.match(source, /Math\.min\(base\.pilotMaxUsd, limits\.pilotMaxUsd \?\? base\.pilotMaxUsd\)/);
  await ask(raised, "normal");
  assert.equal(calls.n, 1);
});
