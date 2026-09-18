import { test } from "node:test";
import assert from "node:assert/strict";
import { stage2Metrics, stage2Gate } from "./stage2Metrics.mjs";

test("Stage2 failures remain in the paraphrase denominator and unknown cost stays unknown", () => {
  const command = { type: "ORDER_TEST", params: { testId: "cbc" } };
  const base = { text: "общий анализ крови", category: "paraphrase", gold: { commands: [command], disposition: "commands" },
    deterministic: { commands: [], unmatchedFragments: ["общий анализ крови"] }, elapsedMs: 100 };
  const metrics = stage2Metrics([
    { ...base, hybrid: { commands: [command] }, executedCommands: [command], costUsd: 0.001 },
    { ...base, hybrid: { mode: "hybrid_fallback_deterministic", commands: [] }, executedCommands: [], costUsd: null },
  ]);
  assert.equal(metrics.denominator, 2);
  assert.equal(metrics.paraphraseHybrid, 0.5);
  assert.equal(metrics.failuresRetained, 1);
  assert.equal(metrics.costUsd, null);
  assert.equal(stage2Gate(metrics, {}).verdict, "NO-GO");
});

test("Stage2 flags a parameter added without verbatim evidence", () => {
  const command = { type: "ORDER_MEDICATION", sourceText: "кетопрофен", params: { drugId: "ketoprofen", doseMg: 100, route: "iv" } };
  const metrics = stage2Metrics([{ text: "кетопрофен", category: "paraphrase", gold: { commands: [], disposition: "clarify" },
    hybrid: { commands: [command], semanticTelemetry: { addedCommands: [command] } }, elapsedMs: 10 }]);
  assert.equal(metrics.inventedParameters, 2);
});

test("Stage2 GO requires every prespecified gate, not only precision", () => {
  const metrics = { improvementPercentagePoints: 20, executedCommandPrecision: 0.98, inventedParameters: 0,
    ungroundedHighRiskCommands: 0, injectionCommands: 0, p95Ms: 8000 };
  const checks = { liveInjectionCoverage: true, failClosed: true, noRegression: true, sessionCostWithinLimit: true, corpusAndReview: true, providerAnswered: true };
  assert.equal(stage2Gate(metrics, checks).verdict, "GO");
  for (const key of Object.keys(checks)) assert.equal(stage2Gate(metrics, { ...checks, [key]: false }).verdict, "NO-GO");
  assert.equal(stage2Gate({ ...metrics, improvementPercentagePoints: 19.99 }, checks).verdict, "NO-GO");
});
