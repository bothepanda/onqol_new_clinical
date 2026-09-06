#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { notConfiguredEvidence, runWave22EvaluationSuite, wave22Schedule } from "../src/tests/wave22EvaluationRunner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
loadLocalEnvironment();

const requestedSuite = argument("--suite") ?? "all";
const suites = requestedSuite === "all" ? ["development", "holdout", "safety"] : [requestedSuite];
for (const suite of suites) if (!wave22Schedule()[suite]) throw new Error(`unknown_wave22_suite:${suite}`);

const model = process.env.ONQOL_AI_MODEL ?? "gpt-5-mini";
const apiKey = process.env.OPENAI_API_KEY;
const timeoutMs = Number(process.env.ONQOL_AI_TIMEOUT_MS ?? 30_000);
const outputPaths = {
  development: path.join(root, "docs/evidence/WAVE22_DEVELOPMENT_RAW_2026-08-29.json"),
  holdout: path.join(root, "docs/evidence/WAVE22_HOLDOUT_RAW_2026-08-29.json"),
  safety: path.join(root, "docs/evidence/WAVE22_SAFETY_PROBES_RAW_2026-08-29.json"),
};

if (!apiKey) {
  for (const suite of suites) {
    writeEvidence(outputPaths[suite], notConfiguredEvidence({
      suite,
      model,
      reason: "OPENAI_API_KEY is absent from the evaluation process environment and local project env files",
    }));
  }
  console.log(`wave22:live NOT CONFIGURED — ${suites.join(", ")}`);
  process.exit(0);
}

let callCount = 0;
const totalCalls = suites.reduce((sum, suite) => sum + wave22Schedule()[suite].length, 0);
const provider = createLiveProvider({
  apiKey,
  model,
  timeoutMs,
  onCallComplete() {
    callCount += 1;
    if (callCount === 1 || callCount % 10 === 0 || callCount === totalCalls) console.log(`wave22:live progress ${callCount}/${totalCalls}`);
  },
});

for (const suite of suites) {
  const evidence = await runWave22EvaluationSuite({ provider, suite, model });
  writeEvidence(outputPaths[suite], evidence);
  console.log(`wave22:${suite} OK — ${evidence.completedCalls}/${evidence.scheduledCalls} -> ${path.relative(root, outputPaths[suite])}`);
}

function createLiveProvider({ apiKey: key, model: modelId, timeoutMs: requestTimeoutMs, onCallComplete }) {
  return {
    async complete(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelId, messages: request.messages, response_format: request.responseFormat, store: false }),
          signal: controller.signal,
        });
        const rawBody = await response.text();
        let payload;
        try {
          payload = JSON.parse(rawBody);
        } catch {
          return {
            text: rawBody,
            rawPayload: rawBody,
            meta: { model: modelId, requestId: response.headers.get("x-request-id") ?? null, httpStatus: response.status },
          };
        }
        if (!response.ok) {
          const error = new Error(payload?.error?.code ?? `provider_http_${response.status}`);
          error.code = payload?.error?.code ?? `provider_http_${response.status}`;
          throw error;
        }
        return {
          text: payload.choices?.[0]?.message?.content,
          rawPayload: payload,
          meta: { model: payload.model ?? modelId, requestId: response.headers.get("x-request-id") ?? null, httpStatus: response.status },
        };
      } finally {
        clearTimeout(timeout);
        onCallComplete();
      }
    },
  };
}

function loadLocalEnvironment() {
  for (const name of [".env.local", ".env"]) {
    const candidate = path.join(root, name);
    if (!existsSync(candidate)) continue;
    process.loadEnvFile(candidate);
    break;
  }
}

function writeEvidence(outputPath, value) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
