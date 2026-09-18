import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { preflight, root, date, liveGateway, evidence } from "./stage2Runtime.mjs";
import { stage2Metrics } from "./stage2Metrics.mjs";
import { evaluateStage2Rows } from "./stage2Evaluation.mjs";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

const suite = (process.argv[process.argv.indexOf("--suite") + 1] ?? "").toUpperCase();
if (!["DEVELOPMENT", "HOLDOUT"].includes(suite)) throw new Error("use --suite development or --suite holdout");
const artifact = JSON.parse(readFileSync(path.join(root, `docs/evidence/STAGE2_CORPUS_${suite}_${date}.json`), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(root, `docs/evidence/STAGE2_FREEZE_MANIFEST_${date}.json`), "utf8"));
if (artifact.callsAttempted > 0 || artifact.rowsAttempted > 0) throw new Error("stage2_suite_already_consumed_no_retry");
for (const [file, expected] of Object.entries(manifest.sourceHashes)) {
  if (createHash("sha256").update(readFileSync(path.join(root, file))).digest("hex") !== expected) throw new Error(`stage2_freeze_changed:${file}`);
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
if (hash(readFileSync(path.join(root, "src/content/generated/appendicitis.json"))) !== manifest.contentHash
  || hash(readFileSync(path.join(root, "src/content/generated/shared.json"))) !== manifest.sharedContentHash) throw new Error("stage2_content_changed");
const originalRows = artifact.rows.map(({ evaluationStatus: _evaluationStatus, rawProviderResponse: _rawProviderResponse, hybrid: _hybrid, deterministic: _deterministic, ...row }) => row);
if (hash(JSON.stringify(originalRows)) !== manifest.splitHashes[suite]) throw new Error("stage2_corpus_changed");
if (suite === "HOLDOUT" && (!manifest.independentGoldReview || manifest.realPilotAvailable < 60)) throw new Error("holdout_blocked_missing_real_pilot_and_gold_review");
const check = await preflight();
const smoke = JSON.parse(readFileSync(path.join(root, `docs/evidence/STAGE2_HYBRID_LIVE_SMOKE_${date}.json`), "utf8"));
if (check.status !== "PASS" || !smoke.validSchema) throw new Error("stage2_preflight_not_green");
if (JSON.stringify(check.config) !== JSON.stringify(manifest.model)) throw new Error("stage2_model_changed");
const gateway = await liveGateway();
const bundle = withShared(disease, shared);
const evaluated = [];
let rawStart = 0;
try {
  await evaluateStage2Rows({ rows: artifact.rows, bundle, providerForRow: (row) => gateway.provider(`stage2-${suite}-${row.id}`),
    beforeRow: async () => {
      rawStart = gateway.raw.length;
      artifact.rowsAttempted = (artifact.rowsAttempted ?? 0) + 1;
      artifact.status = "RUNNING";
      evidence(`CORPUS_${suite}`, { ...artifact, evaluated, journalFile: gateway.journalFile });
    },
    afterRow: async (result) => {
      if (result.hybrid.semanticTelemetry?.status !== "not_called") artifact.callsAttempted += 1;
      evaluated.push({ ...result, rawProviderResponse: gateway.raw.slice(rawStart) });
      evidence(`CORPUS_${suite}`, { ...artifact, evaluated, journalFile: gateway.journalFile });
    },
  });
  evidence(`CORPUS_${suite}`, { ...artifact, status: "MEASURED_DRAFT_GOLD_NO_GO", rows: evaluated, metrics: stage2Metrics(evaluated), rawProviderResponses: gateway.raw });
} finally { await gateway.close(); }
