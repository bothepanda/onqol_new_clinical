const requiredCaseFields = [
  "case_id",
  "case_version",
  "disease_card_id",
  "disease_card_version",
  "scoring_rubric_version",
  "router_version",
  "status",
  "category",
  "supported_locales",
  "training_level",
  "resource_setting",
  "title",
  "specialty",
  "difficulty",
  "target_level",
  "learning_objectives",
  "initial_presentation",
  "patient_state",
  "available_findings",
  "hidden_findings",
  "state_transitions",
  "expected_actions",
  "acceptable_alternatives",
  "unnecessary_actions",
  "critical_omissions",
  "unsafe_actions",
  "diagnostic_milestones",
  "management_milestones",
  "end_conditions",
  "scoring",
  "feedback",
  "references",
  "resource_context",
  "information_policy",
];

export function validateCase(caseData) {
  const errors = [];

  for (const field of requiredCaseFields) {
    if (!(field in caseData)) errors.push(`Missing required case field: ${field}`);
  }

  for (const versionField of [
    "case_version",
    "disease_card_version",
    "scoring_rubric_version",
    "router_version",
  ]) {
    if (caseData[versionField] && !/^\d+\.\d+\.\d+$/.test(caseData[versionField])) {
      errors.push(`${versionField} must use semantic versioning`);
    }
  }

  const ids = new Set();
  const actionGroups = [
    ...(caseData.expected_actions || []),
    ...(caseData.acceptable_alternatives || []),
    ...(caseData.unnecessary_actions || []),
    ...(caseData.unsafe_actions || []),
  ];

  for (const action of actionGroups) {
    if (!action.id) errors.push("Action without id");
    if (ids.has(action.id)) errors.push(`Duplicate action id: ${action.id}`);
    ids.add(action.id);
  }

  for (const id of caseData.critical_omissions || []) {
    if (!ids.has(id)) errors.push(`Critical omission references unknown action: ${id}`);
  }

  const referenceIds = new Set((caseData.references || []).map((reference) => reference.id));
  for (const action of actionGroups) {
    for (const referenceId of action.evidence_reference_ids || []) {
      if (!referenceIds.has(referenceId)) {
        errors.push(`Action ${action.id} references unknown evidence id: ${referenceId}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function buildAllowedActionMap(caseData) {
  const map = new Map();
  for (const action of [
    ...caseData.expected_actions,
    ...caseData.acceptable_alternatives,
    ...caseData.unnecessary_actions,
    ...caseData.unsafe_actions,
  ]) {
    map.set(action.id, action);
  }
  return map;
}
