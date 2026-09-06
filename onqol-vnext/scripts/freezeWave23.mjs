#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { WAVE23_DEVELOPMENT_CORPUS, WAVE23_DEVELOPMENT_METADATA } from "../src/tests/fixtures/wave23DevelopmentCorpus.js";
import { WAVE23_HOLDOUT_CORPUS, WAVE23_HOLDOUT_METADATA } from "../src/tests/fixtures/wave23HoldoutCorpus.js";
import { wave23ModelConfigurations } from "./wave23Config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
export const WAVE23_MANIFEST_PATH = path.join(root, "docs/evidence/WAVE23_FREEZE_MANIFEST_2026-08-29.json");

const CONTRACT_FILES = Object.freeze([
  "src/ai/interpreter/semanticTaskSchemas.js",
  "src/ai/interpreter/splitSemanticInterpreter.js",
  "src/ai/interpreter/modelConceptValidation.js",
  "src/ai/interpreter/deterministicParameterBinder.js",
  "src/tests/wave23EvaluationRunner.js",
  "src/tests/fixtures/wave23HoldoutCorpus.js",
  "scripts/wave23Config.mjs",
]);

export function buildWave23FreezeManifest({ env = process.env, frozenAt = new Date().toISOString() } = {}) {
  const configurations = wave23ModelConfigurations(env);
  return {
    manifestVersion: "wave23-freeze-2026-08-29.1",
    frozenAt,
    authority: "none",
    wave3: "blocked",
    rule: "No prompt, schema, validator, binder, model configuration, or holdout change after first holdout inspection.",
    files: Object.fromEntries(CONTRACT_FILES.map((relativePath) => [relativePath, sha256(readFileSync(path.join(root, relativePath)))])),
    modelConfigurations: configurations,
    modelConfigurationFingerprint: sha256(canonical(configurations)),
    development: {
      corpusId: WAVE23_DEVELOPMENT_METADATA.corpusId,
      fixtureCount: WAVE23_DEVELOPMENT_CORPUS.length,
      canonicalFingerprint: sha256(canonical(WAVE23_DEVELOPMENT_CORPUS)),
    },
    holdout: {
      corpusId: WAVE23_HOLDOUT_METADATA.corpusId,
      fixtureCount: WAVE23_HOLDOUT_CORPUS.length,
      frozenBeforeFinalCandidateTuning: WAVE23_HOLDOUT_METADATA.frozenBeforeFinalCandidateTuning,
      canonicalFingerprint: sha256(canonical(WAVE23_HOLDOUT_CORPUS)),
    },
  };
}

export function writeWave23FreezeManifest(options = {}) {
  const manifest = buildWave23FreezeManifest(options);
  writeFileSync(WAVE23_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifyWave23FreezeManifest({ env = process.env } = {}) {
  if (!existsSync(WAVE23_MANIFEST_PATH)) return { ok: false, errors: ["freeze_manifest_missing"] };
  const frozen = JSON.parse(readFileSync(WAVE23_MANIFEST_PATH, "utf8"));
  const current = buildWave23FreezeManifest({ env, frozenAt: frozen.frozenAt });
  const errors = [];
  for (const [relativePath, hash] of Object.entries(frozen.files ?? {})) {
    if (current.files[relativePath] !== hash) errors.push(`hash_changed:${relativePath}`);
  }
  if (current.modelConfigurationFingerprint !== frozen.modelConfigurationFingerprint) errors.push("model_configuration_changed");
  if (current.holdout.canonicalFingerprint !== frozen.holdout?.canonicalFingerprint) errors.push("holdout_fingerprint_changed");
  return { ok: errors.length === 0, errors, frozen, current };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadLocalEnvironment();
  if (process.argv.includes("--check")) {
    const result = verifyWave23FreezeManifest();
    if (!result.ok) {
      console.error(`wave23:freeze FAIL — ${result.errors.join(", ")}`);
      process.exit(1);
    }
    console.log(`wave23:freeze OK — ${path.relative(root, WAVE23_MANIFEST_PATH)}`);
  } else {
    const manifest = writeWave23FreezeManifest();
    console.log(`wave23:freeze CREATED — ${manifest.holdout.fixtureCount} holdout fixtures -> ${path.relative(root, WAVE23_MANIFEST_PATH)}`);
  }
}

function loadLocalEnvironment() {
  for (const candidate of [path.join(root, ".env.local"), path.join(root, ".env"), path.join(root, "../onqol-trainer/.env.local")]) {
    if (!existsSync(candidate)) continue;
    process.loadEnvFile(candidate);
    break;
  }
}
function canonical(value) { return JSON.stringify(value); }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
