import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = path.resolve(import.meta.dirname, "../../..");
const readProjectFile = (relativePath) =>
  readFileSync(path.join(projectRoot, relativePath), "utf8");

test("the learner-facing entry point mounts only the North Star trainer", () => {
  const app = readProjectFile("src/App.jsx");
  assert.match(app, /import V25Trainer from "\.\/V25Trainer"/);
  assert.doesNotMatch(app, /ONQOLTrainer|V2Trainer|V35Preview|URLSearchParams|version=/);
});

test("the prompt-driven V1 is physically outside the main source tree", () => {
  assert.equal(existsSync(path.join(projectRoot, "src/ONQOLTrainer.jsx")), false);
  assert.equal(existsSync(path.join(projectRoot, "legacy-v1/src/ONQOLTrainer.jsx")), true);
  const packageData = JSON.parse(readProjectFile("legacy-v1/package.json"));
  assert.equal(packageData.name, "onqol-v1-prototype");
  assert.match(packageData.version, /internal/);
});

test("the isolated V1 browser never receives a provider credential", () => {
  const v1Client = readProjectFile("legacy-v1/src/ONQOLTrainer.jsx");
  assert.match(v1Client, /fetch\("\/api\/anthropic"/);
  assert.match(v1Client, /sessionStorage\.getItem\(ACCESS_TOKEN_KEY\)/);
  assert.doesNotMatch(v1Client, /api\.anthropic\.com|x-api-key|dangerous-direct-browser-access/);
});

test("the main project no longer deploys the legacy public history endpoint", () => {
  assert.equal(existsSync(path.join(projectRoot, "api/history.js")), false);
  const packageData = JSON.parse(readProjectFile("package.json"));
  assert.equal(packageData.dependencies?.["@vercel/blob"], undefined);
});

test("main product ships same-origin production gateway handlers", () => {
  const postHandler = readProjectFile("api/v25/openai.js");
  const statusHandler = readProjectFile("api/v25/openai/status.js");
  assert.match(postHandler, /requireAccessControl:\s*true/);
  assert.match(statusHandler, /requireAccessControl:\s*true/);
  assert.doesNotMatch(postHandler + statusHandler, /VITE_OPENAI_API_KEY/);
});
