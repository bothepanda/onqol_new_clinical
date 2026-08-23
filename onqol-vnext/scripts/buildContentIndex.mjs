#!/usr/bin/env node
// Compiles authored clinical-content YAML into one versioned JSON bundle per
// disease, and fails the build if a required provenance field is missing.
//
// Why a build step and not a runtime YAML parse: the export schema (Core
// Foundation Spec §61, §30) needs a stable `content_versions` hash per
// session, and a release should be able to fail *before* a session starts if
// a rule lost its `source_ids` in an edit. Both of those want a discrete,
// checkable artifact - `src/content/generated/<disease>.json` - not a parse
// that happens once per browser session.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DISEASES_DIR = path.join(ROOT, "src/content/diseases");
const OUT_DIR = path.join(ROOT, "src/content/generated");
const CHECK_ONLY = process.argv.includes("--check");

const REQUIRED_FILES = [
  "disease.yaml",
  "phenotypes.yaml",
  "trajectories.yaml",
  "findings.yaml",
  "rules.yaml",
  "operative.yaml",
  "complications.yaml",
];

function loadYaml(filePath) {
  return parseYaml(readFileSync(filePath, "utf8"));
}

function validateRule(rule, diseaseId) {
  const errors = [];
  if (!rule.id) errors.push(`rule missing id`);
  if (!rule.level) errors.push(`rule ${rule.id} missing level`);
  if (!rule.source_ids?.length) errors.push(`rule ${rule.id} missing source_ids (provenance)`);
  if (!rule.review_status) errors.push(`rule ${rule.id} missing review_status`);
  if (rule.review_status === "approved_for_training" && !rule.reviewers?.length) {
    errors.push(`rule ${rule.id} claims approved_for_training without recorded reviewers`);
  }
  return errors.map((message) => `[${diseaseId}] ${message}`);
}

function buildDisease(diseaseId) {
  const dir = path.join(DISEASES_DIR, diseaseId);
  const entries = readdirSync(dir);
  for (const file of REQUIRED_FILES) {
    if (!entries.includes(file)) throw new Error(`${diseaseId}: missing required content file "${file}".`);
  }

  const bundle = {};
  const rawParts = [];
  for (const file of REQUIRED_FILES) {
    const key = file.replace(".yaml", "");
    const filePath = path.join(dir, file);
    const raw = readFileSync(filePath, "utf8");
    rawParts.push(raw);
    bundle[key] = loadYaml(filePath);
  }

  const errors = (bundle.rules.rules ?? []).flatMap((rule) => validateRule(rule, diseaseId));
  if (errors.length) {
    throw new Error(`Content validation failed:\n${errors.join("\n")}`);
  }

  const contentVersion = createHash("sha256").update(rawParts.join("\n---\n")).digest("hex").slice(0, 16);
  return { diseaseId, contentVersion, bundle };
}

const SHARED_DIR = path.join(ROOT, "src/content/shared");

function buildShared() {
  const shared = {};
  for (const category of readdirSync(SHARED_DIR)) {
    const categoryDir = path.join(SHARED_DIR, category);
    const files = readdirSync(categoryDir).filter((name) => name.endsWith(".yaml"));
    shared[category] = {};
    for (const file of files) {
      Object.assign(shared[category], loadYaml(path.join(categoryDir, file)));
    }
  }
  return shared;
}

function main() {
  const diseaseIds = readdirSync(DISEASES_DIR).filter((name) => name !== "generated");
  const index = {};
  const compiled = {};

  for (const diseaseId of diseaseIds) {
    const { contentVersion, bundle } = buildDisease(diseaseId);
    index[diseaseId] = { contentVersion, files: REQUIRED_FILES };
    compiled[diseaseId] = bundle;
  }

  const shared = buildShared();

  if (CHECK_ONLY) {
    console.log(`content:check OK — ${Object.keys(index).join(", ")} + shared/${Object.keys(shared).join(",")}`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "contentIndex.json"), JSON.stringify(index, null, 2));
  writeFileSync(path.join(OUT_DIR, "shared.json"), JSON.stringify(shared, null, 2));
  for (const [diseaseId, bundle] of Object.entries(compiled)) {
    // The content hash travels INSIDE the bundle, not only in the index.
    // `exportSession` reads `bundle.__contentVersion` to fill the export's
    // `content_versions`, and with the hash living only in contentIndex.json
    // every exported session recorded the literal string "unversioned" -
    // silently defeating the guarantee that two replays with equal
    // `content_versions` ran against byte-identical clinical content.
    writeFileSync(
      path.join(OUT_DIR, `${diseaseId}.json`),
      JSON.stringify({ ...bundle, __contentVersion: index[diseaseId].contentVersion }, null, 2),
    );
  }
  console.log(`content:build OK — wrote ${Object.keys(compiled).length} disease bundle(s) + shared/ to ${path.relative(ROOT, OUT_DIR)}`);
}

main();
