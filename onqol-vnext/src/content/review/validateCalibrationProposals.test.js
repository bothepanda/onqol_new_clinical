import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { validateCalibrationProposals } from "./validateCalibrationProposals.js";
import compiled from "../generated/appendicitis.json" with { type: "json" };

const root = new URL("../diseases/appendicitis/", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const document = JSON.parse(read("review/calibration-proposals-v1.json"));
const sourceIds = parseYaml(read("disease.yaml")).sources.map((source) => source.id);
const changed = (edit) => { const value = structuredClone(document); edit(value); return validateCalibrationProposals(value, sourceIds); };

test("28 classified draft proposals have source provenance and blank clinical decisions", () => {
  assert.equal(document.proposals.length, 28);
  assert.deepEqual(validateCalibrationProposals(document, sourceIds), []);
  assert.deepEqual(Object.fromEntries(["A", "B", "C", "D"].map((c) => [c, document.proposals.filter((p) => p.evidence_class === c).length])), { A: 0, B: 3, C: 18, D: 7 });
  assert.ok(document.proposals.every((p) => p.numeric_range === null && p.runtime_authority === "none" && p.review_status === "draft"));
});

test("review schema rejects authority promotion, provenance loss, ID collision and missing status", () => {
  assert.match(changed((v) => { v.proposals[0].review_status = "approved_for_training"; }).join(" "), /draft and inert/);
  assert.match(changed((v) => { v.proposals[0].source_ids = ["NO-SOURCE"]; }).join(" "), /source_ids/);
  assert.match(changed((v) => { v.sources[0].population = ""; }).join(" "), /missing population/);
  assert.match(changed((v) => { v.proposals[1].calibration_id = v.proposals[0].calibration_id; }).join(" "), /duplicate/);
  assert.match(changed((v) => { delete v.proposals[0].review_status; }).join(" "), /draft and inert/);
  assert.match(changed((v) => { v.proposals[0].reviewed_by = "someone"; }).join(" "), /reviewer fields must be blank/);
});

test("review schema rejects malformed ranges, unsupported units and impossible min/max", () => {
  assert.match(changed((v) => { v.proposals[0].numeric_range = { values: [5, 2], unit: "NRS_0_10" }; }).join(" "), /malformed numeric_range/);
  assert.match(changed((v) => { v.proposals[0].numeric_range = { values: [1, 2], unit: "mystery" }; }).join(" "), /invalid unit/);
  assert.match(changed((v) => { v.proposals[0].constraints = { min: 10, max: 5, unit: "NRS_0_10" }; }).join(" "), /impossible min\/max/);
  assert.match(changed((v) => { v.proposals[0].numeric_range = { values: [1, 2], unit: "NRS_0_10" }; }).join(" "), /class A evidence/);
  assert.match(changed((v) => { v.proposals[0].evidence_class = "A"; v.proposals[0].constraints = { min: 0, max: 10, unit: "NRS_0_10" }; }).join(" "), /missing evidence locator/);
});

test("review-only file is outside compiled content hash and cannot be selected at runtime", () => {
  const files = ["disease.yaml", "phenotypes.yaml", "trajectories.yaml", "findings.yaml", "rules.yaml", "operative.yaml", "complications.yaml"];
  const hash = createHash("sha256").update(files.map(read).join("\n---\n")).digest("hex").slice(0, 16);
  assert.equal(compiled.__contentVersion, hash);
  assert.equal(compiled.review, undefined);
  assert.equal(compiled.calibration_proposals, undefined);
  assert.deepEqual(compiled.complications.postoperative_course.complications, []);
  for (const effect of Object.values(compiled.trajectories.treatment_effects)) {
    assert.equal(effect.response_envelope, null);
    assert.notEqual(effect.provenance.review_status, "approved_for_training");
  }
});
