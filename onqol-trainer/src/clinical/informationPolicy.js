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

/**
 * The findings the simulator may voice on THIS turn.
 *
 * Existing in the case is not permission. Until 10.08.2026 any
 * `available_findings.<id>` passed authorisation merely by existing, so a
 * general "что ещё важно?" could be answered with a CT nobody had ordered - the
 * one thing a diagnostic-reasoning trainer must never do.
 *
 * A source is allowed when the learner has already been given it, or when the
 * deterministic engine has just decided to give it on this turn. Nothing else.
 *
 * @param {string[]} alreadyRevealed  findings revealed in earlier turns
 * @param {string[]} revealedThisTurn findings the engine unlocked this turn
 */
export function allowedSourceIdsForTurn(alreadyRevealed = [], revealedThisTurn = []) {
  const findings = [...new Set([...alreadyRevealed, ...revealedThisTurn])];
  return new Set([
    // The handoff the learner has already read.
    "initial_presentation",
    ...findings.flatMap((findingId) => [
      `available_findings.${findingId}`,
      `hidden_findings.${findingId}`,
    ]),
  ]);
}

/**
 * @param {Set<string>} [allowedSourceIds] the turn's allowlist. Omitting it
 *        keeps the old, wider behaviour and is only for callers that have no
 *        turn context; the engine always passes one.
 */
export function isAuthorizedInformationSource(
  caseData,
  source,
  revealedFindingIds = [],
  allowedSourceIds = null
) {
  if (!source || !source.classification) return false;

  if (source.classification === PATIENT_INFORMATION_CLASS.UNKNOWN) return true;

  if (source.classification === PATIENT_INFORMATION_CLASS.INFERABLE_FINDING) {
    return (caseData.inferable_findings || []).some((finding) => finding.id === source.source_id);
  }

  if (source.classification !== PATIENT_INFORMATION_CLASS.LOCKED_FACT) return false;

  // The allowlist is the gate whenever the caller supplies one.
  if (allowedSourceIds) return allowedSourceIds.has(String(source.source_id));

  if (["initial_presentation", "patient_state"].includes(source.source_id)) return true;

  const [group, findingId] = String(source.source_id).split(".");
  if (group === "available_findings") return Object.hasOwn(caseData.available_findings || {}, findingId);
  if (group === "hidden_findings") {
    return Object.hasOwn(caseData.hidden_findings || {}, findingId) && revealedFindingIds.includes(findingId);
  }

  return false;
}

/**
 * What the simulator is allowed to SEE.
 *
 * It used to receive `case_blueprint: caseData` - the whole thing, including
 * hidden findings, expected actions, unsafe actions, the rubric, critical
 * omissions, state transitions and the temporal rules. A model cannot leak what
 * it was never shown, and every one of those fields is either an answer or a
 * spoiler.
 *
 * Only the findings on this turn's allowlist travel with their text. Every other
 * finding is not mentioned at all: even a bare list of ids tells the model what
 * exists to be asked for.
 */
export function buildSanitizedCaseView(caseData, allowedSourceIds) {
  const pick = (group) =>
    Object.fromEntries(
      Object.entries(caseData[group] || {})
        .filter(([findingId]) => allowedSourceIds.has(`${group}.${findingId}`))
        .map(([findingId, finding]) => [
          findingId,
          { title: finding.title, text: finding.text },
        ])
    );

  return {
    case_id: caseData.case_id,
    title: caseData.title,
    locale_note: "Patient and environment only. No scoring, no expectations, no hidden truth.",
    initial_presentation: caseData.initial_presentation,
    // Demographics the learner was already handed, and nothing else from the
    // patient state: `hemodynamics`, onset hours and the rest are answers.
    patient_public: {
      age: caseData.patient_state?.age ?? null,
      sex: caseData.patient_state?.sex ?? null,
    },
    available_findings: pick("available_findings"),
    hidden_findings: pick("hidden_findings"),
    inferable_findings: caseData.inferable_findings || [],
    information_policy: caseData.information_policy || null,
  };
}

