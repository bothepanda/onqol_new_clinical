/**
 * Hybrid interpreter (wave §4-§7, §18). The semantic task is injected so CI is
 * deterministic and needs no provider; a separate live smoke exercises the real
 * gateway.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { interpretHybrid } from "./hybridInterpreter.js";
import diseaseBundle from "../../content/generated/appendicitis.json" with { type: "json" };
import sharedBundle from "../../content/generated/shared.json" with { type: "json" };
import { withShared } from "../../core/content/loadBundle.js";

const bundle = withShared(diseaseBundle, sharedBundle);
const provider = { isConfigured: true, async complete() { throw new Error("should be stubbed via runSemantic"); } };

const base = (text, extra = {}) => ({
  text, turnContext: {}, bundle, idPrefix: "t0", provider, locale: "ru", ...extra,
});

test("a turn the deterministic path fully resolves never calls the model", async () => {
  let called = false;
  const result = await interpretHybrid(base("оак и кт обп", {
    runSemantic: async () => { called = true; return { status: "valid", acceptedCommands: [] }; },
  }));
  assert.equal(called, false);
  assert.equal(result.mode, "deterministic");
  assert.deepEqual(result.commands.map((c) => c.params.testId), ["cbc", "ct_abdomen"]);
});

test("no configured provider => deterministic, even with an unresolved fragment", async () => {
  const result = await interpretHybrid(base("сделай манипуляцию X", { provider: { isConfigured: false } }));
  assert.equal(result.mode, "deterministic");
});

test("a provider failure falls back to the deterministic reading unchanged (fail closed)", async () => {
  // deterministic resolves the analgesia part and leaves the rest unmatched
  const result = await interpretHybrid(base("обезболить и сделай процедуру Z", {
    runSemantic: async () => ({ status: "provider_error", elapsedMs: 12 }),
  }));
  assert.equal(result.mode, "hybrid_fallback_deterministic");
  assert.equal(result.semanticTelemetry.status, "fallback");
  // the deterministic reading is intact - analgesia intent still there,
  // the unresolved fragment still surfaces
  assert.ok(result.commands.some((c) => c.type === "ORDER_MEDICATION"));
  assert.ok((result.unmatchedFragments ?? []).some((f) => /процедуру z/i.test(f)));
});

test("a thrown/timed-out semantic call also fails closed", async () => {
  const result = await interpretHybrid(base("сделай непонятную вещь", {
    runSemantic: () => new Promise((_, reject) => setTimeout(() => reject(new Error("boom")), 5)),
    timeoutBudgetMs: 50,
  }));
  assert.equal(result.mode, "hybrid_fallback_deterministic");
});

test("valid semantic commands are ADDED to the deterministic reading, never substituted", async () => {
  // Deterministic gets "оак" and leaves "оцените состояние желчного" unmatched;
  // the model resolves that paraphrase to an ultrasound order.
  const result = await interpretHybrid(base("оак и оцените состояние желчного", {
    runSemantic: async () => ({
      status: "valid",
      elapsedMs: 30,
      providerMeta: { model: "test" },
      proposedCommands: [{ type: "ORDER_TEST", params: { testId: "ultrasound_abdomen" }, evidence: "оцените состояние желчного" }],
      acceptedCommands: [{ type: "ORDER_TEST", params: { testId: "ultrasound_abdomen" }, evidenceSpans: ["оцените состояние желчного"], evidence: "оцените состояние желчного" }],
    }),
  }));
  assert.equal(result.mode, "hybrid");
  const ids = result.commands.filter((c) => c.type === "ORDER_TEST").map((c) => c.params.testId);
  assert.ok(ids.includes("cbc"), "deterministic command kept");
  assert.ok(ids.includes("ultrasound_abdomen"), "semantic command added");
  assert.equal(result.semanticTelemetry.added, 1);
  assert.equal(result.semanticTelemetry.clinicalAuthority, "none");
});

test("a semantic command duplicating a deterministic one (same type+concept) is dropped", async () => {
  // "разверни коагулограмму" is unmatched by deterministic; the model returns
  // BOTH a new coagulation order and a duplicate of the deterministic cbc.
  const result = await interpretHybrid(base("оак и разверни коагулограмму по факту", {
    runSemantic: async () => ({
      status: "valid",
      acceptedCommands: [
        { type: "ORDER_TEST", params: { testId: "cbc" }, evidenceSpans: ["оак"], evidence: "оак" },
        { type: "ORDER_TEST", params: { testId: "coagulation" }, evidenceSpans: ["разверни коагулограмму по факту"], evidence: "разверни коагулограмму по факту" },
      ],
    }),
  }));
  const cbcOrders = result.commands.filter((c) => c.type === "ORDER_TEST" && c.params.testId === "cbc");
  assert.equal(cbcOrders.length, 1, "cbc not doubled");
});

test("valid-but-empty semantic result keeps the deterministic reading and its unresolved fragments", async () => {
  const result = await interpretHybrid(base("сделай рентген черепа", {
    runSemantic: async () => ({ status: "valid", acceptedCommands: [], elapsedMs: 20 }),
  }));
  assert.equal(result.mode, "hybrid");
  assert.ok((result.unmatchedFragments ?? []).length > 0, "the fragment still surfaces to the learner");
});
