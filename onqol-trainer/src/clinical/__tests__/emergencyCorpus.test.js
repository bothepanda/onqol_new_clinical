import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, "../corpus/emergency");

function readYaml(path) {
  return YAML.parse(readFileSync(path, "utf8"));
}

const manifest = readYaml(join(corpusDir, "corpus_manifest.yaml"));
const retrievalPolicy = readFileSync(join(corpusDir, "RETRIEVAL_POLICY.md"), "utf8");

test("emergency corpus manifest is retrieval support, not clinical source of truth", () => {
  assert.equal(manifest.corpus_id, "onqol-emergency-surgery-v1");
  assert.deepEqual(manifest.authority_order, [
    "validated_case_card",
    "validated_disease_card",
    "current_disease_specific_guideline",
    "kazakhstan_protocol_overlay",
    "general_emergency_corpus",
  ]);
  assert.ok(manifest.not_for.includes("inventing patient-specific findings"));
  assert.ok(manifest.not_for.includes("direct scoring of learner actions"));
  assert.ok(manifest.not_for.includes("overriding validated Disease Cards"));
});

test("only license-compatible emergency corpus sources are full-text ingestion candidates", () => {
  const fullTextSources = manifest.sources.filter((source) => source.ingest_fulltext === true);
  const jamaAppendicitis2025 = manifest.sources.find((source) => source.id === "wses_appendicitis_2025_jama");

  assert.ok(fullTextSources.length > 0);
  assert.ok(fullTextSources.every((source) => source.license === "CC BY 4.0"));
  assert.ok(jamaAppendicitis2025);
  assert.equal(jamaAppendicitis2025.ingest_fulltext, false);
  assert.equal(jamaAppendicitis2025.license, "not_assumed_open_for_product_ingestion");
  assert.equal(jamaAppendicitis2025.role, "current_appendicitis_authority_for_disease_card_review");
});

test("retrieval policy preserves simulation and debrief separation", () => {
  assert.match(retrievalPolicy, /Retrieval cannot create patient facts/);
  assert.match(retrievalPolicy, /Scoring comes only from the validated case rubric/);
  assert.match(
    retrievalPolicy,
    /Normal simulation:\s*user text -> semantic router -> case concepts -> deterministic case engine -> patient findings/
  );
  assert.match(
    retrievalPolicy,
    /Debrief:\s*scoring result -> approved Disease Card teaching points -> evidence citations/
  );
});
