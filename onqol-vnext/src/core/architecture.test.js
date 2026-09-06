import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "..");

const SELF = path.join(SRC, "core/architecture.test.js");

function sourceFilesUnder(dir, { includeTests = false } = {}) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|jsx)$/.test(entry)) continue;
      if (full === SELF) continue; // this file names the forbidden terms in order to forbid them
      if (!includeTests && entry.includes(".test.")) continue;
      out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * Comments are stripped before scanning: this suite checks PRODUCT LOGIC,
 * and a comment explaining *why* the core must not know about appendicitis
 * is the opposite of a violation. Without this, the only way to keep the
 * test green would be to delete the explanations - which would make the
 * codebase worse in order to make a test pass.
 */
function logicOf(filePath) {
  return readFileSync(filePath, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/**
 * The scaling acceptance test (Core Runtime Spec §63/§71, task brief
 * P0-6 and §17 regression #29).
 *
 * The core and the AI layer must not know that this particular disease is
 * appendicitis. If they do, every future disease module costs engine
 * changes, which is the exact failure the whole architecture exists to
 * prevent. This is checked mechanically rather than by inspection, because
 * an inspection claim silently rots and this does not - it was in fact
 * FALSE when this test was first written: `executeCommand.js` branched on
 * the literal choice ids "appendectomy_only"/"appendectomy_plus_aspiration"
 * and hardcoded the complication id "superficial_ssi".
 */
const DISEASE_SPECIFIC_TERMS = [
  "appendectomy",
  "appendicitis",
  "appendix",
  "аппендэктом",
  "аппендицит",
  "аппендикс",
  "superficial_ssi",
  "retrocecal",
  "ретроцекальн",
];

test("no disease-specific string appears in src/core/** product logic", () => {
  const offenders = [];
  for (const file of sourceFilesUnder(path.join(SRC, "core"))) {
    const text = logicOf(file).toLowerCase();
    for (const term of DISEASE_SPECIFIC_TERMS) {
      if (text.includes(term.toLowerCase())) offenders.push(`${path.relative(SRC, file)} contains "${term}"`);
    }
  }
  assert.deepEqual(offenders, [], `disease-specific logic leaked into core:\n${offenders.join("\n")}`);
});

test("no disease-specific string appears in src/ai/** product logic", () => {
  const offenders = [];
  for (const file of sourceFilesUnder(path.join(SRC, "ai"))) {
    const text = logicOf(file).toLowerCase();
    for (const term of DISEASE_SPECIFIC_TERMS) {
      if (text.includes(term.toLowerCase())) offenders.push(`${path.relative(SRC, file)} contains "${term}"`);
    }
  }
  assert.deepEqual(offenders, [], `disease-specific logic leaked into the AI layer:\n${offenders.join("\n")}`);
});

/**
 * Task brief §7.1: the synthetic learner-facing preop shortcut must not
 * exist at all. Keeping it "just for tests" is what let the previous build
 * claim a working preoperative workflow that no learner could actually
 * reach, so its absence is asserted rather than merely intended.
 */
test("COMPLETE_PREOP_ITEM does not exist anywhere in the codebase", () => {
  const offenders = [];
  for (const dir of ["core", "ai", "app", "ui"]) {
    for (const file of sourceFilesUnder(path.join(SRC, dir), { includeTests: true })) {
      if (logicOf(file).includes("COMPLETE_PREOP_ITEM")) offenders.push(path.relative(SRC, file));
    }
  }
  assert.deepEqual(offenders, []);
});

/**
 * Task brief §17 regression #30 / §24.21: the legacy runtime is read-only
 * reference and must never be imported by the new build.
 */
test("no source file imports the legacy onqol-trainer runtime", () => {
  const offenders = [];
  for (const dir of ["core", "ai", "app", "ui"]) {
    for (const file of sourceFilesUnder(path.join(SRC, dir), { includeTests: true })) {
      const text = logicOf(file);
      if (/onqol-trainer|\.\.\/\.\.\/\.\.\/onqol-trainer/.test(text)) offenders.push(path.relative(SRC, file));
    }
  }
  assert.deepEqual(offenders, []);
});

/**
 * Task brief §14 / §17 regression #28: the learner sidebar is an allowlist,
 * and the way it stays one is by never being handed anything else.
 */
test("the session sidebar receives only allowlisted props", () => {
  const source = readFileSync(path.join(SRC, "app/App.jsx"), "utf8");
  const usage = /<SessionSidebar([\s\S]*?)\/>/.exec(source);
  assert.ok(usage, "SessionSidebar must be rendered by App.jsx");

  const props = [...usage[1].matchAll(/(\w+)=/g)].map((match) => match[1]);
  const allowed = ["locale", "clockRoot", "elapsedMinutes", "vitalsSnapshot", "constraints", "onDownload"];
  const unexpected = props.filter((prop) => !allowed.includes(prop));
  assert.deepEqual(unexpected, [], `sidebar received non-allowlisted props: ${unexpected.join(", ")}`);

  const forbidden = ["state.mentor", "state.pending", "workflow", "seed", "truth", "ruleId"];
  for (const term of forbidden) {
    assert.equal(usage[1].includes(term), false, `sidebar must never receive ${term}`);
  }
});
