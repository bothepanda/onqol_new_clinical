// ТЗ §5: fluids_01 must exercise the REUSABLE mentor pipeline. Any conversational
// behaviour named after a case in the mentor / core code would defeat the point.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}
const productCode = (dir) => walk(path.join(ROOT, dir)).filter((f) => /\.(js|jsx|mjs)$/.test(f) && !/\.test\.js$/.test(f));

test("no mentor, core, interpreter or renderer code names the fluids case or has a case-named file", () => {
  const offenders = [];
  for (const file of ["ai", "core", "app"].flatMap(productCode)) {
    if (/fluids?[-_]?0?1|fluidsMentor|fluidsTutor/i.test(path.basename(file))) offenders.push(`file: ${file}`);
    const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    if (/FLUIDS-01|fluids_01|fluids01|["']fluids\./i.test(source) && !file.endsWith("featureFlags.js")) offenders.push(`content ref: ${file}`);
  }
  assert.deepEqual(offenders, []);
});

test("the mentor library, teaching issues and cards are content: they live under src/content", () => {
  const files = walk(path.join(ROOT, "content")).map((f) => path.relative(ROOT, f));
  assert.ok(files.includes("content/mentor/fluids01-library.json"));
  assert.ok(files.includes("content/diseases/fluids_01/rules.yaml"));
});
