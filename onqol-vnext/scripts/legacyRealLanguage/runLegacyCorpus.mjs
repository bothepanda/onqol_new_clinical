import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { preflight, liveGateway } from "../stage2Runtime.mjs";
import { evaluateV3Rows } from "../v3Evaluation.mjs";
import { withShared } from "../../src/core/content/loadBundle.js";
import { PROMOTION_POLICY_VERSION } from "../../src/ai/interpreter/promotionPolicy.js";
import { COMMITMENT_POLICY_VERSION } from "../../src/ai/interpreter/commitmentPolicy.js";
import { assertPrivateOutput } from "../evidenceGovernance.mjs";
import { aggregate, scoreRow, targetReport } from "./legacyMetrics.mjs";
import { classifyRow } from "./taxonomy.mjs";
import disease from "../../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../../src/content/generated/shared.json" with { type: "json" };

/**
 * Runs the frozen legacy_real_language_development corpus through the CURRENT interpreter.
 *
 *   node scripts/legacyRealLanguage/runLegacyCorpus.mjs --tag baseline --mode live
 *   node scripts/legacyRealLanguage/runLegacyCorpus.mjs --tag wave1 --mode replay --recorded baseline
 *   node scripts/legacyRealLanguage/runLegacyCorpus.mjs --tag probe --mode deterministic --scope OUT_OF_CURRENT_SCOPE
 *
 * modes
 *   live           the real semantic provider (separate spend ledger, ceiling <= 2 USD). Every model call is recorded
 *                  (request hash + response text) in the private run file so later waves can be replayed.
 *   replay         recorded responses from `--recorded <tag>` are handed to the current code. No network, no ledger.
 *                  A row whose request changed since the recording is counted (`requestChanged`); a row the recording
 *                  never consulted but the current policy would consult fails closed (`notReplayable`). Replay measures
 *                  the deterministic layer, the gates and the arbitration; it says nothing about a changed prompt.
 *   deterministic  no provider at all.
 *   rescore        no interpretation at all: the recorded run's rows are scored again against the CURRENT corpus version and
 *                  metrics (used to report the baseline under an amended corpus). Nothing about the interpreter changes.
 *
 * The corpus is DEVELOPMENT data: nothing here is holdout or generalization evidence. The holdout is not read.
 * Raw rows (learner words, model text) are written under private/ only; the tracked evidence file carries turn ids,
 * counts and tags, never words.
 */
const root = fileURLToPath(new URL("../../", import.meta.url));
const privateDir = path.join(root, "private/legacy-real-language");
const runsDir = path.join(privateDir, "runs");
const evidenceDir = path.join(root, "docs/evidence/legacy-real-language");
const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const sha = (value) => createHash("sha256").update(value).digest("hex");

const tag = arg("--tag", null);
const mode = arg("--mode", null);
const scope = arg("--scope", "IN_SCOPE");
if (!tag || !/^[a-z0-9-]+$/.test(tag) || !["live", "replay", "deterministic", "rescore"].includes(mode)) throw new Error("usage: --tag <slug> --mode live|replay|deterministic [--recorded <tag>] [--scope IN_SCOPE|OUT_OF_CURRENT_SCOPE]");
const outPrivate = path.join(runsDir, `${tag}${scope === "IN_SCOPE" ? "" : "-oos"}.json`);
assertPrivateOutput(outPrivate, root, "a legacy-corpus run (learner words, model text)");
if (existsSync(outPrivate)) throw new Error(`run_exists: ${path.relative(root, outPrivate)} is history and is never overwritten; choose a new --tag`);

// ---- the corpus must be the frozen one
const manifest = JSON.parse(readFileSync(path.join(evidenceDir, "CORPUS_MANIFEST.json"), "utf8"));
const corpus = JSON.parse(readFileSync(path.join(privateDir, "CORPUS.json"), "utf8"));
const corpusHash = sha(JSON.stringify(corpus.turns));
if (corpusHash !== manifest.corpusHash) throw new Error(`corpus_not_frozen: CORPUS.json (${corpusHash.slice(0, 12)}) differs from the frozen manifest (${manifest.corpusHash.slice(0, 12)}); an edit to a frozen corpus must be an amendment, not a silent change`);

const turns = corpus.turns.filter((t) => t.scope === scope);
// Conversational context (interpreter v3B): each row is read against the system utterance that preceded it, as a live session would.
// `--context none` reproduces the pre-v3B harness (no context) for a like-for-like comparison.
const contextMode = arg("--context", "prompt");
if (!["prompt", "none"].includes(contextMode)) throw new Error("--context must be prompt|none");
const rows = turns.map((t) => ({ id: t.turnId, text: t.rawText, turnContext: contextMode === "prompt" && t.precedingPrompt ? { precedingPrompt: t.precedingPrompt } : {}, group: t.sessionAlias, category: t.channel, channel: t.channel, corpusVersion: "legacy_real_language" }));
const goldOf = new Map(turns.map((t) => [t.turnId, { commands: t.expectedCommands, disposition: t.expectedDisposition }]));

// ---- candidate identity
const interpreterFiles = readdirSync(path.join(root, "src/ai/interpreter")).filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")).map((f) => `src/ai/interpreter/${f}`);
const files = [...interpreterFiles, "src/ai/modelConfig.js", "src/core/commands/commandTypes.js", "src/core/commands/executeCommand.js", "src/content/shared/interaction/concepts.yaml",
  "scripts/legacyRealLanguage/legacyMetrics.mjs", "scripts/legacyRealLanguage/taxonomy.mjs", "scripts/legacyRealLanguage/runLegacyCorpus.mjs"];
const sourceHashes = Object.fromEntries(files.map((file) => [file, sha(readFileSync(path.join(root, file)))]));
const candidate = {
  tag, mode, scope, contextMode, promotionPolicyVersion: PROMOTION_POLICY_VERSION, commitmentPolicyVersion: COMMITMENT_POLICY_VERSION, sourceHashes,
  candidateHash: sha(Object.values(sourceHashes).join("")), contentHash: sha(readFileSync(path.join(root, "src/content/generated/appendicitis.json"))),
};

// ---- provider per mode
const requestHash = (request) => sha(JSON.stringify({ messages: request.messages, responseFormat: request.responseFormat }));
const modelCalls = {};
let gateway = null;
let providerForRow;
let recordedRun = null;
let budget = null;
let relaxedMs = null;
const replayStats = { requestChanged: [], notReplayable: [], used: 0 };
if (mode === "live") {
  const check = await preflight();
  if (check.status !== "PASS") throw new Error(`live_preflight_not_green:${check.status}${check.errorCode ? `:${check.errorCode}` : ""}`);
  candidate.model = check.config;
  const budgetFile = arg("--budget-file", ".onqol-legacy-real-language-budget.json");
  const pilotMaxUsd = Number(arg("--budget-usd", 2));
  if (!/^\.onqol-[a-z0-9-]+-budget\.json$/.test(budgetFile) || [".onqol-stage2-budget.json", ".onqol-interpreter-v3-budget.json", ".onqol-interpreter-v3a1-budget.json"].includes(budgetFile) || !(pilotMaxUsd > 0 && pilotMaxUsd <= 2)) {
    throw new Error("budget_invalid: use a NEW .onqol-<name>-budget.json ledger (never an existing one) with a ceiling in (0, 2] USD");
  }
  budget = { file: budgetFile, pilotMaxUsd };
  const journalDir = path.join(privateDir, "provider-journal");
  assertPrivateOutput(journalDir, root, "the provider journal (raw model responses quote the learner)");
  // Measurement-only relaxation (opt-in; product defaults are 6/7/8 s and are not changed): --relax-timeouts-ms N
  const relax = Number(arg("--relax-timeouts-ms", 0)) || null;
  if (relax) { candidate.timeouts = { gatewayMs: relax, providerMs: relax + 2000, hybridMs: relax + 4000, relaxedForMeasurement: true }; }
  else candidate.timeouts = { gatewayMs: 6000, providerMs: 7000, hybridMs: 8000, relaxedForMeasurement: false };
  gateway = await liveGateway({ budgetFile, limits: { pilotMaxUsd }, journalDir, ...(relax ? { timeoutMs: relax } : {}) });
  relaxedMs = relax;
  providerForRow = (row) => {
    const inner = gateway.provider(`legacy-${tag}-${row.id}`, relaxedMs ? relaxedMs + 2000 : undefined);
    return { isConfigured: true, async complete(request) {
      const result = await inner.complete(request);
      (modelCalls[row.id] ??= []).push({ requestHash: requestHash(request), text: result.text, meta: result.meta });
      return result;
    } };
  };
} else if (mode === "rescore") {
  recordedRun = JSON.parse(readFileSync(path.join(runsDir, `${arg("--recorded", "")}.json`), "utf8"));
  candidate.recorded = { tag: arg("--recorded"), candidateHash: recordedRun.candidate?.candidateHash, mode: recordedRun.candidate?.mode };
  candidate.candidateHash = recordedRun.candidate?.candidateHash;
  providerForRow = () => ({ isConfigured: false });
} else if (mode === "replay") {
  const recordedTag = arg("--recorded", null);
  if (!recordedTag) throw new Error("--recorded <tag> is required for replay");
  recordedRun = JSON.parse(readFileSync(path.join(runsDir, `${recordedTag}.json`), "utf8"));
  candidate.recorded = { tag: recordedTag, candidateHash: recordedRun.candidate?.candidateHash, mode: recordedRun.candidate?.mode };
  providerForRow = (row) => {
    const calls = recordedRun.modelCalls?.[row.id];
    let cursor = 0;
    return { isConfigured: true, async complete(request) {
      const recorded = calls?.[cursor];
      cursor += 1;
      if (!recorded) { replayStats.notReplayable.push(row.id); throw Object.assign(new Error("no_recorded_response"), { code: "no_recorded_response" }); }
      if (recorded.requestHash !== requestHash(request)) replayStats.requestChanged.push(row.id);
      replayStats.used += 1;
      modelCalls[row.id] = [...(modelCalls[row.id] ?? []), recorded];
      return { text: recorded.text, meta: { ...(recorded.meta ?? {}), costUsd: 0, replay: true } };
    } };
  };
} else providerForRow = () => ({ isConfigured: false, async complete() { throw new Error("no_provider"); } });

const originalFetch = globalThis.fetch;
if (mode !== "live") globalThis.fetch = () => { throw new Error("offline_run_must_not_use_the_network"); };
const evaluated = [];
try {
  if (mode === "rescore") {
    const byId = new Map(recordedRun.rows.map((row) => [row.id, row]));
    for (const row of rows) evaluated.push(byId.get(row.id));
  } else await evaluateV3Rows({
    rows, bundle: withShared(disease, shared), providerForRow, ...(relaxedMs ? { hybridTimeoutMs: relaxedMs + 4000 } : {}),
    afterRow: async (result) => { evaluated.push(result); },
  });
} finally { globalThis.fetch = originalFetch; if (gateway) await gateway.close(); }

// ---- score, tag, aggregate
const scored = (kind) => evaluated.map((row) => {
  const gold = goldOf.get(row.id);
  const score = scoreRow(row, kind, gold);
  return { row, gold, score };
});
const v3 = scored("v3");
const deterministic = scored("deterministic");
const tagged = v3.map(({ row, gold, score }) => ({ turnId: row.id, exact: score.exact, tags: classifyRow({ row, gold, score, turn: turns.find((t) => t.turnId === row.id) }) }));
const deterministicTagged = deterministic.map(({ row, gold, score }) => ({ turnId: row.id, exact: score.exact }));
// Rows whose label the 2026-09-20 review disputed are unresolved: reported in the frozen all-rows view AND without them.
const disputed = new Set(JSON.parse(readFileSync(path.join(evidenceDir, "LABEL_REVIEW_2026-09-20.json"), "utf8")).disputedRowIds);
const undisputed = (list) => list.filter(({ row }) => !disputed.has(row.id));
const metrics = { v3: aggregate(v3, "v3"), deterministicOnly: aggregate(deterministic, "deterministic"),
  v3ExcludingDisputed: aggregate(undisputed(v3), "v3"), deterministicOnlyExcludingDisputed: aggregate(undisputed(deterministic), "deterministic") };
const infrastructure = (() => {
  const consulted = evaluated.filter((r) => r.hybrid.semanticTelemetry?.called === true);
  const failed = consulted.filter((r) => r.hybrid.mode === "hybrid_fallback_deterministic");
  return { consulted: consulted.length, providerFailures: failed.length, errorCodes: Object.fromEntries([...new Set(failed.map((r) => r.hybrid.semanticTelemetry.errorCode))].map((c) => [c, failed.filter((r) => r.hybrid.semanticTelemetry.errorCode === c).length])),
    valid: mode === "rescore" || mode !== "live" || failed.length <= Math.floor(consulted.length * 0.05) };
})();
const status = mode === "rescore" ? "RESCORE_OF_RECORDED_RUN" : mode === "live" ? (infrastructure.valid ? "MEASURED_LIVE_DEVELOPMENT" : "INVALID_PROVIDER_FAILURES") : mode === "replay" ? "REPLAY_OF_RECORDED_MODEL_RESPONSES" : "DETERMINISTIC_ONLY";

const generatedAt = new Date().toISOString();
mkdirSync(runsDir, { recursive: true });
writeFileSync(outPrivate, JSON.stringify({
  schema: "onqol-legacy-real-language-run-v1", corpusHash, candidate, status, budget, infrastructure, replay: mode === "replay" ? replayStats : null,
  modelCalls, metrics, tagged, rows: evaluated, generatedAt,
}, null, 1) + "\n");

// Tracked evidence: ids, counts, tags. No words.
const tagCounts = {};
for (const row of tagged) for (const t of row.tags) tagCounts[t.class] = (tagCounts[t.class] ?? 0) + 1;
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(path.join(evidenceDir, `RUN_${tag}${scope === "IN_SCOPE" ? "" : "-oos"}.json`), JSON.stringify({
  schema: "onqol-legacy-real-language-run-evidence-v1", corpus: "legacy_real_language_development", corpusHash, scope,
  evidenceUse: "development_only_not_holdout_not_generalization", holdout: { touched: false }, status, candidate, budget, infrastructure,
  replay: mode === "replay" ? { requestChanged: replayStats.requestChanged.length, notReplayable: [...new Set(replayStats.notReplayable)], recordedResponsesUsed: replayStats.used } : null,
  targets: { v3: targetReport(metrics.v3), deterministicOnly: targetReport(metrics.deterministicOnly), v3ExcludingDisputed: targetReport(metrics.v3ExcludingDisputed) },
  metrics, failureClassCounts: tagCounts,
  perTurn: tagged.map((row) => ({ turnId: row.turnId, exact: row.exact, classes: [...new Set(row.tags.map((t) => t.class))] })),
  generatedAt, privateRun: path.relative(root, outPrivate),
}, null, 2) + "\n");

const b = metrics.v3;
console.log(JSON.stringify({
  tag, mode, scope, status, rows: b.rows, consulted: infrastructure.consulted, providerFailures: infrastructure.providerFailures,
  exact: [b.exactRows, b.exactAccuracy], exactAction: b.exactOnActionRows, exactRestraint: b.exactOnRestraintRows,
  precision: b.commandPrecision, recall: b.commandRecall, falseExec: b.falseExecutionCount, highRisk: b.highRiskFalseExecutionCount, invented: b.inventedParameterCount, spuriousClarify: b.spuriousClarificationCount,
  deterministicOnly: { exact: metrics.deterministicOnly.exactAccuracy, precision: metrics.deterministicOnly.commandPrecision, recall: metrics.deterministicOnly.commandRecall, falseExec: metrics.deterministicOnly.falseExecutionCount },
  excludingDisputed: (({ exactRows, rows, exactAccuracy, commandPrecision, commandRecall, falseExecutionCount, highRiskFalseExecutionCount, inventedParameterCount, spuriousClarificationCount }) => ({ exact: [exactRows, rows, exactAccuracy], precision: commandPrecision, recall: commandRecall, falseExec: falseExecutionCount, highRisk: highRiskFalseExecutionCount, invented: inventedParameterCount, spuriousClarify: spuriousClarificationCount }))(metrics.v3ExcludingDisputed),
  consultedRows: b.consultedRows, cost: b.costUsd, replay: mode === "replay" ? { used: replayStats.used, requestChanged: replayStats.requestChanged.length, notReplayable: [...new Set(replayStats.notReplayable)].length } : undefined,
  failureClassCounts: tagCounts,
}, null, 1));
