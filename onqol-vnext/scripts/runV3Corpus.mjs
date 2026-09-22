import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { preflight, root, liveGateway } from "./stage2Runtime.mjs";
import { evaluateV3Rows } from "./v3Evaluation.mjs";
import { goldAdjudicationTemplate, holdoutFingerprint, suiteRows, v3Corpus } from "./v3Corpus.mjs";
import { v3FreezeEligibility, v3Metrics } from "./v3Metrics.mjs";
import { withShared } from "../src/core/content/loadBundle.js";
import { HOLDOUT_MANIFEST_FILE } from "./holdoutManifest.mjs";
import { RESIDENT_MANIFEST } from "./evidenceGovernance.mjs";
import { PROMOTION_POLICY_VERSION } from "../src/ai/interpreter/promotionPolicy.js";
import { COMMITMENT_POLICY_VERSION } from "../src/ai/interpreter/commitmentPolicy.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

/**
 * Interpreter v3 corpus runner.
 *
 *   node scripts/runV3Corpus.mjs --suite development
 *
 * Only the DEVELOPMENT split can be run. Development numbers are diagnostic:
 * the original development rows were used to tune earlier candidates, so they
 * are NOT generalization evidence and can never lift a NO-GO. The frozen
 * holdout is refused here until v3FreezeEligibility() says otherwise - and
 * even then it is a separate, deliberate change, not a flag on this script.
 *
 * Every run writes a NEW evidence file (run1, run2, ...); nothing is overwritten,
 * so the history of candidate iterations stays auditable.
 */
const suiteArg = (process.argv[process.argv.indexOf("--suite") + 1] ?? "").toUpperCase();
const stamp = process.argv.includes("--date") ? process.argv[process.argv.indexOf("--date") + 1] : new Date().toISOString().slice(0, 10);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const evidenceDir = path.join(root, "docs/evidence");
const adjudicationFile = path.join(evidenceDir, "INTERPRETER_V3_GOLD_ADJUDICATION.json");
const holdoutManifest = JSON.parse(readFileSync(path.join(root, HOLDOUT_MANIFEST_FILE), "utf8"));
const residentManifestFile = path.join(root, RESIDENT_MANIFEST);
const residentManifest = existsSync(residentManifestFile) ? JSON.parse(readFileSync(residentManifestFile, "utf8")) : { turnCount: 0 };

const rows = v3Corpus();
mkdirSync(evidenceDir, { recursive: true });
if (!existsSync(adjudicationFile)) writeFileSync(adjudicationFile, JSON.stringify(goldAdjudicationTemplate(rows), null, 2) + "\n");
const adjudication = JSON.parse(readFileSync(adjudicationFile, "utf8"));
const eligibility = v3FreezeEligibility({ adjudication, realPilotTurns: residentManifest.turnCount ?? 0, independentGoldReview: false, frozen: false });

if (suiteArg === "HOLDOUT") {
  throw new Error(`v3_holdout_blocked: ${eligibility.blockers.join(", ") || "holdout runner is not part of this wave"}`);
}
if (suiteArg !== "DEVELOPMENT") throw new Error("use --suite development");

const fingerprint = holdoutFingerprint();
if (fingerprint.hash !== holdoutManifest.fingerprint.hash) throw new Error("v3_holdout_changed: the holdout no longer matches INTERPRETER_V3_HOLDOUT_MANIFEST.json");

const files = [
  "src/ai/interpreter/hybridInterpreter.js", "src/ai/interpreter/candidateArbitration.js", "src/ai/interpreter/actionCandidateValidation.js",
  "src/ai/interpreter/semanticConsultationPolicy.js", "src/ai/interpreter/promotionPolicy.js", "src/ai/interpreter/commitmentPolicy.js", "src/ai/interpreter/conceptGrounding.js",
  "src/ai/interpreter/modelConceptValidation.js", "src/ai/interpreter/splitSemanticInterpreter.js", "src/ai/interpreter/stage2ActionSchema.js",
  "src/ai/interpreter/semanticTaskSchemas.js", "src/ai/interpreter/deterministicParameterBinder.js", "src/ai/interpreter/deterministicInterpreter.js",
  "src/ai/interpreter/vocabulary.js", "src/ai/interpreter/textMatch.js", "src/ai/modelConfig.js", "scripts/v3Corpus.mjs", "scripts/v3Metrics.mjs", "scripts/v3Evaluation.mjs", "scripts/runV3Corpus.mjs",
];
const sourceHashes = Object.fromEntries(files.map((file) => [file, hash(readFileSync(path.join(root, file)))]));
const hashOf = (list) => hash(list.map((file) => sourceHashes[file]).join(""));
const existing = readdirSync(evidenceDir).filter((name) => name.startsWith(`INTERPRETER_V3_CORPUS_DEVELOPMENT_${stamp}-run`));
const tag = `${stamp}-run${existing.length + 1}`;
const outFile = path.join(evidenceDir, `INTERPRETER_V3_CORPUS_DEVELOPMENT_${tag}.json`);

const check = await preflight();
if (check.status !== "PASS") throw new Error(`v3_preflight_not_green:${check.status}`);
const dev = suiteRows(rows, "DEVELOPMENT");
const candidate = {
  tag, promotionPolicyVersion: PROMOTION_POLICY_VERSION, commitmentPolicyVersion: COMMITMENT_POLICY_VERSION, model: check.config,
  sourceHashes,
  promptHash: hashOf(["src/ai/interpreter/splitSemanticInterpreter.js"]),
  schemaHash: hashOf(["src/ai/interpreter/semanticTaskSchemas.js", "src/ai/interpreter/stage2ActionSchema.js"]),
  conceptRegistryHash: hashOf(["src/ai/interpreter/conceptGrounding.js", "src/ai/interpreter/vocabulary.js", "src/ai/interpreter/promotionPolicy.js", "src/ai/interpreter/commitmentPolicy.js"]),
  metricsHash: hashOf(["scripts/v3Metrics.mjs", "scripts/v3Corpus.mjs"]),
  contentHash: hash(readFileSync(path.join(root, "src/content/generated/appendicitis.json"))),
};
const header = {
  suite: "DEVELOPMENT", status: "RUNNING", candidate, evidenceUse: "development_diagnostic_only_not_generalization_evidence",
  holdout: { untouched: true, rows: fingerprint.rows, hash: fingerprint.hash, equalsHoldoutManifest: true },
  corpus: { rows: dev.length, groups: new Set(dev.map((r) => r.group)).size, fromStage2: dev.filter((r) => r.corpusVersion === "stage2").length, addedForV3: dev.filter((r) => r.corpusVersion === "v3").length },
  goldAdjudication: { file: path.relative(root, adjudicationFile), adjudicated: Object.values(adjudication.rows).filter((e) => e.decision).length, total: Object.keys(adjudication.rows).length },
  freezeEligibility: eligibility,
};
const write = (extra) => writeFileSync(outFile, JSON.stringify({ ...header, ...extra, generatedAt: new Date().toISOString() }, null, 2) + "\n");

// A separate ledger with the same per-call / per-session safeguards and a lower
// reservation ceiling. The Stage 2 ledger (.onqol-stage2-budget.json) is never touched.
// The defaults are the ledger the first v3 run used up; a later candidate names its own ledger
// (--budget-file / --budget-usd) with the owner's approval. A ceiling may only be lowered from $5.
const argOf = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const BUDGET = { file: argOf("--budget-file", ".onqol-interpreter-v3-budget.json"), pilotMaxUsd: Number(argOf("--budget-usd", 2)) };
if (!/^\.onqol-[a-z0-9-]+-budget\.json$/.test(BUDGET.file) || BUDGET.file === ".onqol-stage2-budget.json" || !(BUDGET.pilotMaxUsd > 0 && BUDGET.pilotMaxUsd <= 2)) throw new Error("v3_budget_invalid: use a separate .onqol-<name>-budget.json ledger with a ceiling in (0, 2] USD");
const gateway = await liveGateway({ budgetFile: BUDGET.file, limits: { pilotMaxUsd: BUDGET.pilotMaxUsd } });
const bundle = withShared(disease, shared);
const evaluated = [];
try {
  await evaluateV3Rows({
    rows: dev, bundle, providerForRow: (row) => gateway.provider(`v3-${tag}-${row.id}`),
    afterRow: async (result) => { evaluated.push(result); if (evaluated.length % 10 === 0) write({ progress: `${evaluated.length}/${dev.length}` }); },
  });
  const metrics = v3Metrics(evaluated, { adjudication });
  // A run whose provider failed is not a measurement of the interpreter. Fallbacks caused by
  // provider / transport errors above 5% of consulted turns make the run INVALID (reported, never used).
  const consulted = evaluated.filter((row) => row.hybrid.semanticTelemetry?.called === true);
  const providerFailures = consulted.filter((row) => row.hybrid.mode === "hybrid_fallback_deterministic");
  const infrastructure = { consulted: consulted.length, providerFailures: providerFailures.length,
    errorCodes: Object.fromEntries([...new Set(providerFailures.map((row) => row.hybrid.semanticTelemetry.errorCode))].map((code) => [code, providerFailures.filter((row) => row.hybrid.semanticTelemetry.errorCode === code).length])),
    valid: providerFailures.length <= Math.floor(consulted.length * 0.05), maxAllowedRate: 0.05 };
  write({ status: infrastructure.valid ? "MEASURED_DEVELOPMENT_DRAFT_GOLD_NO_GO" : "INVALID_PROVIDER_FAILURES", infrastructure, budget: BUDGET, verdict: "NO-GO", verdictReason: "development evidence on draft gold cannot lift NO-GO; see freezeEligibility", metrics, rows: evaluated, journalFile: gateway.journalFile });
  const { v3, deterministicOnly } = metrics;
  console.log(JSON.stringify({ file: path.relative(root, outFile), rows: evaluated.length, deterministicExact: deterministicOnly.exactFinalCommandSetAccuracy, v3Exact: v3.exactFinalCommandSetAccuracy,
    v3Precision: v3.commandPrecision, v3Recall: v3.commandRecall, falseExecution: v3.falseExecutionCount, invention: v3.parameterInventionCount, fallbackRate: v3.providerFallbackRate, p95: v3.latencyMs.p95, cost: v3.costUsd.total }, null, 1));
} catch (error) {
  write({ status: "FAILED", error: String(error?.message ?? error), rows: evaluated });
  throw error;
} finally { await gateway.close(); }
