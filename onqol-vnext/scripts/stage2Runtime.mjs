import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createAiGateway } from "../server/aiGateway.mjs";
import { interpreterModelConfig } from "../src/ai/modelConfig.js";
import { createGatewayProviderClient } from "../src/ai/providerClient.js";
import { fileBudgetStore } from "../server/budgetStore.mjs";
import { createStage2Journal, createJournaledFetch } from "./stage2Journal.mjs";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const date = "2026-09-19-r2";
export function loadStage2Env() {
  if (existsSync(path.join(root, ".env.local"))) process.loadEnvFile(path.join(root, ".env.local"));
}
export function evidence(name, value) {
  const file = path.join(root, `docs/evidence/STAGE2_${name}_${date}.json`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...value, generatedAt: new Date().toISOString() }, null, 2) + "\n");
  return file;
}
// Which environment variable holds the key, and how the provider's own model
// list is queried, are the only two provider-specific facts the Stage 2 harness
// needs. Everything downstream goes through the provider-neutral gateway.
export function providerKeyName(config) {
  return config.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
}
function modelListRequest(config, apiKey) {
  return config.provider === "anthropic"
    ? ["https://api.anthropic.com/v1/models", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }]
    : ["https://api.openai.com/v1/models", { Authorization: `Bearer ${apiKey}` }];
}
export async function preflight() {
  loadStage2Env();
  const config = interpreterModelConfig(process.env);
  const apiKey = process.env[providerKeyName(config)];
  if (!apiKey) return { status: "NOT_CONFIGURED", provider: config.provider ?? "openai", config };
  try {
    const [url, headers] = modelListRequest(config, apiKey);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    const modelAvailable = data.data?.some((model) => model.id === config.model) === true;
    return { status: response.ok && modelAvailable ? "PASS" : "PROVIDER_UNAVAILABLE", httpStatus: response.status,
      provider: config.provider ?? "openai", modelAvailable,
      errorCode: data.error?.code ?? data.error?.type ?? null, config, keyRotationVerified: false };
  } catch (error) {
    return { status: "PROVIDER_UNAVAILABLE", provider: config.provider ?? "openai", errorCode: error.cause?.code ?? error.name, config };
  }
}
export async function liveGateway({ config = interpreterModelConfig(process.env), apiKey = process.env[providerKeyName(config)], budgetFile = ".onqol-stage2-budget.json", limits = {}, journalDir = path.join(root, "docs/evidence/stage2-provider-journal"), timeoutMs } = {}) {
  const raw = [];
  const journal = createStage2Journal(journalDir);
  const middleware = createAiGateway({ env: { ...process.env, [providerKeyName(config)]: apiKey }, budgetStore: fileBudgetStore(path.join(root, budgetFile)), limits, ...(timeoutMs ? { timeoutMs } : {}),
    fetchImpl: createJournaledFetch({ fetchImpl: globalThis.fetch, journal, raw, apiKey, journalFile: path.relative(root, journal.file) }),
  });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { raw, journalFile: path.relative(root, journal.file),
    provider(sessionId, clientTimeoutMs) { return createGatewayProviderClient({ ...(clientTimeoutMs ? { timeoutMs: clientTimeoutMs } : {}), endpoint: `http://127.0.0.1:${server.address().port}/api/ai/interpreter`, sessionId }); },
    async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}
