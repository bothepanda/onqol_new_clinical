#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildLearnerVisibleState } from "../src/core/state/learnerView.js";
import { interpretTurn } from "../src/ai/interpreter/interpretTurn.js";
import { runInterpreterShadow } from "../src/ai/interpreter/shadowInterpreter.js";
import { aggregateGoldMetrics, aggregateGoldMetricsByCategory, evaluateInterpretationAgainstGold } from "../src/ai/interpreter/shadowComparison.js";
import { WAVE2_SHADOW_CORPUS } from "../src/tests/fixtures/wave2ShadowCorpus.js";
import { baseSession, bundle } from "../src/tests/wave2ShadowCorpusRunner.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outputPath = path.join(root, "docs/evidence/WAVE21_LIVE_SHADOW_RAW_2026-08-28.json");
const model = process.env.ONQOL_AI_MODEL ?? "gpt-5-mini";
const apiKey = process.env.OPENAI_API_KEY;
const timeoutMs = Number(process.env.ONQOL_AI_TIMEOUT_MS ?? 30_000);
const startedAt = new Date().toISOString();

if (existsSync(outputPath) && process.env.ONQOL_ALLOW_WAVE21_BASELINE_OVERWRITE !== "1") {
  throw new Error("Wave 2.1 evidence is immutable; set ONQOL_ALLOW_WAVE21_BASELINE_OVERWRITE=1 only for an explicitly governed replacement run.");
}

if (!apiKey) {
  writeEvidence({
    evaluationVersion: "wave21-live-shadow-2026-08-28.1",
    status: "not_configured",
    reason: "OPENAI_API_KEY is absent from the evaluation process environment",
    provider: "openai_chat_completions",
    model,
    startedAt,
    completedAt: new Date().toISOString(),
    scheduledCalls: callSchedule().length,
    completedCalls: 0,
    semanticMetrics: null,
    metricsByCategory: null,
    safetyProbeMetrics: null,
    runs: [],
  });
  console.log(`wave21:live NOT CONFIGURED — 0/${callSchedule().length} calls; evidence written to ${path.relative(root, outputPath)}`);
  process.exit(0);
}

const provider = createLiveProvider({ apiKey, model, timeoutMs });
const learnerVisible = buildLearnerVisibleState(baseSession().state);
const runs = [];
for (const scheduled of callSchedule()) {
  const fixture = WAVE2_SHADOW_CORPUS.find((item) => item.id === scheduled.fixtureId);
  const deterministic = interpretTurn({ text: fixture.text, turnContext: {}, idPrefix: `${fixture.id}-${scheduled.repetition}` });
  const telemetry = await runInterpreterShadow({
    provider, text: fixture.text, locale: fixture.locale, learnerVisible, turnContext: {}, bundle, deterministic,
  });
  const output = telemetry.modelOutput ?? {};
  runs.push({
    fixtureId: fixture.id,
    suite: fixture.suite,
    category: fixture.category,
    repetition: scheduled.repetition,
    locale: fixture.locale,
    text: fixture.text,
    expected: fixture.expected,
    rawProviderOutput: telemetry.rawProviderOutput,
    validator: {
      status: telemetry.status,
      errorCode: telemetry.errorCode ?? null,
      schemaErrors: telemetry.schemaErrors,
      conceptErrors: telemetry.conceptErrors,
      commandValidation: telemetry.commandValidation,
      bindingDiagnostics: telemetry.bindingDiagnostics,
      boundCommands: telemetry.boundCommands,
      inventions: telemetry.inventions,
    },
    telemetry: {
      status: telemetry.status,
      elapsedMs: telemetry.elapsedMs,
      inventions: telemetry.inventions,
      providerMeta: telemetry.providerMeta,
    },
    evaluation: evaluateInterpretationAgainstGold({
      commands: telemetry.status === "valid" ? telemetry.boundCommands ?? [] : [],
      reasoningDelta: output.reasoningDelta,
      patientQuestions: output.patientQuestions,
      ambiguities: output.ambiguities,
      unresolvedFragments: output.unresolvedFragments,
      mentorAnswerDelta: output.mentorAnswerDelta,
      expected: fixture.expected,
    }),
    modelVsDeterministicDebug: telemetry.comparison,
  });
}

const semanticRuns = runs.filter((run) => run.suite === "semantic");
const safetyRuns = runs.filter((run) => run.suite === "safety_probe");
writeEvidence({
  evaluationVersion: "wave21-live-shadow-2026-08-28.1",
  status: "completed",
  provider: "openai_chat_completions",
  model,
  startedAt,
  completedAt: new Date().toISOString(),
  scheduledCalls: callSchedule().length,
  completedCalls: runs.length,
  semanticMetrics: aggregateGoldMetrics(semanticRuns),
  metricsByCategory: aggregateGoldMetricsByCategory(semanticRuns),
  safetyProbeMetrics: aggregateGoldMetrics(safetyRuns),
  runs,
});
console.log(`wave21:live OK — ${runs.length} calls (${model}) -> ${path.relative(root, outputPath)}`);

function callSchedule() {
  const schedule = [];
  for (const fixture of WAVE2_SHADOW_CORPUS.filter((item) => item.suite === "semantic")) {
    for (let repetition = 1; repetition <= 3; repetition += 1) schedule.push({ fixtureId: fixture.id, repetition });
  }
  for (const fixture of WAVE2_SHADOW_CORPUS.filter((item) => item.suite === "safety_probe")) {
    for (let repetition = 1; repetition <= 10; repetition += 1) schedule.push({ fixtureId: fixture.id, repetition });
  }
  return schedule;
}

function createLiveProvider({ apiKey: key, model: modelId, timeoutMs: requestTimeoutMs }) {
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
        const payload = await response.json();
        if (!response.ok) {
          const error = new Error(payload?.error?.code ?? `provider_http_${response.status}`);
          error.code = payload?.error?.code ?? `provider_http_${response.status}`;
          throw error;
        }
        return {
          text: payload.choices?.[0]?.message?.content,
          meta: { model: payload.model ?? modelId, requestId: response.headers.get("x-request-id") ?? null },
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function writeEvidence(value) {
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`);
}
