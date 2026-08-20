import process from "node:process";
import { randomUUID } from "node:crypto";
import { buildV35Case } from "../src/clinical/v35/createCase.js";
import { createV25Session } from "../src/clinical/v25/engine.js";
import { buildSemanticRouterPrompt } from "../src/clinical/semanticRouter.js";
import { appendicitisRouterConceptMap } from "../src/clinical/diseases/appendicitis/router/conceptRegistry.js";

const target = String(process.env.ONQOL_SMOKE_URL || "").replace(/\/$/, "");
const accessToken = String(process.env.ONQOL_MAIN_ACCESS_TOKEN || "");
const cohortSize = Math.max(1, Math.min(12, Number(process.env.ONQOL_SMOKE_COHORT_SIZE) || 8));

if (!target || !accessToken) {
  process.stderr.write("ONQOL_SMOKE_URL and ONQOL_MAIN_ACCESS_TOKEN are required.\n");
  process.exit(2);
}
const url = new URL(target);
if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
  process.stderr.write("Cohort smoke requires HTTPS (localhost is allowed for development).\n");
  process.exit(2);
}

const headers = {
  Accept: "application/json",
  Authorization: `Bearer ${accessToken}`,
};
const statusResponse = await fetch(`${target}/api/v25/openai/status`, { headers });
const status = await statusResponse.json().catch(() => ({}));
if (!statusResponse.ok || !status.configured || !status.accessGranted) {
  process.stderr.write("Pilot status preflight failed.\n");
  process.exit(1);
}

async function oneResident(index) {
  const { caseData } = buildV35Case({
    seed: `cohort-smoke-${index}`,
    requestedPresetId: "APP-001",
  });
  const session = createV25Session({
    caseData,
    mode: "reference",
    seed: `cohort-smoke-${index}`,
  });
  const prompt = buildSemanticRouterPrompt({
    input: "соберу анамнез и осмотрю живот",
    caseData,
    session,
    locale: "ru",
    conceptMap: appendicitisRouterConceptMap,
  });
  const startedAt = Date.now();
  const response = await fetch(`${target}/api/v25/openai`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-ONQOL-Session-Id": `cohort-${index}-${randomUUID()}`,
    },
    body: JSON.stringify({ task: "router", prompt }),
  });
  const payload = await response.json().catch(() => ({}));
  return {
    resident: index + 1,
    ok: response.ok && Boolean(payload.output),
    status: response.status,
    wall_latency_ms: Date.now() - startedAt,
    provider_latency_ms: payload.telemetry?.latency_ms ?? null,
    total_tokens: payload.telemetry?.usage?.total_tokens ?? null,
  };
}

const startedAt = Date.now();
const results = await Promise.all(Array.from({ length: cohortSize }, (_, index) => oneResident(index)));
const latencies = results.map((entry) => entry.wall_latency_ms).sort((a, b) => a - b);
const summary = {
  target_origin: url.origin,
  cohort_size: cohortSize,
  successful: results.filter((entry) => entry.ok).length,
  failed: results.filter((entry) => !entry.ok).length,
  elapsed_ms: Date.now() - startedAt,
  latency_ms: {
    min: latencies[0] ?? null,
    median: latencies[Math.floor(latencies.length / 2)] ?? null,
    max: latencies.at(-1) ?? null,
  },
  results,
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.failed) process.exitCode = 1;
