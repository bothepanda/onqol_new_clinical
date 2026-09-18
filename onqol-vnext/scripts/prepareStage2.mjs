import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, copyFileSync, constants } from "node:fs";
import path from "node:path";
import process from "node:process";
import { root, evidence, date } from "./stage2Runtime.mjs";
import { stage2Corpus } from "./stage2Corpus.mjs";
import { interpreterModelConfig } from "../src/ai/modelConfig.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const rows = stage2Corpus();
const splits = { DEVELOPMENT: [], HOLDOUT: [] };
for (const row of rows) {
  const split = parseInt(hash(row.group).slice(0, 8), 16) % 4 === 0 ? "HOLDOUT" : "DEVELOPMENT";
  splits[split].push(row);
}
const files = ["src/ai/interpreter/hybridInterpreter.js", "src/ai/interpreter/splitSemanticInterpreter.js",
  "src/ai/interpreter/stage2ActionSchema.js", "src/ai/interpreter/semanticTaskSchemas.js", "src/ai/interpreter/modelConceptValidation.js",
  "src/ai/interpreter/deterministicParameterBinder.js", "src/ai/interpreter/deterministicInterpreter.js", "src/ai/interpreter/vocabulary.js",
  "src/ai/modelConfig.js", "src/ai/providerClient.js", "server/aiGateway.mjs", "server/budgetStore.mjs", "scripts/stage2Corpus.mjs",
  "scripts/stage2Metrics.mjs", "scripts/runStage2Corpus.mjs", "scripts/stage2Runtime.mjs", "scripts/stage2Journal.mjs", "scripts/stage2Evaluation.mjs",
  "src/core/session/submitLearnerTurn.js", "src/core/replay/exportSession.js"];
const sourceHashes = Object.fromEntries(files.map((file) => [file, hash(readFileSync(path.join(root, file)))]));
const manifest = { status: "CANDIDATE_FROZEN_NOT_ACCEPTANCE_ELIGIBLE", model: interpreterModelConfig(), sourceHashes,
  promptHash: sourceHashes["src/ai/interpreter/splitSemanticInterpreter.js"],
  contentHash: hash(readFileSync(path.join(root, "src/content/generated/appendicitis.json"))),
  sharedContentHash: hash(readFileSync(path.join(root, "src/content/generated/shared.json"))),
  corpusHash: hash(JSON.stringify(rows)), splitHashes: Object.fromEntries(Object.entries(splits).map(([key, value]) => [key, hash(JSON.stringify(value))])),
  total: rows.length, composition: Object.fromEntries([...new Set(rows.map((r) => r.category))].map((category) => [category, rows.filter((r) => r.category === category).length])),
  independentGoldReview: false, realPilotRequired: 60, realPilotAvailable: 9, missingRealPilotTurns: 51,
  holdoutConsumed: false, grouping: "Surface variants grouped; one pilot session never split across partitions.",
};
const manifestPath = path.join(root, `docs/evidence/STAGE2_FREEZE_MANIFEST_${date}.json`);
if (existsSync(manifestPath)) {
  const { generatedAt: _generatedAt, ...previous } = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (JSON.stringify(previous) !== JSON.stringify(manifest)) {
    if (!process.argv.includes("--revise-unconsumed-candidate")) throw new Error("stage2_freeze_changed: retain previous evidence; create a new version explicitly");
    const paths = [manifestPath, ...Object.keys(splits).map((suite) => path.join(root, `docs/evidence/STAGE2_CORPUS_${suite}_${date}.json`))];
    for (const file of paths.slice(1)) {
      const artifact = JSON.parse(readFileSync(file, "utf8"));
      if (artifact.callsAttempted || artifact.rowsAttempted || artifact.status !== "BLOCKED_BEFORE_CALLS") throw new Error("stage2_consumed_candidate_cannot_be_revised");
    }
    const archive = path.join(root, "docs/evidence/stage2-candidate-history", hash(JSON.stringify(previous)).slice(0, 16));
    mkdirSync(archive, { recursive: true });
    for (const file of paths) copyFileSync(file, path.join(archive, path.basename(file)), constants.COPYFILE_EXCL);
    writeCandidate();
  } else console.log("stage2:freeze unchanged");
} else writeCandidate();

function writeCandidate() {
  evidence("FREEZE_MANIFEST", manifest);
  for (const [suite, cases] of Object.entries(splits)) evidence(`CORPUS_${suite}`, {
    status: "BLOCKED_BEFORE_CALLS", reason: "provider_quota; 51 real pilot turns missing; draft gold requires independent review",
    suite, corpusHash: manifest.splitHashes[suite], metrics: null, callsAttempted: 0, rawProviderResponses: [],
    rows: cases.map((row) => ({ ...row, evaluationStatus: "NOT_RUN", rawProviderResponse: null, hybrid: null, deterministic: null })),
  });
  console.log(JSON.stringify({ status: manifest.status, total: rows.length, composition: manifest.composition,
    development: splits.DEVELOPMENT.length, holdout: splits.HOLDOUT.length }));
}
