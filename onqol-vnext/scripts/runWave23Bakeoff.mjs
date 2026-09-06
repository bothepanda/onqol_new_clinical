#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { notConfiguredWave23Evidence, runWave23EvaluationSuite } from "../src/tests/wave23EvaluationRunner.js";
import { verifyWave23FreezeManifest, writeWave23FreezeManifest } from "./freezeWave23.mjs";
import { wave23ModelConfigurations } from "./wave23Config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
loadLocalEnvironment();

const suiteArgument = argument("--suite") ?? "all";
const suites = suiteArgument === "all" ? ["development", "holdout", "safety"] : [suiteArgument];
for (const suite of suites) if (!new Set(["development", "holdout", "safety"]).has(suite)) throw new Error(`unknown_wave23_suite:${suite}`);
const allCandidates = wave23ModelConfigurations();
const candidateArgument = argument("--candidate");
const candidates = candidateArgument ? allCandidates.filter((item) => item.id === candidateArgument) : allCandidates;
if (!candidates.length) throw new Error(`unknown_wave23_candidate:${candidateArgument}`);
const concurrency = Number(argument("--concurrency") ?? process.env.ONQOL_WAVE23_CONCURRENCY ?? 4);
const timeoutMs = Number(process.env.ONQOL_WAVE23_TIMEOUT_MS ?? 45_000);
const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  for (const suite of suites) for (const candidate of candidates) {
    const evidence = notConfiguredWave23Evidence({
      suite, candidate, reason: "OPENAI_API_KEY is absent from the evaluation process environment and approved local project env files",
    });
    writeEvidence(evidencePath(suite, candidate.id), evidence);
  }
  console.log("wave23:bakeoff NOT CONFIGURED — no provider calls were made");
  process.exit(0);
}

for (const suite of suites) {
  if (suite === "holdout") ensureFrozen();
  for (const candidate of candidates) {
    let lastProgress = 0;
    const provider = createOpenAIProvider({ apiKey, candidate, timeoutMs });
    const evidence = await runWave23EvaluationSuite({
      provider, suite, candidate, concurrency,
      onProgress({ completed, total }) {
        if (completed === 1 || completed === total || completed - lastProgress >= 20) {
          lastProgress = completed;
          console.log(`wave23:${suite}:${candidate.id} progress ${completed}/${total}`);
        }
      },
    });
    const outputPath = evidencePath(suite, candidate.id);
    writeEvidence(outputPath, evidence);
    console.log(`wave23:${suite}:${candidate.id} COMPLETE — ${evidence.completedCalls}/${evidence.scheduledCalls} -> ${path.relative(root, outputPath)}`);
  }
  if (suite === "development" && suites.includes("holdout")) {
    const manifest = writeWave23FreezeManifest();
    console.log(`wave23:freeze CREATED before holdout — ${manifest.holdout.canonicalFingerprint}`);
  }
}

function ensureFrozen() {
  const verification = verifyWave23FreezeManifest();
  if (!verification.ok) throw new Error(`wave23_holdout_blocked:${verification.errors.join(",")}`);
}

function createOpenAIProvider({ apiKey: key, candidate, timeoutMs: requestTimeoutMs }) {
  return {
    async complete(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      const endpoint = candidate.endpointMode === "responses"
        ? "https://api.openai.com/v1/responses"
        : "https://api.openai.com/v1/chat/completions";
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(candidate.endpointMode === "responses"
            ? responsesBody(candidate, request)
            : chatCompletionsBody(candidate, request)),
          signal: controller.signal,
        });
        const rawBody = await response.text();
        let payload;
        try { payload = JSON.parse(rawBody); } catch { payload = rawBody; }
        const requestId = response.headers.get("x-request-id") ?? null;
        if (!response.ok) {
          const error = new Error(typeof payload === "object" ? payload?.error?.code ?? `provider_http_${response.status}` : `provider_http_${response.status}`);
          error.code = typeof payload === "object" ? payload?.error?.code ?? `provider_http_${response.status}` : `provider_http_${response.status}`;
          error.statusKind = "provider_http_error";
          error.providerEvidence = Object.freeze({
            captured: true,
            rawProviderPayload: payload,
            rawProviderOutput: null,
            returnedModelMetadata: providerMeta({ candidate, payload, requestId, httpStatus: response.status }),
          });
          throw error;
        }
        return {
          text: candidate.endpointMode === "responses" ? responseOutputText(payload) : payload.choices?.[0]?.message?.content,
          rawPayload: payload,
          meta: providerMeta({ candidate, payload, requestId, httpStatus: response.status }),
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function responsesBody(candidate, request) {
  const body = {
    model: candidate.model,
    input: request.messages,
    text: { format: {
      type: "json_schema",
      name: request.responseFormat.json_schema.name,
      strict: request.responseFormat.json_schema.strict,
      schema: request.responseFormat.json_schema.schema,
    } },
    store: false,
  };
  if (candidate.reasoningEffort) body.reasoning = { effort: candidate.reasoningEffort };
  if (candidate.temperature != null) body.temperature = candidate.temperature;
  if (candidate.serviceTier && candidate.serviceTier !== "default") body.service_tier = candidate.serviceTier;
  return body;
}

function chatCompletionsBody(candidate, request) {
  const body = { model: candidate.model, messages: request.messages, response_format: request.responseFormat, store: false };
  if (candidate.reasoningEffort) body.reasoning_effort = candidate.reasoningEffort;
  if (candidate.temperature != null) body.temperature = candidate.temperature;
  if (candidate.serviceTier && candidate.serviceTier !== "default") body.service_tier = candidate.serviceTier;
  return body;
}

function responseOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) if (content.type === "output_text" && typeof content.text === "string") return content.text;
  }
  return null;
}

function providerMeta({ candidate, payload, requestId, httpStatus }) {
  const usage = payload && typeof payload === "object" ? payload.usage ?? null : null;
  return {
    configuredModel: candidate.model,
    model: payload && typeof payload === "object" ? payload.model ?? candidate.model : candidate.model,
    candidateId: candidate.id,
    provider: candidate.provider,
    endpointMode: candidate.endpointMode,
    reasoningEffort: candidate.reasoningEffort,
    temperature: candidate.temperature,
    serviceTier: candidate.serviceTier,
    requestId,
    httpStatus,
    usage: usage ? {
      inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
      outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
      totalTokens: usage.total_tokens ?? 0,
      raw: usage,
    } : null,
    pricing: candidate.pricing,
  };
}

function evidencePath(suite, candidateId) {
  const label = candidateId.replace(/[^A-Za-z0-9_-]/g, "_").toUpperCase();
  const prefix = suite === "safety" ? "WAVE23_SAFETY" : suite === "holdout" ? "WAVE23_HOLDOUT" : "WAVE23_DEVELOPMENT";
  return path.join(root, `docs/evidence/${prefix}_${label}_2026-08-29.json`);
}
function writeEvidence(outputPath, value) { mkdirSync(path.dirname(outputPath), { recursive: true }); writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`); }
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function loadLocalEnvironment() {
  for (const candidate of [path.join(root, ".env.local"), path.join(root, ".env"), path.join(root, "../onqol-trainer/.env.local")]) {
    if (!existsSync(candidate)) continue;
    process.loadEnvFile(candidate);
    break;
  }
}
