/**
 * Cumulative learner reasoning. These are learner claims, never patient truth,
 * correctness decisions, scores, or permission to change the clinical world.
 */
export const REASONING_SCHEMA_VERSION = "reasoning-v2";

export const STABILITY_ASSESSMENTS = Object.freeze(["stable", "unstable", "uncertain"]);
export const DIFFERENTIAL_STATUSES = Object.freeze(["active", "deprioritized", "ruled_out"]);
export const DISPOSITION_DESTINATIONS = Object.freeze([
  "home", "ward", "or", "icu", "observation", "other_service", "transfer",
]);

export function createEmptyReasoningState() {
  return {
    schemaVersion: REASONING_SCHEMA_VERSION,
    stability: { stated: false, learnerAssessment: null, updatedTurn: null },
    problemRepresentation: { stated: false, verbatim: null, updatedTurn: null },
    workingDiagnosis: { stated: false, conceptId: null, uncertaintyExpressed: false, updatedTurn: null },
    differential: {
      stated: false,
      ranked: false,
      conceptIds: [],
      activeConceptIds: [],
      everMentionedConceptIds: [],
      items: [],
      updatedTurn: null,
    },
    investigations: { items: [] },
    management: { planStated: false, urgencyStated: false, rationaleStated: false, updatedTurn: null },
    observation: {
      active: false,
      goalStated: false,
      reassessmentIntervalStated: false,
      escalationCriteriaStated: false,
      updatedTurn: null,
    },
    reassessment: { stated: false, updatedTurn: null },
    contingency: { stated: false, specificity: null, triggerConceptIds: [], updatedTurn: null },
    disposition: { stated: false, destination: null, updatedTurn: null },
    consultation: { ownAssessmentStated: false, consultationQuestionStated: false, updatedTurn: null },
    statements: [],
  };
}

/** Pre-migration state retained while AI_INTERACTION_V2 is disabled. */
export function createLegacyReasoningState() {
  return {
    stabilityStated: false,
    workingDiagnosis: null,
    differential: [],
    statements: [],
  };
}

/** Accepts both the old vNext command params and the richer Wave 1 shape. */
export function normalizeReasoningDelta(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

  const stabilityRaw = objectOrEmpty(raw.stability);
  const stabilityAssessment = enumOrNull(
    stabilityRaw.learnerAssessment ?? stabilityRaw.learner_assessment ??
      (raw.stability === true ? "stable" : null),
    STABILITY_ASSESSMENTS,
  );
  const workingRaw = objectOrEmpty(raw.workingDiagnosis ?? raw.working_diagnosis);
  const workingConcept = stringOrNull(
    workingRaw.conceptId ?? workingRaw.concept_id ??
      (typeof raw.workingDiagnosis === "string" ? raw.workingDiagnosis : null),
  );
  const differentialRaw = raw.differential;
  const differentialObject = objectOrEmpty(differentialRaw);
  const rawItems = Array.isArray(differentialRaw)
    ? differentialRaw.map((conceptId) => ({ conceptId }))
    : Array.isArray(differentialObject.items)
      ? differentialObject.items
      : arrayOrEmpty(differentialObject.conceptIds ?? differentialObject.concept_ids).map(
          (conceptId) => ({ conceptId }),
        );
  const differentialItems = uniqueByKey(
    rawItems.map(normalizeDifferentialItem).filter((item) => item.conceptId),
    "conceptId",
  );
  const problemRaw = objectOrEmpty(raw.problemRepresentation ?? raw.problem_representation);
  const managementRaw = objectOrEmpty(raw.management);
  const observationRaw = objectOrEmpty(raw.observation);
  const reassessmentRaw = objectOrEmpty(raw.reassessment);
  const contingencyRaw = objectOrEmpty(raw.contingency);
  const dispositionRaw = objectOrEmpty(raw.disposition);
  const consultationRaw = objectOrEmpty(raw.consultation);
  const investigationItems = arrayOrEmpty(raw.investigations?.items ?? raw.testReasoning ?? raw.test_reasoning)
    .map(normalizeInvestigationItem)
    .filter((item) => item.actionId);

  return {
    stability: {
      stated: Boolean(stabilityRaw.stated || raw.stability === true || stabilityAssessment),
      learnerAssessment: stabilityAssessment,
    },
    problemRepresentation: {
      stated: Boolean(problemRaw.stated ?? raw.problemRepresentationStated ?? raw.problem_representation_stated),
      verbatim: stringOrNull(
        problemRaw.verbatim ?? raw.problemRepresentationVerbatim ?? raw.problem_representation_verbatim,
      ),
    },
    workingDiagnosis: {
      stated: Boolean(workingRaw.stated || workingConcept),
      conceptId: workingConcept,
      uncertaintyExpressed: Boolean(
        workingRaw.uncertaintyExpressed ?? workingRaw.uncertainty_expressed ??
        workingRaw.uncertaintyStated ?? workingRaw.uncertainty_stated,
      ),
    },
    differential: {
      stated: Boolean(differentialObject.stated || differentialItems.length),
      ranked: Boolean(differentialObject.ranked || differentialItems.some((item) => item.rank != null)),
      conceptIds: differentialItems.map((item) => item.conceptId),
      items: differentialItems,
    },
    investigations: { items: uniqueByKey(investigationItems, "actionId") },
    management: {
      planStated: boolOf(managementRaw, "planStated", "plan_stated"),
      urgencyStated: boolOf(managementRaw, "urgencyStated", "urgency_stated"),
      rationaleStated: boolOf(managementRaw, "rationaleStated", "rationale_stated"),
    },
    observation: {
      // Tri-state delta: omission means no update; explicit false abandons
      // the current observation plan without erasing its historical markers.
      active: observationRaw.active === true ? true : observationRaw.active === false ? false : null,
      goalStated: boolOf(observationRaw, "goalStated", "goal_stated"),
      reassessmentIntervalStated: boolOf(observationRaw, "reassessmentIntervalStated", "reassessment_interval_stated"),
      escalationCriteriaStated: boolOf(observationRaw, "escalationCriteriaStated", "escalation_criteria_stated"),
    },
    reassessment: {
      stated: Boolean(reassessmentRaw.stated ?? raw.reassessmentStated ?? raw.reassessment_stated),
    },
    contingency: {
      stated: contingencyRaw.stated === true,
      specificity: stringOrNull(contingencyRaw.specificity),
      triggerConceptIds: uniqueStrings(contingencyRaw.triggerConceptIds ?? contingencyRaw.trigger_concept_ids ?? []),
    },
    disposition: {
      stated: dispositionRaw.stated === true,
      destination: enumOrNull(dispositionRaw.destination, DISPOSITION_DESTINATIONS),
    },
    consultation: {
      ownAssessmentStated: boolOf(consultationRaw, "ownAssessmentStated", "own_assessment_stated"),
      consultationQuestionStated: boolOf(consultationRaw, "consultationQuestionStated", "consultation_question_stated"),
    },
    statement: stringOrNull(raw.text ?? raw.statement),
  };
}

export function mergeReasoningState(previous, rawDelta, turnNumber) {
  const state = previous?.schemaVersion === REASONING_SCHEMA_VERSION
    ? previous
    : createEmptyReasoningState();
  const delta = rawDelta?.schemaVersion === REASONING_SCHEMA_VERSION && rawDelta.delta
    ? rawDelta.delta
    : normalizeReasoningDelta(rawDelta);
  const turn = Number.isInteger(turnNumber) ? turnNumber : null;

  return {
    schemaVersion: REASONING_SCHEMA_VERSION,
    stability: mergeDomain(state.stability, delta.stability, turn, { stated: "or", learnerAssessment: "latest" }),
    problemRepresentation: mergeDomain(state.problemRepresentation, delta.problemRepresentation, turn, { stated: "or", verbatim: "latest" }),
    workingDiagnosis: mergeDomain(state.workingDiagnosis, delta.workingDiagnosis, turn, {
      stated: "or", conceptId: "latest", uncertaintyExpressed: "or",
    }),
    differential: mergeDifferential(state.differential, delta.differential, turn),
    investigations: { items: mergeItems(state.investigations.items, delta.investigations?.items, "actionId", turn) },
    management: mergeDomain(state.management, delta.management, turn, {
      planStated: "or", urgencyStated: "or", rationaleStated: "or",
    }),
    observation: mergeDomain(state.observation, delta.observation, turn, {
      active: "latest", goalStated: "or", reassessmentIntervalStated: "or", escalationCriteriaStated: "or",
    }),
    reassessment: mergeDomain(state.reassessment, delta.reassessment, turn, { stated: "or" }),
    contingency: {
      ...mergeDomain(state.contingency, delta.contingency, turn, { stated: "or", specificity: "latest" }),
      triggerConceptIds: uniqueStrings([
        ...state.contingency.triggerConceptIds,
        ...(delta.contingency?.triggerConceptIds ?? []),
      ]),
    },
    disposition: mergeDomain(state.disposition, delta.disposition, turn, { stated: "or", destination: "latest" }),
    consultation: mergeDomain(state.consultation, delta.consultation, turn, {
      ownAssessmentStated: "or", consultationQuestionStated: "or",
    }),
    statements: delta.statement
      ? [...state.statements, { atTurn: turn, text: delta.statement }]
      : [...state.statements],
  };
}

/** Exact compatibility reducer for sessions that did not opt into Wave 1. */
export function mergeLegacyReasoningState(previous, payload, turnNumber) {
  const state = previous ?? createLegacyReasoningState();
  const normalized = payload?.schemaVersion === REASONING_SCHEMA_VERSION && payload.delta
    ? payload.delta
    : normalizeReasoningDelta(payload);
  const statement = payload?.schemaVersion === REASONING_SCHEMA_VERSION
    ? normalized.statement
    : payload?.text;
  return {
    stabilityStated: state.stabilityStated || Boolean(normalized.stability?.stated),
    workingDiagnosis: normalized.workingDiagnosis?.conceptId ?? state.workingDiagnosis,
    differential: uniqueStrings([
      ...state.differential,
      ...(normalized.differential?.conceptIds ?? []),
    ]),
    statements: statement
      ? [...state.statements, { atTurn: turnNumber, text: statement }]
      : [...state.statements],
  };
}

export function hasWorkingDiagnosis(reasoning) {
  if (reasoning?.schemaVersion === REASONING_SCHEMA_VERSION) {
    return Boolean(reasoning.workingDiagnosis?.stated && reasoning.workingDiagnosis.conceptId);
  }
  return Boolean(reasoning?.workingDiagnosis);
}

function mergeDifferential(previous, delta, turn) {
  const items = mergeItems(previous.items, delta?.items, "conceptId", turn);
  const changed = Boolean(delta?.stated || delta?.ranked || delta?.items?.length || delta?.conceptIds?.length);
  const activeConceptIds = items
    .filter((item) => (item.status ?? "active") === "active")
    .map((item) => item.conceptId);
  const everMentionedConceptIds = uniqueStrings([
    ...(previous.everMentionedConceptIds ?? previous.conceptIds ?? []),
    ...items.map((item) => item.conceptId),
  ]);
  return {
    stated: previous.stated || Boolean(delta?.stated) || items.length > 0,
    ranked: previous.ranked || Boolean(delta?.ranked),
    // Compatibility alias: conceptIds now means CURRENT active differential,
    // never the historical union.
    conceptIds: activeConceptIds,
    activeConceptIds,
    everMentionedConceptIds,
    items,
    updatedTurn: changed ? turn : previous.updatedTurn,
  };
}

function mergeDomain(previous, delta, turn, fields) {
  if (!delta) return { ...previous };
  const next = { ...previous };
  let changed = false;
  for (const [field, mode] of Object.entries(fields)) {
    if (mode === "or") {
      if (delta[field] === true && next[field] !== true) changed = true;
      next[field] = Boolean(next[field] || delta[field]);
    } else if (delta[field] !== null && delta[field] !== undefined) {
      changed = changed || next[field] !== delta[field];
      next[field] = delta[field];
    }
  }
  if (changed) next.updatedTurn = turn;
  return next;
}

function mergeItems(previous = [], additions = [], key, turn) {
  const byKey = new Map(previous.map((item) => [item[key], { ...item }]));
  for (const item of additions ?? []) {
    if (!item?.[key]) continue;
    const existing = byKey.get(item[key]) ?? {};
    const merged = { ...existing };
    let changed = false;
    for (const [field, value] of Object.entries(item)) {
      if (value === null || value === undefined || value === false || (Array.isArray(value) && value.length === 0)) continue;
      merged[field] = Array.isArray(value)
        ? uniqueStrings([...(existing[field] ?? []), ...value])
        : value;
      changed = true;
    }
    byKey.set(item[key], { ...merged, [key]: item[key], updatedTurn: changed ? turn : existing.updatedTurn ?? null });
  }
  return [...byKey.values()];
}

function normalizeDifferentialItem(item) {
  if (typeof item === "string") {
    return { conceptId: item, status: "active", rank: null, dangerous: false, evidenceFor: [], evidenceAgainst: [] };
  }
  const source = objectOrEmpty(item);
  return {
    conceptId: stringOrNull(source.conceptId ?? source.concept_id),
    status: enumOrNull(source.status, DIFFERENTIAL_STATUSES) ?? "active",
    rank: positiveIntegerOrNull(source.rank),
    dangerous: source.dangerous === true,
    evidenceFor: uniqueStrings(source.evidenceFor ?? source.evidence_for ?? []),
    evidenceAgainst: uniqueStrings(source.evidenceAgainst ?? source.evidence_against ?? []),
  };
}

function normalizeInvestigationItem(item) {
  const source = objectOrEmpty(item);
  return {
    actionId: stringOrNull(source.actionId ?? source.action_id ?? source.conceptId ?? source.concept_id),
    purposeStated: boolOf(source, "purposeStated", "purpose_stated"),
    managementConsequenceStated: boolOf(source, "managementConsequenceStated", "management_consequence_stated"),
    justification: stringOrNull(source.justification),
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function arrayOrEmpty(value) { return Array.isArray(value) ? value : []; }
function boolOf(object, camel, snake) { return object?.[camel] === true || object?.[snake] === true; }
function stringOrNull(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function enumOrNull(value, allowed) { return allowed.includes(value) ? value : null; }
function positiveIntegerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string" && value))];
}
function uniqueByKey(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.[key] || seen.has(item[key])) return false;
    seen.add(item[key]);
    return true;
  });
}
