import assert from "node:assert/strict";
import test from "node:test";

import { repeatedEngineBlocks } from "../../../scripts/abMentorMetrics.mjs";

test("engine repeats are measured separately from mentor questions", () => {
  const repeated = "**Назначение записано:** эффект не моделируется.";
  const turns = [
    {
      reply: `${repeated}\n\nЧто делаешь дальше?\n\nВопрос ментора?`,
      engineReply: `${repeated}\n\nЧто делаешь дальше?`,
    },
    {
      reply: `${repeated}\n\nДругой вопрос ментора?`,
      engineReply: repeated,
    },
  ];

  assert.deepEqual(repeatedEngineBlocks(turns), [
    { block: repeated, first: 1, again: 2 },
  ]);
});

test("whitespace-only layout differences do not hide an engine repeat", () => {
  const repeats = repeatedEngineBlocks([
    { engineReply: "Назначение   записано.\nЭффект не моделируется." },
    { engineReply: "Назначение записано. Эффект не моделируется." },
  ]);
  assert.equal(repeats.length, 1);
});
