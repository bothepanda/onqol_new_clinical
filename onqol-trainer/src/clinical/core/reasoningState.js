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
// naming is deliberate: `stated`, `learner_assessment`, `*_stated`, `*_verbatim`.
// Nothing here says the patient is stable - only that the learner said so.
// Clinical truth stays deterministic and case-owned, and the router is forbidden
// from judging medical correctness (see buildSemanticRouterPrompt).
//
// VERBATIM FIELDS AND THE NO-FACTS INVARIANT
//
// The invariant used to read "the brief carries no patient facts". It now reads:
// the brief carries no CASE-OWNED patient facts, and may carry the learner's own
// words, quoted exactly and attributed to them.
//
// The change is deliberate and is the position ONQOL_NORTH_STAR.md takes: the
// mentor sees the data available to the learner, their actions and their
// argumentation. The lock exists so the mentor cannot tell the learner something
// the learner was never given - and a learner's own sentence fails that test by
// construction. It cannot leak to them what they themselves just said.
//
// Two properties keep it safe, and both are enforced rather than promised:
//
//   1. A verbatim field must occur in the message the learner actually sent
//      (see verbatimOrNull). A model paraphrase is dropped, so the mentor can
//      never quote back words the learner did not use.
//   2. A quote is a CLAIM, not a finding. The mentor prompt is told it may
//      question a quote and may never endorse it as true. "Пациентка
//      стабильна" in this file means the learner said that, whether or not the
//      patient is stable - and the patient's real state stays where it was, in
//      the case.
//
// Without these fields the first and third clinical-reasoning skills (compress
// the patient, justify the hypotheses) are recorded only as booleans: the system
// knows the learner formulated something and not what, so the mentor cannot
// discuss the formulation. That is the whole reason they exist.
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
    // The learner's one-sentence summary of who is in front of them, in their
    // own words. `verbatim` is null when they summarised without the router
    // being able to quote it - the flag stays true either way.
    problem_representation: { stated: false, verbatim: null, updated_turn: null },
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
      // Flat list of every hypothesis named, kept for callers that only need to
      // know "which diagnoses were mentioned". Derived from `items`.
      concept_ids: [],
      // One record per hypothesis: which one it is, where the learner placed it,
      // and whether they flagged it as the one that must not be missed.
      //
      // `has_dangerous_alternative` says a dangerous alternative was mentioned;
      // `items[].dangerous` says WHICH. The difference is the whole point: a
      // mentor can ask "почему именно её ты считаешь опасной" only if it knows.
      //
      // `evidence_for` / `evidence_against` hold the learner's own words about
      // what supports or argues against each hypothesis - the raw material of
      // diagnostic justification. Quotes only; see the header.
      // { concept_id, rank, dangerous, evidence_for, evidence_against, updated_turn }
      items: [],
      updated_turn: null,
    },
    // One entry per investigation the learner has spoken about. `justification`
    // is their own wording for why they want it - "ХГЧ нужен, чтобы исключить
    // беременность" - which is what turns a purpose flag into something a
    // mentor can actually discuss.
    // { action_id, purpose_stated, management_consequence_stated, justification,
    //   updated_turn }
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
    contingency: {
      stated: false,
      // Presence and quality are separate. A short contextual answer such as
      // "резкое ухудшение" is a real contingency, but remains vague.
      specificity: null,
      // Which investigations the learner named as able to change the plan.
      //
      // Concept ids only, never a result. "Если ХГЧ положительный — меняю
      // тактику" records `pregnancy_test`, not the word "положительный": the
      // trigger is a test the case carries, and a hypothetical result the
      // learner imagined is not a finding about this patient.
      //
      // A trigger the learner phrases as a change in the patient rather than as
      // an investigation ("если станет хуже") records nothing here and leaves
      // `stated` true on its own. Deliberate: the alternative is storing a
      // clinical sign, which is the fact channel this module stays out of.
      trigger_concept_ids: [],
      // "Что заставит тебя поменять план" in the learner's own words, whether or
      // not it named an investigation. This is where a trigger phrased as a
      // change in the patient survives instead of being thrown away.
      trigger_verbatim: [],
      updated_turn: null,
    },
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

/** A rank is a place in a list: 1, 2, 3. Anything else is not a rank. */
function rankOrNull(value) {
  const rank = Number(value);
  return Number.isInteger(rank) && rank >= 1 ? rank : null;
}

const MAX_VERBATIM_CHARS = 400;

function foldForComparison(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The quote guard.
 *
 * Verbatim fields are the one place where words about the patient enter the
 * mentor's brief. They are safe only while they are genuinely the learner's own
 * words, so a candidate is kept only when it actually occurs in the message the
 * learner sent this turn.
 *
 * A model paraphrase ("the resident summarised the patient as stable") is
 * dropped, and so is a hallucinated finding. Without this the router could write
 * anything at all into a field the mentor is told it may quote back - and the
 * learner would hear their own voice saying something they never said.
 *
 * Case folding and whitespace are normalised, because a model re-emitting a
 * quote may change neither the words nor anything that matters. Punctuation and
 * word order are NOT normalised: at that point it is no longer a quote.
 *
 * @param {unknown} value        candidate quote from the router
 * @param {string|null} learnerText  the raw message this turn, or null to skip
 *        the check entirely (used where no text is available, e.g. direct unit
 *        construction; callers that have the text must pass it)
 * @returns {string|null}
 */
export function verbatimOrNull(value, learnerText) {
  if (typeof value !== "string") return null;
  const quote = value.trim();
  if (!quote || quote.length > MAX_VERBATIM_CHARS) return null;
  if (learnerText === null || learnerText === undefined) return quote;
  return foldForComparison(learnerText).includes(foldForComparison(quote)) ? quote : null;
}

function verbatimList(value, learnerText) {
  if (!Array.isArray(value)) return [];
  const kept = [];
  for (const item of value) {
    const quote = verbatimOrNull(item, learnerText);
    if (quote && !kept.includes(quote)) kept.push(quote);
  }
  return kept;
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
  // Every quote below is checked against this. Undefined means "no text
  // supplied", which skips the check - so a caller that has the learner's
  // message must pass it, and routeUserInput does.
  const learnerText = options.learnerText;
  const quote = (value) => verbatimOrNull(value, learnerText);
  const quotes = (value) => verbatimList(value, learnerText);

  // Hypotheses arrive either as rich items (rank, dangerous) or as a bare id
  // list. Both are accepted: the router is a model, and a payload that predates
  // the richer schema must degrade to "named, unranked" rather than to nothing.
  const rawItems = Array.isArray(raw.differential?.items)
    ? raw.differential.items
    : (Array.isArray(raw.differential?.concept_ids) ? raw.differential.concept_ids : []).map(
        (conceptId) => ({ concept_id: conceptId })
      );

  const differentialItems = [];
  for (const item of rawItems) {
    const conceptId = typeof item === "string" ? item : item?.concept_id;
    if (!known(conceptId)) continue;
    if (differentialItems.some((existing) => existing.concept_id === conceptId)) continue;
    const record = typeof item === "string" ? {} : item || {};
    differentialItems.push({
      concept_id: conceptId,
      rank: rankOrNull(record.rank),
      dangerous: bool(record.dangerous),
      evidence_for: quotes(record.evidence_for),
      evidence_against: quotes(record.evidence_against),
    });
  }
  const differentialIds = differentialItems.map((item) => item.concept_id);

  const contingencyTriggers = (
    Array.isArray(raw.contingency?.trigger_concept_ids) ? raw.contingency.trigger_concept_ids : []
  ).filter((conceptId, index, list) => known(conceptId) && list.indexOf(conceptId) === index);
  const contingencyQuotes = quotes(raw.contingency?.trigger_verbatim);

  const problemRepresentation = quote(raw.problem_representation_verbatim);

  // Test reasoning may reference only concepts this case actually carries.
  const investigations = (Array.isArray(raw.test_reasoning) ? raw.test_reasoning : [])
    .filter((item) => item && known(item.concept_id))
    .map((item) => ({
      action_id: item.concept_id,
      purpose_stated: bool(item.purpose_stated),
      management_consequence_stated: bool(item.management_consequence_stated),
      justification: quote(item.justification),
    }));

  return {
    stability: {
      stated: bool(raw.stability?.stated),
      learner_assessment: enumOrNull(raw.stability?.learner_assessment, STABILITY_ASSESSMENTS),
    },
    problem_representation: {
      // A quote that survives the guard proves the summary was made, even if the
      // router forgot to set the flag.
      stated: bool(raw.problem_representation_stated) || problemRepresentation !== null,
      verbatim: problemRepresentation,
    },
    working_diagnosis: {
      stated: bool(raw.working_diagnosis?.stated),
      concept_id: known(raw.working_diagnosis?.concept_id) ? raw.working_diagnosis.concept_id : null,
      uncertainty_stated: bool(raw.working_diagnosis?.uncertainty_stated),
    },
    differential: {
      stated: bool(raw.differential?.stated),
      // A list carrying an explicit rank IS a ranked list, whether or not the
      // router also set the flag. The flag alone stays supported for payloads
      // that report ranking without naming the order.
      ranked:
        bool(raw.differential?.ranked) || differentialItems.some((item) => item.rank !== null),
      has_dangerous_alternative:
        bool(raw.differential?.has_dangerous_alternative) ||
        differentialItems.some((item) => item.dangerous),
      concept_ids: differentialIds,
      items: differentialItems,
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
    contingency: {
      // Naming a trigger is stating a contingency, whichever field the router
      // filled. `contingency_stated` is the pre-existing flat form.
      stated:
        bool(raw.contingency_stated) ||
        bool(raw.contingency?.stated) ||
        contingencyTriggers.length > 0 ||
        contingencyQuotes.length > 0,
      specificity: ["vague", "partial", "specific"].includes(raw.contingency?.specificity)
        ? raw.contingency.specificity
        : null,
      trigger_concept_ids: contingencyTriggers,
      trigger_verbatim: contingencyQuotes,
    },
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
  // A state restored from a session saved before hypothesis records existed has
  // no `items` and no `trigger_concept_ids`. Rebuild them from what that older
  // shape did carry rather than throwing on a resumed session.
  if (!Array.isArray(state.differential.items)) {
    state.differential.items = (state.differential.concept_ids || []).map((conceptId) => ({
      concept_id: conceptId,
      rank: null,
      dangerous: false,
      updated_turn: null,
    }));
  }
  if (!Array.isArray(state.contingency.trigger_concept_ids)) {
    state.contingency.trigger_concept_ids = [];
  }
  if (!Array.isArray(state.contingency.trigger_verbatim)) state.contingency.trigger_verbatim = [];
  if (!("specificity" in state.contingency)) state.contingency.specificity = null;
  for (const item of state.differential.items) {
    if (!Array.isArray(item.evidence_for)) item.evidence_for = [];
    if (!Array.isArray(item.evidence_against)) item.evidence_against = [];
  }
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

  hit = latch(state.problem_representation, "stated", delta.problem_representation?.stated);
  // A later formulation supersedes an earlier one. Re-summarising the patient
  // after new data is the reasoning changing, and keeping the first attempt
  // would show the mentor a summary the learner has already moved past.
  if (
    delta.problem_representation?.verbatim &&
    state.problem_representation.verbatim !== delta.problem_representation.verbatim
  ) {
    state.problem_representation.verbatim = delta.problem_representation.verbatim;
    state.problem_representation.stated = true;
    changed = true;
    hit = true;
  }
  touch(state.problem_representation, hit);

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
  for (const incoming of delta.differential?.items || []) {
    const existing = state.differential.items.find(
      (item) => item.concept_id === incoming.concept_id
    );
    if (!existing) {
      state.differential.items.push({ ...incoming, updated_turn: turnNumber });
      changed = true;
      hit = true;
      continue;
    }
    // Danger latches: flagged once, flagged for good. Rank supersedes, because
    // reordering a differential is exactly the reasoning change worth seeing -
    // a learner who moves ectopic from third to first has changed their mind,
    // and freezing the first answer would hide it.
    if (incoming.dangerous === true && existing.dangerous !== true) {
      existing.dangerous = true;
      existing.updated_turn = turnNumber;
      changed = true;
      hit = true;
    }
    if (incoming.rank !== null && existing.rank !== incoming.rank) {
      existing.rank = incoming.rank;
      existing.updated_turn = turnNumber;
      changed = true;
      hit = true;
    }
    // Evidence accumulates. A learner who argues for a hypothesis across three
    // turns has built one case for it, not three separate ones.
    for (const field of ["evidence_for", "evidence_against"]) {
      for (const line of incoming[field] || []) {
        if (!existing[field].includes(line)) {
          existing[field].push(line);
          existing.updated_turn = turnNumber;
          changed = true;
          hit = true;
        }
      }
    }
  }
  state.differential.concept_ids = state.differential.items.map((item) => item.concept_id);
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
    if (incoming.justification && existing.justification !== incoming.justification) {
      existing.justification = incoming.justification;
      existing.updated_turn = turnNumber;
      changed = true;
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

  hit = latch(state.contingency, "stated", delta.contingency?.stated);
  if (
    delta.contingency?.specificity &&
    state.contingency.specificity !== delta.contingency.specificity
  ) {
    state.contingency.specificity = delta.contingency.specificity;
    state.contingency.stated = true;
    changed = true;
    hit = true;
  }
  for (const [field, incoming] of [
    ["trigger_concept_ids", delta.contingency?.trigger_concept_ids],
    ["trigger_verbatim", delta.contingency?.trigger_verbatim],
  ]) {
    for (const entry of incoming || []) {
      if (!state.contingency[field].includes(entry)) {
        state.contingency[field].push(entry);
        state.contingency.stated = true;
        changed = true;
        hit = true;
      }
    }
  }
  touch(state.contingency, hit);

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

/** Merge two normalised deltas from the same learner turn. */
export function mergeTurnReasoningDeltas(primary, contextual) {
  if (!primary) return contextual || null;
  if (!contextual) return primary;
  const merged = structuredClone(primary);
  const combine = (target, incoming, fields) => {
    for (const field of fields) target[field] = Boolean(target[field] || incoming?.[field]);
  };
  combine(merged.stability, contextual.stability, ["stated"]);
  combine(merged.problem_representation, contextual.problem_representation, ["stated"]);
  combine(merged.working_diagnosis, contextual.working_diagnosis, [
    "stated",
    "uncertainty_stated",
  ]);
  combine(merged.differential, contextual.differential, [
    "stated",
    "ranked",
    "has_dangerous_alternative",
  ]);
  combine(merged.management, contextual.management, [
    "plan_stated",
    "urgency_stated",
    "rationale_stated",
  ]);
  combine(merged.observation, contextual.observation, [
    "active",
    "goal_stated",
    "reassessment_interval_stated",
    "escalation_criteria_stated",
  ]);
  combine(merged.reassessment, contextual.reassessment, ["stated"]);
  combine(merged.contingency, contextual.contingency, ["stated"]);
  combine(merged.disposition, contextual.disposition, ["stated"]);
  combine(merged.consultation, contextual.consultation, [
    "own_assessment_stated",
    "consultation_question_stated",
  ]);
  if (contextual.contingency?.specificity) {
    merged.contingency.specificity = contextual.contingency.specificity;
  }
  for (const field of ["trigger_concept_ids", "trigger_verbatim"]) {
    merged.contingency[field] = [
      ...new Set([...(merged.contingency[field] || []), ...(contextual.contingency?.[field] || [])]),
    ];
  }
  merged.investigations = [
    ...(merged.investigations || []),
    ...(contextual.investigations || []),
  ];
  return merged;
}

/** Which reasoning measurements materially changed on a given turn. */
export function reasoningFlagsUpdatedOnTurn(state, turnNumber) {
  if (!state || !Number.isInteger(turnNumber)) return new Set();
  const flags = reasoningFlags(state);
  const updated = new Set();
  const sectionFor = {
    stability_stated: state.stability,
    problem_representation_stated: state.problem_representation,
    working_diagnosis_stated: state.working_diagnosis,
    diagnostic_uncertainty_stated: state.working_diagnosis,
    differential_stated: state.differential,
    differential_ranked: state.differential,
    dangerous_alternative_stated: state.differential,
    leading_hypothesis_named: state.working_diagnosis,
    multiple_hypotheses_stated: state.differential,
    dangerous_alternative_named: state.differential,
    hypothesis_evidence_for_stated: state.differential,
    hypothesis_evidence_against_stated: state.differential,
    management_plan_stated: state.management,
    management_urgency_stated: state.management,
    management_rationale_stated: state.management,
    observation_active: state.observation,
    observation_goal_stated: state.observation,
    observation_interval_stated: state.observation,
    observation_escalation_stated: state.observation,
    observation_plan_complete: state.observation,
    reassessment_stated: state.reassessment,
    contingency_stated: state.contingency,
    contingency_trigger_named: state.contingency,
    disposition_stated: state.disposition,
    consultation_own_assessment_stated: state.consultation,
    consultation_question_stated: state.consultation,
  };
  for (const flag of flags) {
    const section = sectionFor[flag];
    if (section?.updated_turn === turnNumber) updated.add(flag);
  }
  if (
    (state.investigations?.items || []).some((item) => item.updated_turn === turnNumber)
  ) {
    for (const flag of ["investigation_justified", "investigation_without_stated_purpose"]) {
      if (flags.has(flag)) updated.add(flag);
    }
  }
  return updated;
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
  // The four below are about the CONTENT of the reasoning, not its presence.
  // Each has a weaker sibling above, and the pair is what lets a checkpoint tell
  // "said something about a differential" from "actually named and ordered one".
  "leading_hypothesis_named",
  "multiple_hypotheses_stated",
  "dangerous_alternative_named",
  "contingency_trigger_named",
  // Diagnostic justification, the third reasoning skill. "For" and "against" are
  // separate on purpose: arguing FOR a hypothesis is the easy half, and
  // SURGICAL_MENTOR_LOGIC.md 5 asks the other question - "what does not fit?"
  "hypothesis_evidence_for_stated",
  "hypothesis_evidence_against_stated",
  "investigation_justified",
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

  const items = s.differential.items || [];
  // The working diagnosis counts as a hypothesis. A learner who says "думаю на
  // аппендицит, но нельзя пропустить внематочную" has named two, even though
  // only one of them landed in the differential list.
  const named = new Set(items.map((item) => item.concept_id));
  if (s.working_diagnosis.concept_id) named.add(s.working_diagnosis.concept_id);

  set("leading_hypothesis_named", Boolean(s.working_diagnosis.concept_id));
  set("multiple_hypotheses_stated", named.size >= 2);
  set("dangerous_alternative_named", items.some((item) => item.dangerous));
  set(
    "contingency_trigger_named",
    (s.contingency.trigger_concept_ids || []).length > 0 ||
      (s.contingency.trigger_verbatim || []).length > 0
  );
  set("hypothesis_evidence_for_stated", items.some((item) => (item.evidence_for || []).length > 0));
  set(
    "hypothesis_evidence_against_stated",
    items.some((item) => (item.evidence_against || []).length > 0)
  );
  set("investigation_justified", s.investigations.items.some((item) => item.justification));
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

/**
 * When each reasoning flag first became true, across a session.
 *
 * This is the measurement the whole module exists for: not "did the learner
 * rank a differential" but "at which point in the case did they". Two residents
 * who both end with a complete reasoning state are not the same resident if one
 * got there on turn 2 and the other on turn 11.
 *
 * Reads the session event log, which already carries `reasoning_state_after` on
 * every turn - so there is no second copy of the state to keep in sync. Flags
 * latch, so the first turn a flag appears is the turn it was articulated.
 *
 * A flag never articulated is simply absent from the result. Absence is data:
 * it is the answer to "what did this resident never say out loud".
 *
 * @param {object[]} eventLog  session.eventLog
 * @returns {Map<string, number>} flag -> turn number
 */
export function reasoningTrajectory(eventLog = []) {
  const firstSeen = new Map();
  const turns = eventLog
    .filter((entry) => entry?.event_type === "clinical_turn" && entry.reasoning_state_after)
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

  for (const entry of turns) {
    const turnNumber = entry.turn_number ?? entry.sequence ?? firstSeen.size;
    for (const flag of reasoningFlags(entry.reasoning_state_after)) {
      if (!firstSeen.has(flag)) firstSeen.set(flag, turnNumber);
    }
  }
  return firstSeen;
}
