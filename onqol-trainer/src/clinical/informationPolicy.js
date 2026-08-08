export const PATIENT_INFORMATION_CLASS = Object.freeze({
  LOCKED_FACT: "LOCKED_FACT",
  INFERABLE_FINDING: "INFERABLE_FINDING",
  UNKNOWN: "UNKNOWN",
});

export function buildPatientInformationPolicy(caseData) {
  const availableFindings = Object.entries(caseData.available_findings || {}).map(([id, finding]) => ({
    id,
    classification: PATIENT_INFORMATION_CLASS.LOCKED_FACT,
    title: finding.title,
    text: finding.text,
    availability: finding.unavailable ? "unavailable" : finding.delayed ? "delayed" : "available",
  }));
  const hiddenFindings = Object.entries(caseData.hidden_findings || {}).map(([id, finding]) => ({
    id,
    classification: PATIENT_INFORMATION_CLASS.LOCKED_FACT,
    title: finding.title,
    text: finding.text,
    availability: "hidden_until_state_transition",
  }));
  const inferableFindings = (caseData.inferable_findings || []).map((finding) => ({
    ...finding,
    classification: PATIENT_INFORMATION_CLASS.INFERABLE_FINDING,
  }));

  return {
    classes: PATIENT_INFORMATION_CLASS,
    locked_facts: {
      initial_presentation: caseData.initial_presentation,
      patient_state: caseData.patient_state,
      available_findings: availableFindings,
      hidden_findings: hiddenFindings,
    },
    inferable_findings: inferableFindings,
    unknown_rule:
      "If a requested patient fact is neither authored as a locked fact nor explicitly allowed as an inferable finding, classify it as UNKNOWN and do not invent it.",
    inference_guardrail:
      "An inferred finding must never change diagnosis, severity, timeline, resource constraints, or any key decision point.",
  };
}

export function isAuthorizedInformationSource(caseData, source, revealedFindingIds = []) {
  if (!source || !source.classification) return false;

  if (source.classification === PATIENT_INFORMATION_CLASS.UNKNOWN) return true;

  if (source.classification === PATIENT_INFORMATION_CLASS.INFERABLE_FINDING) {
    return (caseData.inferable_findings || []).some((finding) => finding.id === source.source_id);
  }

  if (source.classification !== PATIENT_INFORMATION_CLASS.LOCKED_FACT) return false;
  if (["initial_presentation", "patient_state"].includes(source.source_id)) return true;

  const [group, findingId] = String(source.source_id).split(".");
  if (group === "available_findings") return Object.hasOwn(caseData.available_findings || {}, findingId);
  if (group === "hidden_findings") {
    return Object.hasOwn(caseData.hidden_findings || {}, findingId) && revealedFindingIds.includes(findingId);
  }

  return false;
}

