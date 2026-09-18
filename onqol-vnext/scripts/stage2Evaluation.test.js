import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createStage2Journal, createJournaledFetch } from "./stage2Journal.mjs";
import { evaluateStage2Rows } from "./stage2Evaluation.mjs";
import { stage2Metrics } from "./stage2Metrics.mjs";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

test("Stage2 journals the original malformed body before downstream processing and redacts credentials", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "onqol-stage2-journal-"));
  try {
    const journal = createStage2Journal(directory);
    const raw = [];
    const fetchImpl = createJournaledFetch({ journal, raw, apiKey: "fixture-secret", fetchImpl: async () => new Response("malformed fixture-secret", { status: 500 }) });
    const response = await fetchImpl("https://fixture.invalid");
    const stored = JSON.parse(readFileSync(journal.file, "utf8").trim());
    assert.equal(stored.status, 500);
    assert.equal(stored.rawBody, "malformed [REDACTED_API_KEY]");
    assert.equal(raw[0].payload, null);
    assert.equal(await response.text(), "malformed fixture-secret");
  } finally { rmSync(directory, { recursive: true }); }
});

test("Stage2 evaluator runs independent mock fixtures once and measures real command outcomes", async () => {
  const order = { type: "ORDER_TEST", params: { testId: "cbc" } };
  const rows = ["success", "quota"].map((id) => ({ id, category: "paraphrase", text: "общий анализ крови", turnContext: {},
    gold: { commands: [order], disposition: "commands" } }));
  let calls = 0;
  const sequence = [];
  const evaluated = await evaluateStage2Rows({ rows, bundle: withShared(disease, shared),
    beforeRow: async (row) => { sequence.push(`before:${row.id}`); },
    afterRow: async (row) => { sequence.push(`after:${row.id}`); },
    providerForRow: (row) => ({ isConfigured: true, async complete() {
      calls++;
      assert.equal(sequence.at(-1), `before:${row.id}`);
      if (row.id === "quota") throw Object.assign(new Error("quota"), { code: "provider_quota" });
      return { text: JSON.stringify({ clinicalActions: [{ ...order, evidenceSpans: ["общий анализ крови"], statedParameters: [] }],
        patientQuestions: [], ambiguities: [], unresolvedFragments: [], meta: { schemaVersion: "wave23-split-semantic-v1", confidence: 1 } }), meta: { model: "mock", costUsd: 0.001 } };
    } }),
  });
  assert.equal(calls, 2);
  assert.equal(evaluated.length, 2);
  assert.equal(evaluated[0].executedCommands[0].params.testId, "cbc");
  assert.equal(evaluated[1].hybrid.mode, "hybrid_fallback_deterministic");
  assert.equal(stage2Metrics(evaluated).paraphraseHybrid, 0.5);
  assert.equal(stage2Metrics(evaluated).executedCommandPrecision, 1);
  assert.deepEqual(sequence, ["before:success", "after:success", "before:quota", "after:quota"]);
});
