// Reasoning State: what the learner has articulated, tracked across a session.
//
// WHY
//
// The router extracts intent_type, concept_id and confidence. That is enough to
// know which action was requested and never enough to know how the learner
// reasoned. Two messages that order the same tests are indistinguishable:
//
//   A: "ОАК, CRP, ХГЧ, УЗИ."
//   B: "Рабочий диагноз — аппендицит, но беременность нужно исключить. ХГЧ
//       нужен для этого; ОАК/CRP оценивают воспалительный ответ."
//
// The deterministic layer must run the same actions for both. The mentor should
// not treat them the same. This module is what makes the difference visible.
//
// WHAT THIS IS NOT
//
// Every field here is a record of a LEARNER CLAIM, never a validated fact. The
// naming is deliberate: `stated`, `learner_assessment`, `*_stated`. Nothing here
// says the patient is stable - only that the learner said so. Clinical truth
// stays deterministic and case-owned, and the router is forbidden from judging
// medical correctness (see buildSemanticRouterPrompt).
//
// Consequently nothing in this module may move a score. It feeds the mentor and
// the research log, and it is normalised defensively because it originates in
// model output: an absent, malformed or hostile reasoning payload degrades to an
// empty delta and never fails the turn.

export const DISPOSITION_DESTINATIONS = [
  "home",
  "ward",
  "or",
  "icu",
  "observation",
  "other_service",
  "transfer",
];

export const STABILITY_ASSESSMENTS = ["stable", "unstable", "uncertain"];

export function createEmptyReasoningState() {
  return {
    stability: { stated: false, learner_assessment: null, updated_turn: null },
    problem_representation: { stated: false, updated_turn: null },
    working_diagnosis: {
      stated: false,
      concept_id: null,
      uncertainty_stated: false,
      updated_turn: null,
    },
    differential: {
      stated: false,
      ranked: false,
      has_dangerous_alternative: false,
      concept_ids: [],
      updated_turn: null,
    },
    // One entry per investigation the learner has spoken about:
    // { action_id, purpose_stated, management_consequence_stated, updated_turn }
    investigations: { items: [] },
    management: {
      plan_stated: false,
      urgency_stated: false,
      rationale_stated: false,
      updated_turn: null,
    },
    observation: {
      active: false,
      goal_stated: false,
      reassessment_interval_stated: false,
      escalation_criteria_stated: false,
      updated_turn: null,
    },
    reassessment: { stated: false, updated_turn: null },
    contingency: { stated: false, updated_turn: null },
    disposition: { stated: false, destination: null, updated_turn: null },
    consultation: {
      own_assessment_stated: false,
      consultation_question_stated: false,
      updated_turn: null,
    },
  };
}

function bool(value) {
  return value === true;
}

function enumOrNull(value, allowed) {
  return allowed.includes(value) ? value : null;
}

/**
 * Normalise a raw reasoning payload from the router.
 *
 * Unknown enum values become null, unknown concept ids are dropped, and anything
 * unparseable yields an empty delta. The caller must never see a throw: a model
 * that returns garbage costs the turn its reasoning signal, not the turn.
 *
 * @param {unknown} raw
 * @param {{allowedConceptIds?: Set<string>|string[]}} [options]
 * @returns {object|null} delta, or null when there is nothing usable
 */
export function normalizeReasoningDelta(raw, options = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const allowed =
    options.allowedConceptIds instanceof Set
      ? options.allowedConceptIds
      : new Set(options.allowedConceptIds || []);
  const known = (id) => typeof id === "string" && (allowed.size === 0 || allowed.has(id));

  const differentialIds = Array.isArray(raw.differential?.concept_ids)
    ? raw.differential.concept_ids.filter(known)
    : [];

  // Test reasoning may reference only concepts this case actually carries.
  const investigations = (Array.isArray(raw.test_reasoning) ? raw.test_reasoning : [])
    .filter((item) => item && known(item.concept_id))
    .map((item) => ({
      action_id: item.concept_id,
      purpose_stated: bool(item.purpose_stated),
      management_consequence_stated: bool(item.management_consequence_stated),
    }));

  return {
    stability: {
      stated: bool(raw.stability?.stated),
      learner_assessment: enumOrNull(raw.stability?.learner_assessment, STABILITY_ASSESSMENTS),
    },
    problem_representation: { stated: bool(raw.problem_representation_stated) },
    working_diagnosis: {
      stated: bool(raw.working_diagnosis?.stated),
      concept_id: known(raw.working_diagnosis?.concept_id) ? raw.working_diagnosis.concept_id : null,
      uncertainty_stated: bool(raw.working_diagnosis?.uncertainty_stated),
    },
    differential: {
      stated: bool(raw.differential?.stated),
      ranked: bool(raw.differential?.ranked),
      has_dangerous_alternative: bool(raw.differential?.has_dangerous_alternative),
      concept_ids: differentialIds,
    },
    investigations,
    management: {
      plan_stated: bool(raw.management?.plan_stated),
      urgency_stated: bool(raw.management?.urgency_stated),
      rationale_stated: bool(raw.management?.rationale_stated),
    },
    observation: {
      active: bool(raw.observation?.active),
      goal_stated: bool(raw.observation?.goal_stated),
      reassessment_interval_stated: bool(raw.observation?.reassessment_interval_stated),
      escalation_criteria_stated: bool(raw.observation?.escalation_criteria_stated),
    },
    reassessment: { stated: bool(raw.reassessment_stated) },
    contingency: { stated: bool(raw.contingency_stated) },
    disposition: {
      stated: bool(raw.disposition?.stated),
      destination: enumOrNull(raw.disposition?.destination, DISPOSITION_DESTINATIONS),
    },
    consultation: {
      own_assessment_stated: bool(raw.consultation?.own_assessment_stated),
      consultation_question_stated: bool(raw.consultation?.consultation_question_stated),
    },
  };
}

/**
 * Cumulative merge.
 *
 * `stated`-style booleans latch: having said something once, the learner does not
 * unsay it by not repeating it on the next turn. Otherwise a resident who names a
 * differential and then orders a test would be told off for having no
 * differential. Enum values (stability assessment, disposition destination) do
 * update, because a later explicit statement supersedes an earlier one.
 *
 * Known limitation, deliberately left: `observation.active` also latches, so a
 * learner who observes and then operates keeps the flag. Heuristics fire once per
 * session, which contains the damage. Deactivating it needs the router to report
 * an abandoned plan, which it cannot do today.
 *
 * @returns {{state: object, changed: boolean}}
 */
export function mergeReasoningState(previous, delta, turnNumber) {
  const state = previous ? structuredClone(previous) : createEmptyReasoningState();
  if (!delta) return { state, changed: false };
  let changed = false;

  const latch = (section, field, incoming) => {
    if (incoming === true && section[field] !== true) {
      section[field] = true;
      changed = true;
      return true;
    }
    return false;
  };
  const touch = (section, hit) => {
    if (hit) section.updated_turn = turnNumber;
  };

  let hit = latch(state.stability, "stated", delta.stability?.stated);
  if (delta.stability?.learner_assessment && state.stability.learner_assessment !== delta.stability.learner_assessment) {
    state.stability.learner_assessment = delta.stability.learner_assessment;
    state.stability.stated = true;
    changed = true;
    hit = true;
  }
  touch(state.stability, hit);

  touch(
    state.problem_representation,
    latch(state.problem_representation, "stated", delta.problem_representation?.stated)
  );

  hit = latch(state.working_diagnosis, "stated", delta.working_diagnosis?.stated);
  hit = latch(state.working_diagnosis, "uncertainty_stated", delta.working_diagnosis?.uncertainty_stated) || hit;
  if (delta.working_diagnosis?.concept_id && state.working_diagnosis.concept_id !== delta.working_diagnosis.concept_id) {
    state.working_diagnosis.concept_id = delta.working_diagnosis.concept_id;
    state.working_diagnosis.stated = true;
    changed = true;
    hit = true;
  }
  touch(state.working_diagnosis, hit);

  hit = latch(state.differential, "stated", delta.differential?.stated);
  hit = latch(state.differential, "ranked", delta.differential?.ranked) || hit;
  hit = latch(state.differential, "has_dangerous_alternative", delta.differential?.has_dangerous_alternative) || hit;
  for (const conceptId of delta.differential?.concept_ids || []) {
    if (!state.differential.concept_ids.includes(conceptId)) {
      state.differential.concept_ids.push(conceptId);
      changed = true;
      hit = true;
    }
  }
  touch(state.differential, hit);

  for (const incoming of delta.investigations || []) {
    const existing = state.investigations.items.find((item) => item.action_id === incoming.action_id);
    if (!existing) {
      state.investigations.items.push({ ...incoming, updated_turn: turnNumber });
      changed = true;
      continue;
    }
    // Purpose, once articulated, stays articulated for that investigation.
    for (const field of ["purpose_stated", "management_consequence_stated"]) {
      if (incoming[field] === true && existing[field] !== true) {
        existing[field] = true;
        existing.updated_turn = turnNumber;
        changed = true;
      }
    }
  }

  hit = false;
  for (const field of ["plan_stated", "urgency_stated", "rationale_stated"]) {
    hit = latch(state.management, field, delta.management?.[field]) || hit;
  }
  touch(state.management, hit);

  hit = false;
  for (const field of ["active", "goal_stated", "reassessment_interval_stated", "escalation_criteria_stated"]) {
    hit = latch(state.observation, field, delta.observation?.[field]) || hit;
  }
  touch(state.observation, hit);

  touch(state.reassessment, latch(state.reassessment, "stated", delta.reassessment?.stated));
  touch(state.contingency, latch(state.contingency, "stated", delta.contingency?.stated));

  hit = latch(state.disposition, "stated", delta.disposition?.stated);
  if (delta.disposition?.destination && state.disposition.destination !== delta.disposition.destination) {
    state.disposition.destination = delta.disposition.destination;
    state.disposition.stated = true;
    changed = true;
    hit = true;
  }
  touch(state.disposition, hit);

  hit = false;
  for (const field of ["own_assessment_stated", "consultation_question_stated"]) {
    hit = latch(state.consultation, field, delta.consultation?.[field]) || hit;
  }
  touch(state.consultation, hit);

  return { state, changed };
}

/**
 * The predicate vocabulary heuristics may name in `reasoning_all` /
 * `reasoning_none`.
 *
 * An explicit closed list rather than dotted paths into the state object: a
 * typo becomes a test failure instead of a condition that silently never
 * matches. That failure mode has already cost this project once, when
 * heuristics gated on phase names the engine does not use.
 */
export const REASONING_FLAGS = [
  "stability_stated",
  "problem_representation_stated",
  "working_diagnosis_stated",
  "diagnostic_uncertainty_stated",
  "differential_stated",
  "differential_ranked",
  "dangerous_alternative_stated",
  "management_plan_stated",
  "management_urgency_stated",
  "management_rationale_stated",
  "observation_active",
  "observation_goal_stated",
  "observation_interval_stated",
  "observation_escalation_stated",
  "observation_plan_complete",
  "reassessment_stated",
  "contingency_stated",
  "disposition_stated",
  "consultation_own_assessment_stated",
  "consultation_question_stated",
  "investigation_without_stated_purpose",
];

/**
 * Flatten a reasoning state into the flag set the heuristic matcher consumes.
 */
export function reasoningFlags(state) {
  const s = state || createEmptyReasoningState();
  const observationComplete =
    s.observation.goal_stated &&
    s.observation.reassessment_interval_stated &&
    s.observation.escalation_criteria_stated;

  const flags = new Set();
  const set = (name, value) => {
    if (value) flags.add(name);
  };

  set("stability_stated", s.stability.stated);
  set("problem_representation_stated", s.problem_representation.stated);
  set("working_diagnosis_stated", s.working_diagnosis.stated);
  set("diagnostic_uncertainty_stated", s.working_diagnosis.uncertainty_stated);
  set("differential_stated", s.differential.stated);
  set("differential_ranked", s.differential.ranked);
  set("dangerous_alternative_stated", s.differential.has_dangerous_alternative);
  set("management_plan_stated", s.management.plan_stated);
  set("management_urgency_stated", s.management.urgency_stated);
  set("management_rationale_stated", s.management.rationale_stated);
  set("observation_active", s.observation.active);
  set("observation_goal_stated", s.observation.goal_stated);
  set("observation_interval_stated", s.observation.reassessment_interval_stated);
  set("observation_escalation_stated", s.observation.escalation_criteria_stated);
  set("observation_plan_complete", observationComplete);
  set("reassessment_stated", s.reassessment.stated);
  set("contingency_stated", s.contingency.stated);
  set("disposition_stated", s.disposition.stated);
  set("consultation_own_assessment_stated", s.consultation.own_assessment_stated);
  set("consultation_question_stated", s.consultation.consultation_question_stated);
  set(
    "investigation_without_stated_purpose",
    s.investigations.items.some((item) => !item.purpose_stated)
  );

  return flags;
}
