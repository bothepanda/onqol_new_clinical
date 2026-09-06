import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";

import { COMMAND } from "../core/commands/commandTypes.js";
import { WAVE22_HOLDOUT_CORPUS, WAVE22_HOLDOUT_METADATA } from "./fixtures/wave22HoldoutCorpus.js";

const FROZEN_CORPUS_SHA256 = "7a612dc55ce9b3e80d4d6326ee38a46df2fdbf6f7932352af94a9bfc2168e9e6";

test("Wave 2.2 holdout is frozen before interpreter revision and remains unseen by development fixtures", () => {
  assert.equal(WAVE22_HOLDOUT_METADATA.frozenBeforeInterpreterRevision, true);
  assert.equal(WAVE22_HOLDOUT_CORPUS.length, 30);
  assert.equal(createHash("sha256").update(JSON.stringify(WAVE22_HOLDOUT_CORPUS)).digest("hex"), FROZEN_CORPUS_SHA256);
  assert.equal(new Set(WAVE22_HOLDOUT_CORPUS.map((fixture) => fixture.id)).size, 30);
});

test("Wave 2.2 holdout satisfies prespecified composition and current command contracts", () => {
  const noActionReasoningOrMentor = WAVE22_HOLDOUT_CORPUS.filter(
    (fixture) => ["reasoning", "mentor_answer"].includes(fixture.category) && fixture.expected.commands.length === 0,
  );
  assert.ok(noActionReasoningOrMentor.length >= 5);
  assert.ok(WAVE22_HOLDOUT_CORPUS.filter((fixture) => fixture.category === "vague_or_unsupported").length >= 5);
  assert.ok(WAVE22_HOLDOUT_CORPUS.filter((fixture) => fixture.category === "compound").length >= 5);
  for (const fixture of WAVE22_HOLDOUT_CORPUS) {
    for (const command of fixture.expected.commands) assert.ok(Object.values(COMMAND).includes(command.type), `${fixture.id}: ${command.type}`);
  }
});
