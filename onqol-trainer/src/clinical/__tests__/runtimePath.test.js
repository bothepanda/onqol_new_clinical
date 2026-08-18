import assert from "node:assert/strict";
import test from "node:test";
import { buildV35Case } from "../v35/createCase.js";
import {
  buildReasoningSnapshot,
  deriveV35PathState,
  runtimePathContract,
} from "../v35/runtimePath.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";

function state(overrides = {}) {
  return {
    pathState: "ems_handoff",
    completedActions: [],
    temporalState: { sourceControl: false },
    workingMemory: {
      turnNumber: 1,
      pendingOperationalization: [],
      reasoningState: {},
    },
    ...overrides,
  };
}

test("runtime contract covers the stable path and isolates faculty-preview complication states", () => {
  const contract = runtimePathContract();
  assert.equal(contract.stable_state_ids[0], "ems_handoff");
  assert.equal(contract.stable_state_ids.at(-1), "complete");
  assert.deepEqual(contract.faculty_preview_state_ids, [
    "deterioration",
    "complication_workup",
    "source_control_2",
  ]);
});

test("V3.5 derives distinct learner-path states from current actions and state", () => {
  assert.equal(deriveV35PathState(state(), []), "primary_assessment");
  assert.equal(deriveV35PathState(state(), ["focused_history"]), "data_gathering");
  assert.equal(
    deriveV35PathState(
      state({ workingMemory: { turnNumber: 2, pendingOperationalization: [], reasoningState: { differential: { updated_turn: 2 } } } }),
      []
    ),
    "differential_1"
  );
  assert.equal(deriveV35PathState(state(), ["cbc"]), "tests_and_treatment");
  assert.equal(deriveV35PathState(state(), ["serial_reexamination"]), "reassessment");
  assert.equal(deriveV35PathState(state(), ["diagnosis_acute_appendicitis"]), "decision");
  assert.equal(deriveV35PathState(state(), ["who_sign_in"]), "preop");
  assert.equal(
    deriveV35PathState(state({ temporalState: { sourceControl: true } }), []),
    "operation"
  );
  assert.equal(
    deriveV35PathState(
      state({ completedActions: ["structured_handover"], temporalState: { sourceControl: true } }),
      []
    ),
    "postop_destination"
  );
  assert.equal(
    deriveV35PathState(
      state({ completedActions: ["postoperative_reassessment"], temporalState: { sourceControl: true } }),
      []
    ),
    "ward_care"
  );
  assert.equal(
    deriveV35PathState(state({ completedActions: ["discharge_and_followup"] }), []),
    "discharge"
  );
});

test("operative approach and procedure start remain pre-source-control states", () => {
  const selected = state({
    pathState: "decision",
    completedActions: ["diagnosis_acute_appendicitis"],
    workingMemory: {
      turnNumber: 4,
      pendingOperationalization: [],
      reasoningState: {},
      operativeApproach: { approach: "laparoscopic", status: "selected" },
      operativeState: { procedure_started: false, source_control_completed: false },
    },
  });
  assert.notEqual(deriveV35PathState(selected, []), "operation");

  const started = {
    ...selected,
    completedActions: [...selected.completedActions, "appendectomy_procedure_start"],
    workingMemory: {
      ...selected.workingMemory,
      operativeState: { procedure_started: true, source_control_completed: false },
    },
  };
  assert.notEqual(deriveV35PathState(started, ["appendectomy_procedure_start"]), "operation");
  assert.equal(
    deriveV35PathState({ ...started, temporalState: { sourceControl: true } }, []),
    "operation"
  );
});

test("reasoning snapshots are state-specific learner claims and redact identifiers", () => {
  const snapshot = buildReasoningSnapshot(
    "differential_1",
    {
      problem_representation: { stated: true, verbatim: "ИИН 123456789012" },
      differential: { stated: true, items: [] },
    },
    3
  );
  assert.equal(snapshot.snapshot_id, "first_differential");
  assert.equal(snapshot.data_class, "learner_claims_not_patient_truth");
  assert.match(snapshot.learner_claims.problem_representation.verbatim, /\[IIN_REDACTED\]/);
  assert.doesNotMatch(JSON.stringify(snapshot), /123456789012/);
});

test("the engine emits a reasoning snapshot once on entry to a declared snapshot state", async () => {
  const caseData = buildV35Case({
    seed: "reasoning-snapshot-runtime",
    requestedPresetId: "APP-002",
  }).caseData;
  const session = createV25Session({ caseData, mode: "reference", seed: "reasoning-snapshot-runtime" });
  const payload = {
    intents: [
      { type: "diagnosis", concept_id: "diagnosis_acute_appendicitis", confidence: 0.99 },
    ],
    reasoning: {
      problem_representation_stated: true,
      problem_representation_verbatim: "ИИН 123456789012",
      working_diagnosis: {
        stated: true,
        concept_id: "diagnosis_acute_appendicitis",
        uncertainty_stated: false,
      },
    },
    unresolved_fragments: [],
  };
  const result = await advanceV25Session({
    caseData,
    session,
    input: "ИИН 123456789012; рабочий диагноз — острый аппендицит",
    options: { actionExtractorLLM: async () => JSON.stringify(payload) },
  });
  const snapshots = result.session.eventLog.filter((entry) => entry.event_type === "reasoning_snapshot");
  assert.equal(result.session.pathState, "decision");
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].snapshot_id, "definitive_decision");
  assert.doesNotMatch(JSON.stringify(snapshots[0]), /123456789012/);
});
