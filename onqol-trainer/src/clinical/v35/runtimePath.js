import { scrubSensitiveData } from "../privacy.js";
import { pathStatesById, STABLE_PATH } from "./pathStates.js";

const DATA_ACTIONS = new Set(["focused_history", "abdominal_exam", "pelvic_gynecologic_screen"]);
const TEST_OR_TREATMENT_ACTIONS = new Set([
  "cbc",
  "urinalysis",
  "pregnancy_test",
  "crp",
  "biochemistry",
  "abdominal_ultrasound",
  "pelvic_ultrasound",
  "ct_abdomen",
  "analgesia",
  "iv_access",
  "iv_fluids",
  "npo",
]);
const REASSESSMENT_ACTIONS = new Set([
  "serial_reexamination",
  "vital_signs_reassessment",
  "active_observation",
]);
const DECISION_ACTIONS = new Set([
  "diagnosis_acute_appendicitis",
  "transfer_before_source_control",
  "antibiotic_observation_course",
]);
const PREOP_ACTIONS = new Set([
  "informed_consent",
  "notify_anesthesia",
  "notify_operating_team",
  "preop_risk_assessment",
  "preop_single_antibiotic_prophylaxis",
  "who_sign_in",
  "who_time_out",
]);

const hasAny = (values, candidates) => values.some((value) => candidates.has(value));

/** Runtime state for the reviewed learner path. Faculty-preview complication states stay unreachable. */
export function deriveV35PathState(session, performedActionIds = []) {
  const completed = new Set(session.completedActions || []);
  const performed = [...performedActionIds];
  const reasoning = session.workingMemory?.reasoningState || {};

  if (completed.has("discharge_and_followup")) return "discharge";
  if (session.temporalState?.sourceControl) {
    if (completed.has("postoperative_reassessment")) return "ward_care";
    if (completed.has("structured_handover")) return "postop_destination";
    return "operation";
  }
  if (
    hasAny(performed, PREOP_ACTIONS) ||
    session.workingMemory?.operativeDecision?.status === "committed"
  ) {
    return "preop";
  }
  if (hasAny(performed, REASSESSMENT_ACTIONS)) return "reassessment";
  if (
    hasAny(performed, DECISION_ACTIONS)
    || reasoning.working_diagnosis?.updated_turn === session.workingMemory?.turnNumber
    || reasoning.management?.updated_turn === session.workingMemory?.turnNumber
  ) {
    return "decision";
  }
  if (hasAny(performed, TEST_OR_TREATMENT_ACTIONS)) return "tests_and_treatment";
  if (
    reasoning.differential?.updated_turn === session.workingMemory?.turnNumber
    || reasoning.problem_representation?.updated_turn === session.workingMemory?.turnNumber
  ) {
    return "differential_1";
  }
  if (hasAny(performed, DATA_ACTIONS)) return "data_gathering";
  if ((session.workingMemory?.turnNumber || 0) > 0) return "primary_assessment";
  return session.pathState || "ems_handoff";
}

export function runtimePathContract() {
  return {
    stable_state_ids: [...STABLE_PATH],
    faculty_preview_state_ids: [...pathStatesById.values()]
      .filter((state) => state.runtime_status === "faculty_preview")
      .map((state) => state.state_id),
  };
}

function snapshotClaims(snapshotId, state) {
  if (snapshotId === "primary_assessment") return { stability: state.stability };
  if (snapshotId === "first_differential") {
    return { problem_representation: state.problem_representation, differential: state.differential };
  }
  if (snapshotId === "key_test_results") {
    return { investigations: state.investigations, contingency: state.contingency };
  }
  if (snapshotId === "definitive_decision") {
    return {
      working_diagnosis: state.working_diagnosis,
      management: state.management,
      contingency: state.contingency,
    };
  }
  if (snapshotId === "postoperative_destination") return { disposition: state.disposition };
  if (snapshotId === "deterioration") {
    return {
      stability: state.stability,
      differential: state.differential,
      reassessment: state.reassessment,
      management: state.management,
    };
  }
  return {};
}

/** Snapshot learner claims only; it never copies case truth or raw identifiers. */
export function buildReasoningSnapshot(pathState, reasoningState, turnNumber) {
  const snapshotId = pathStatesById.get(pathState)?.reasoning_snapshot;
  if (!snapshotId) return null;
  return {
    snapshot_contract_version: "3.5.0",
    snapshot_id: snapshotId,
    path_state: pathState,
    turn_number: turnNumber,
    data_class: "learner_claims_not_patient_truth",
    learner_claims: scrubSensitiveData(snapshotClaims(snapshotId, reasoningState || {})),
  };
}
