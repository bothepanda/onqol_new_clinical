import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { evaluateV3Rows } from "./v3Evaluation.mjs";
import { HOLDOUT_MANIFEST_FILE } from "./holdoutManifest.mjs";
import { holdoutFingerprint, suiteRows, v3Corpus } from "./v3Corpus.mjs";
import { rowExact, v3Metrics } from "./v3Metrics.mjs";
import { effectiveGold } from "./v3Corpus.mjs";
import { withShared } from "../src/core/content/loadBundle.js";
import { PROMOTION_POLICY_VERSION } from "../src/ai/interpreter/promotionPolicy.js";
import { COMMITMENT_POLICY_VERSION } from "../src/ai/interpreter/commitmentPolicy.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

/**
 * OFFLINE diagnostic replay of a recorded live development run.
 *
 *   node scripts/replayV3RecordedRun.mjs [--recorded <evidence file>] [--out <evidence file>]
 *
 * The recorded run's model responses are read back from its provider journal and
 * handed to the CURRENT interpreter code in place of a live provider. Nothing is
 * sent anywhere: `fetch` is replaced by a bomb for the duration of the run, no key
 * is read, and no ledger is touched.
 *
 * What this is and is not:
 *  - It recomputes the development metrics for the current code on the same 183
 *    rows, for a before/after comparison of the remediation.
 *  - It is DIAGNOSTIC. The recorded responses were produced by the pre-v3A.1
 *    prompt and allowlist, so it says nothing about how the changed prompt would
 *    behave live. A row the recorded run never consulted, but the current policy
 *    would, has no recorded response and is reported as `notReplayable` (its
 *    provider fails closed to the deterministic reading).
 *  - It is development data that tuned earlier candidates. It never lifts a
 *    NO-GO, and no further development-set fix is made from it after this
 *    remediation. The holdout is not run and its fingerprint is only verified.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const recordedFile = path.join(root, arg("--recorded", "docs/evidence/INTERPRETER_V3_CORPUS_DEVELOPMENT_2026-09-20-run1.json"));
const outFile = path.join(root, arg("--out", "docs/evidence/INTERPRETER_V3A1_OFFLINE_REPLAY_DEVELOPMENT_2026-09-20.json"));
const hash = (value) => createHash("sha256").update(value).digest("hex");

const recorded = JSON.parse(readFileSync(recordedFile, "utf8"));
const holdoutManifest = JSON.parse(readFileSync(path.join(root, HOLDOUT_MANIFEST_FILE), "utf8"));
const adjudicationFile = path.join(root, "docs/evidence/INTERPRETER_V3_GOLD_ADJUDICATION.json");
const adjudication = existsSync(adjudicationFile) ? JSON.parse(readFileSync(adjudicationFile, "utf8")) : null;

const fingerprint = holdoutFingerprint();
if (fingerprint.hash !== holdoutManifest.fingerprint.hash) throw new Error("v3_holdout_changed: the holdout no longer matches INTERPRETER_V3_HOLDOUT_MANIFEST.json");

// Recorded responses, aligned to the rows the recorded run consulted (one journal line per call, in order).
const journal = readFileSync(path.join(root, recorded.journalFile), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
const consulted = recorded.rows.filter((row) => row.hybrid?.semanticTelemetry?.called === true);
if (consulted.length !== journal.length) throw new Error(`journal_misaligned: ${consulted.length} consulted rows vs ${journal.length} journal lines`);
const responses = new Map();
consulted.forEach((row, index) => {
  const content = JSON.parse(journal[index].rawBody).choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);
  const proposed = [...parsed.clinicalActions.map((a) => [a.type, a.evidenceSpans]), ...parsed.patientQuestions.map((q) => ["ASK_PATIENT", q.evidenceSpans])];
  const recordedProposed = (row.hybrid.semanticTelemetry.proposedCommands ?? []).map((c) => [c.type, c.evidenceSpans]);
  if (JSON.stringify(proposed) !== JSON.stringify(recordedProposed)) throw new Error(`journal_misaligned_at_row:${row.id}`);
  responses.set(row.id, { content, model: JSON.parse(journal[index].rawBody).model });
});

const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error("offline_replay_must_not_use_the_network"); };
const rows = suiteRows(v3Corpus(), "DEVELOPMENT");
const replayed = new Set();
const notReplayable = [];
let evaluated;
try {
  evaluated = await evaluateV3Rows({
    rows, bundle: withShared(disease, shared),
    providerForRow: (row) => ({
      isConfigured: true,
      async complete() {
        const recordedResponse = responses.get(row.id);
        if (!recordedResponse) { notReplayable.push(row.id); throw Object.assign(new Error("no_recorded_response"), { code: "no_recorded_response" }); }
        replayed.add(row.id);
        return { text: recordedResponse.content, meta: { model: recordedResponse.model, costUsd: 0, replay: true } };
      },
    }),
  });
} finally { globalThis.fetch = originalFetch; }

const metrics = v3Metrics(evaluated, { adjudication });
const before = recorded.metrics.v3;
const after = metrics.v3;
const byId = new Map(recorded.rows.map((row) => [row.id, row]));
const verdict = (row, kind) => { const { gold } = effectiveGold(row, adjudication); return gold ? rowExact(row, kind, gold) : null; };
const label = (command) => `${command.type}:${command.params?.testId ?? command.params?.region ?? command.params?.topic ?? command.params?.role ?? command.params?.drugId ?? ""}`;
const summary = (row) => ({
  id: row.id, text: row.text, category: row.category, gold: row.gold.commands.map(label), goldDisposition: row.gold.disposition,
  executed: (row.executedCommands ?? []).filter((c) => c.type !== "STATE_REASONING").map(label),
  final: row.hybrid.commands.filter((c) => c.type !== "STATE_REASONING").map(label),
  withheld: (row.hybrid.withheldCommands ?? []).map((c) => `${label(c)}[${c.commitment.status}]`),
  clarified: row.hybrid.clarified === true, unresolved: row.hybrid.unmatchedFragments ?? [],
});
const changes = { fixed: [], regressed: [], stillFailing: [] };
for (const row of evaluated) {
  const was = byId.get(row.id) ? verdict(byId.get(row.id), "v3") : null;
  const now = verdict(row, "v3");
  if (was === false && now === true) changes.fixed.push(row.id);
  else if (was === true && now === false) changes.regressed.push(row.id);
  if (now === false) changes.stillFailing.push(summary(row));
}
const falseExecutions = evaluated.flatMap((row) => {
  const { gold } = effectiveGold(row, adjudication);
  const matchesAny = (command) => gold?.commands.some((g) => g.type === command.type && Object.entries(g.params ?? {}).every(([key, value]) => JSON.stringify(command.params?.[key]) === JSON.stringify(value)));
  return (row.executedCommands ?? []).filter((c) => c.type !== "STATE_REASONING" && !matchesAny(c)).map((command) => ({ id: row.id, text: row.text, executed: label(command), gold: row.gold.commands.map(label), goldDisposition: row.gold.disposition }));
});
const pick = (block) => ({
  exactFinalCommandSetAccuracy: block.exactFinalCommandSetAccuracy, exactSetAccuracyByGroup: block.exactSetAccuracyByGroup, commandPrecision: block.commandPrecision,
  commandRecall: block.commandRecall, falseExecutionCount: block.falseExecutionCount, falseExecutionRate: block.falseExecutionRate,
  inappropriateClarificationCount: block.inappropriateClarificationCount, inappropriateClarificationRate: block.inappropriateClarificationRate,
  parameterInventionCount: block.parameterInventionCount, highRiskFalseExecutionCount: block.highRiskFalseExecutionCount, patientQuestionAccuracy: block.patientQuestionAccuracy,
  resolutionCounts: block.resolutionCounts,
});

const report = {
  suite: "DEVELOPMENT", kind: "OFFLINE_REPLAY_OF_RECORDED_MODEL_RESPONSES", status: "DIAGNOSTIC_ONLY_NO_LIVE_CALLS",
  evidenceUse: "development_diagnostic_only_not_generalization_evidence; the recorded responses come from the pre-v3A.1 prompt/allowlist",
  verdict: "NO-GO", holdout: { untouched: true, rows: fingerprint.rows, hash: fingerprint.hash, equalsHoldoutManifest: true },
  recordedRun: { file: path.relative(root, recordedFile), candidate: recorded.candidate?.tag, promotionPolicyVersion: recorded.candidate?.promotionPolicyVersion, consultedTurns: consulted.length },
  currentCandidate: { promotionPolicyVersion: PROMOTION_POLICY_VERSION, commitmentPolicyVersion: COMMITMENT_POLICY_VERSION, sourceHash: hash(["src/ai/interpreter/commitmentPolicy.js", "src/ai/interpreter/candidateArbitration.js", "src/ai/interpreter/actionCandidateValidation.js", "src/ai/interpreter/deterministicInterpreter.js"].map((f) => readFileSync(path.join(root, f), "utf8")).join("\n")) },
  replay: { rows: evaluated.length, rowsWithRecordedResponseUsed: replayed.size, notReplayable: [...new Set(notReplayable)], networkCalls: 0 },
  before: { deterministicOnly: pick(recorded.metrics.deterministicOnly), v3: pick(before) },
  after: { deterministicOnly: pick(metrics.deterministicOnly), v3: pick(after) },
  changes: { fixed: changes.fixed, regressed: changes.regressed },
  falseExecutionsNow: falseExecutions,
  residualFailures: changes.stillFailing,
  generatedAt: new Date().toISOString(),
};
writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({
  file: path.relative(root, outFile), rows: evaluated.length, replayed: replayed.size, notReplayable: report.replay.notReplayable,
  before: { exact: before.exactFinalCommandSetAccuracy, precision: before.commandPrecision, recall: before.commandRecall, falseExec: before.falseExecutionCount, inappropriateClar: before.inappropriateClarificationCount },
  after: { exact: after.exactFinalCommandSetAccuracy, precision: after.commandPrecision, recall: after.commandRecall, falseExec: after.falseExecutionCount, inappropriateClar: after.inappropriateClarificationCount, invention: after.parameterInventionCount, highRiskFalseExec: after.highRiskFalseExecutionCount },
  deterministicOnly: { before: recorded.metrics.deterministicOnly.exactFinalCommandSetAccuracy, after: metrics.deterministicOnly.exactFinalCommandSetAccuracy },
  fixed: changes.fixed.length, regressed: changes.regressed, residual: changes.stillFailing.length, falseExecutions: falseExecutions.length,
}, null, 1));
