import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCrossReferences } from "./buildContentIndex.mjs";

function fixture() {
  return {
    disease: { sources: [{ id: "SRC-1" }] },
    phenotypes: { phenotypes: { p1: { presentation: { examination_slots: { tenderness: "local" } } } }, case_presets: [{ case_preset_id: "C1", phenotype_id: "p1", trajectory_id: "t1" }] },
    findings: { exam_slots: [{ id: "tenderness", states: { local: "x" } }] },
    trajectories: { trajectories: { t1: {} }, treatment_effects: { relief: { applies_to: ["drug1"], provenance: { source_ids: ["SRC-1"] } } } },
    operative: { operative_sequence: [{ step: "entry", decision_id: "d1" }], decisions: { d1: {} } },
    rules: { rules: [{ id: "R1", source_ids: ["SRC-1"] }] },
  };
}

test("cross-file references accept a coherent bundle", () => {
  assert.deepEqual(validateCrossReferences(fixture(), { medications: { medications: { drug1: {} } } }, "x"), []);
});

test("cross-file references fail with human-readable errors", () => {
  const value = fixture();
  value.phenotypes.case_presets[0].trajectory_id = "missing";
  value.operative.operative_sequence[0].decision_id = "missing";
  value.trajectories.treatment_effects.relief.applies_to = ["ghost"];
  value.rules.rules[0].source_ids = ["SRC-GHOST"];
  const errors = validateCrossReferences(value, { medications: { medications: {} } }, "x");
  assert.ok(errors.some((x) => x.includes('unknown trajectory_id "missing"')));
  assert.ok(errors.some((x) => x.includes('unknown decision_id "missing"')));
  assert.ok(errors.some((x) => x.includes('unknown medication "ghost"')));
  assert.ok(errors.some((x) => x.includes('unknown source "SRC-GHOST"')));
});
