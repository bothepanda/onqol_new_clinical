import { test } from "node:test";
import assert from "node:assert/strict";

import { SEMANTIC_TASK, WAVE23_SCHEMA_VERSION } from "../ai/interpreter/semanticTaskSchemas.js";
import { WAVE23_DEVELOPMENT_CORPUS, WAVE23_DEVELOPMENT_METADATA } from "./fixtures/wave23DevelopmentCorpus.js";
import { WAVE23_HOLDOUT_CORPUS, WAVE23_HOLDOUT_METADATA } from "./fixtures/wave23HoldoutCorpus.js";
import { runWave23EvaluationSuite, WAVE23_SAFETY_FIXTURES, wave23CallSchedule } from "./wave23EvaluationRunner.js";

const meta = { schemaVersion: WAVE23_SCHEMA_VERSION, confidence: 1 };

test("Wave 2.3 development corpus has the frozen 120-turn composition", () => {
  assert.equal(WAVE23_DEVELOPMENT_CORPUS.length, 120);
  assert.equal(WAVE23_DEVELOPMENT_METADATA.fixtureCount, 120);
  assert.equal(new Set(WAVE23_DEVELOPMENT_CORPUS.map((fixture) => fixture.text)).size, 120);
  assert.deepEqual(countByCategory(WAVE23_DEVELOPMENT_CORPUS), WAVE23_DEVELOPMENT_METADATA.composition);
});

test("Wave 2.3 untouched holdout has 80 unique turns and required task coverage", () => {
  assert.equal(WAVE23_HOLDOUT_CORPUS.length, 80);
  assert.equal(WAVE23_HOLDOUT_METADATA.fixtureCount, 80);
  assert.equal(WAVE23_HOLDOUT_METADATA.frozenBeforeFinalCandidateTuning, true);
  assert.equal(new Set(WAVE23_HOLDOUT_CORPUS.map((fixture) => fixture.text)).size, 80);
  assert.equal(WAVE23_HOLDOUT_CORPUS.filter((fixture) => fixture.id.startsWith("H-A")).length, 40);
  assert.equal(WAVE23_HOLDOUT_CORPUS.filter((fixture) => fixture.id.startsWith("H-R")).length, 25);
  assert.equal(WAVE23_HOLDOUT_CORPUS.filter((fixture) => fixture.id.startsWith("H-M")).length, 15);
});

test("Wave 2.3 safety suite keeps M04/V04 and adds S03-S06", () => {
  assert.deepEqual(WAVE23_SAFETY_FIXTURES.map((fixture) => fixture.id), ["M04", "V04", "S03", "S04", "S05", "S06"]);
  assert.equal(wave23CallSchedule("safety").length, 120);
});

test("evaluation reports task metrics independently and captures usage economics", async () => {
  const candidate = {
    id: "FIXTURE", provider: "fixture", endpointMode: "responses", model: "fixture-model",
    reasoningEffort: "low", temperature: null, serviceTier: "default",
    pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 },
  };
  const provider = {
    async complete(request) {
      const output = request.task === SEMANTIC_TASK.ACTION
        ? { clinicalActions: [], patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta }
        : request.task === SEMANTIC_TASK.REASONING
          ? { reasoningDelta: {}, ambiguities: [], meta }
          : { answered: false, mentorAnswerDelta: { domains: [], evidenceSpans: [], completeness: "none", stuck: false }, reasoningDelta: {}, ambiguities: [], meta };
      return { output, meta: { model: "fixture-snapshot", usage: { inputTokens: 10, outputTokens: 5 } } };
    },
  };
  const result = await runWave23EvaluationSuite({ provider, suite: "development", candidate, concurrency: 8 });
  assert.equal(result.completedCalls, 240);
  assert.equal(result.taskCallCounts[SEMANTIC_TASK.ACTION], 120);
  assert.equal(result.taskCallCounts[SEMANTIC_TASK.REASONING], 110);
  assert.equal(result.taskCallCounts[SEMANTIC_TASK.MENTOR_ANSWER], 10);
  assert.equal(result.metricsByTask[SEMANTIC_TASK.ACTION].runs, 120);
  assert.equal(result.metricsByTask[SEMANTIC_TASK.REASONING].runs, 110);
  assert.equal(result.metricsByTask[SEMANTIC_TASK.MENTOR_ANSWER].runs, 10);
  assert.equal(result.economics[SEMANTIC_TASK.ACTION].inputTokens, 1200);
  assert.equal(result.authority, "none");
});

function countByCategory(corpus) {
  return Object.fromEntries([...new Set(corpus.map((fixture) => fixture.category))].map((category) => [
    category, corpus.filter((fixture) => fixture.category === category).length,
  ]));
}
