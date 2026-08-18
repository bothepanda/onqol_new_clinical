export const FULL_CLINICAL_TEST_PROFILE = "internal-full-clinical-test-v1";

const BYPASSED_GATES = Object.freeze([
  "faculty_preview_preset_gate",
  "numeric_scoring_review_gate",
  "parameter_safety_application_gate",
  "operative_prerequisite_gate",
  "stable_pathway_gate",
]);

function enableActionForInternalTest(action) {
  return {
    ...action,
    eligible_for_scoring: true,
    clinical_test_status: "unvalidated_internal_test",
  };
}

/**
 * Opens already-authored clinical content for one local reviewer.
 *
 * This is deliberately a copy: source cards and governance registries keep
 * their permanent status, while the session receives an auditable test-only
 * projection. No draft row is silently promoted to approved_for_training.
 */
export function enableFullClinicalTestCase(caseData) {
  if (!caseData) throw new Error("A case is required for full clinical test mode.");

  return {
    ...caseData,
    expected_actions: (caseData.expected_actions || []).map(enableActionForInternalTest),
    acceptable_alternatives: (caseData.acceptable_alternatives || []).map(
      enableActionForInternalTest
    ),
    unnecessary_actions: (caseData.unnecessary_actions || []).map(enableActionForInternalTest),
    unsafe_actions: (caseData.unsafe_actions || []).map(enableActionForInternalTest),
    scoring: {
      ...caseData.scoring,
      mode: "internal_test_numeric_unvalidated",
      eligible_for_scoring: true,
      review_status: "internal_test_only_unvalidated",
      unlock_requires: [],
    },
    clinical_test: Object.freeze({
      enabled: true,
      profile: FULL_CLINICAL_TEST_PROFILE,
      result_status: "not_valid_for_learner_assessment",
      bypassed_gates: BYPASSED_GATES,
    }),
  };
}

