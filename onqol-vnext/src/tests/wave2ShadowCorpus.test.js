import { test } from "node:test";
import assert from "node:assert/strict";

import { WAVE2_SHADOW_CORPUS } from "./fixtures/wave2ShadowCorpus.js";
import { runWave2ShadowCorpus } from "./wave2ShadowCorpusRunner.js";

test("Wave 2 regression corpus has at least 50 diverse language cases", () => {
  assert.ok(WAVE2_SHADOW_CORPUS.length >= 50);
  const categories = new Set(WAVE2_SHADOW_CORPUS.map((item) => item.category));
  for (const category of ["compound", "medication", "reasoning", "patient_question", "vague_or_unsupported", "provider_failure"]) {
    assert.ok(categories.has(category), `missing corpus category ${category}`);
  }
  assert.ok(WAVE2_SHADOW_CORPUS.some((item) => item.locale === "kk"));
  assert.ok(WAVE2_SHADOW_CORPUS.some((item) => item.locale === "en"));
  assert.deepEqual(WAVE2_SHADOW_CORPUS.filter((item) => item.suite === "safety_probe").map((item) => item.id), ["M04", "V04"]);
  assert.deepEqual(WAVE2_SHADOW_CORPUS.filter((item) => item.suite === "resilience").map((item) => item.id), ["A03", "A04"]);
});

test("Wave 2.1 corpus reports deterministic baseline and excludes injected cases from semantic metrics", async () => {
  const report = await runWave2ShadowCorpus();
  assert.equal(report.composition.totalFixtures, WAVE2_SHADOW_CORPUS.length);
  assert.equal(report.composition.semanticFixtures, WAVE2_SHADOW_CORPUS.length - 4);
  for (const metric of [
    "commandPrecision", "commandRecall", "canonicalExactTurnAgreement", "parameterFidelity",
    "unsupportedActionFalsePositiveRate", "reasoningDomainPrecision", "reasoningDomainRecall",
    "patientQuestionPrecision", "patientQuestionRecall", "unresolvedFragmentRecall",
  ]) {
    assert.ok(metric in report.deterministicBaselineVsGold.metrics, `missing metric ${metric}`);
  }
  assert.equal(report.injectedGuardrailValidation.rows.length, 2);
  assert.equal(report.injectedResilienceValidation.rows.length, 2);
  const medicationProbe = report.injectedGuardrailValidation.rows.find((row) => row.id === "M04");
  const tentativeProbe = report.injectedGuardrailValidation.rows.find((row) => row.id === "V04");
  assert.equal(medicationProbe.telemetry.inventions.afterBinder.highRisk.length, 0);
  assert.equal(tentativeProbe.telemetry.status, "concept_validation_failure");
  assert.ok(report.injectedResilienceValidation.rows.some((row) => row.telemetry.status === "provider_timeout"));
  assert.ok(report.injectedResilienceValidation.rows.some((row) => row.telemetry.status === "schema_validation_failure"));
});
