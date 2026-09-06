import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("debrief component contains the required guarded learner-facing sections", async () => {
  const source = await readFile(new URL("./DebriefPanel.jsx", import.meta.url), "utf8");
  for (const label of ["Ограничения ресурсов", "Ограничения симулятора", "Важные пропуски", "Скачать журнал кейса"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /referenceComparison\?\.available/);
  assert.match(source, /pilotReady === false/);
  assert.doesNotMatch(source, /numericScore|competenceScore/);
});
