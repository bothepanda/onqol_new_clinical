import process from "node:process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadStage2Env, liveGateway, root, providerKeyName } from "./stage2Runtime.mjs";
import { interpreterModelConfig } from "../src/ai/modelConfig.js";
import { interpretSemanticFirst, SEMANTIC_FIRST_VERSION } from "../src/ai/interpreter/semanticFirstInterpreter.js";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

// Development smoke only. These authored language examples are not clinical
// sources, a holdout, a scored resident assessment, or pilot-promotion evidence.
const rows = [
  { id: "paraphrase", text: "Пусть лаборант определит число белых клеток в крови", types: ["ORDER_TEST"], testId: "cbc" },
  { id: "examination", text: "Хочу пропальпировать живот у этого пациента", types: ["EXAMINE"], region: "abdomen" },
  { id: "conditional", text: "КТ только если состояние ухудшится", types: [] },
  { id: "negated", text: "Пока не назначаю кетопрофен", types: [] },
  { id: "literal-order", text: "Назначаю кетопрофен 100 мг в/м", types: ["ORDER_MEDICATION"], doseMg: 100, route: "im" },
  { id: "quoted-order", text: "Назначаю кетопрофен 100 мг в/в — это вопрос для обсуждения", types: [] },
];
if (!process.argv.includes("--live")) {
  console.log("Use --live to run six development calls through the configured gateway; maximum budget $0.20, no retries.");
} else {
  loadStage2Env();
  const config = interpreterModelConfig(process.env);
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(root, "docs/evidence/semantic-first");
  mkdirSync(dir, { recursive: true });
  const report = { runId, policyVersion: SEMANTIC_FIRST_VERSION, purpose: "development_smoke_only", retries: 0,
    corpusHash: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    model: config.model, totalRows: rows.length, results: [], status: "NOT_CONFIGURED" };
  let gateway;
  try {
    if (process.env[providerKeyName(config)]) {
      gateway = await liveGateway({ budgetFile: ".onqol-semantic-first-budget.json", limits: { pilotMaxUsd: 0.20 }, journalDir: path.join(dir, "provider-journal") });
      report.journalFile = gateway.journalFile;
      for (const row of rows) {
        const result = await interpretSemanticFirst({ text: row.text, bundle: withShared(disease, shared), provider: gateway.provider(`semantic-smoke-${runId}`) });
        const commands = result.commands.filter((command) => !["STATE_REASONING", "ANSWER_MENTOR"].includes(command.type));
        const pass = result.mode === "semantic_first" && JSON.stringify(commands.map((command) => command.type)) === JSON.stringify(row.types)
          && Object.entries(row).filter(([key]) => !["id", "text", "types"].includes(key)).every(([key, value]) => commands[0]?.params[key] === value);
        report.results.push({ ...row, pass, result });
        console.log(`${row.id}: ${pass ? "PASS" : result.mode === "semantic_first_unavailable" ? "UNAVAILABLE" : "FAIL"}`);
        // Do not spend the remaining budget after a transport/auth/quota issue.
        if (result.mode === "semantic_first_unavailable") break;
      }
      report.status = report.results.length === rows.length && report.results.every((row) => row.pass) ? "PASS" : "REVIEW";
    }
  } catch (error) {
    report.status = "BLOCKED";
    report.errorCode = error.code ?? error.name;
  } finally {
    if (gateway) { report.rawProviderResponses = gateway.raw; await gateway.close(); }
    report.unrunRows = rows.slice(report.results.length).map((row) => ({ ...row, status: "not_run" }));
    const file = path.join(dir, `${runId}.json`);
    writeFileSync(file, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(`${report.status}: ${file}`);
    if (report.status !== "PASS") process.exitCode = 1;
  }
}
