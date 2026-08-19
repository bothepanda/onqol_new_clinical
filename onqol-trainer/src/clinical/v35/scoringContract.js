// Weights, domains and safety gates for the fourteen core actions.
//
// REVIEWED PROVISIONAL, STILL NOT SCORING
//
// The surgeon signed these off on 09.08.2026 as provisional: the numbers are
// hers, and scoring stays OFF until pilot calibration. `clinical_review_status`
// is `reviewed_provisional` rather than `pending` - reviewed is not the same as
// live, and conflating them is how an uncalibrated weight starts grading people.
//
// WHY THIS IS NOT IN coreActions.js
//
// Core actions carry `score_weight` fields that the existing engine reads. This
// file declares the reviewed intent alongside them without switching anything
// on. When calibration closes, one change moves these into the scored path; if
// they had been written straight into coreActions, there would be no moment
// where a human decided to turn them on.
//
// A GATE IS NOT A BOOLEAN
//
// The surgeon's correction: "blocking не должен быть глобальным boolean".
// Consent blocks an intervention, but an emergency operation on a patient who
// cannot consent is lawful and documented - so a gate needs a scope, a list of
// what it actually blocks, and the conditions under which it is waived.
//
// The WHO checklist is three gates, not one: sign-in before induction, time-out
// before incision, sign-out before the patient leaves theatre. One boolean
// cannot express "the time-out was done and the sign-out was not".

export const V35_SCORING_CONTRACT_VERSION = "3.5.0";
export const V35_SCORING_REVIEW_STATUS = "reviewed_provisional_unvalidated";

export const SCORING_DOMAINS = Object.freeze([
  "perioperative_safety",
  "diagnostic_reasoning",
  "escalation",
  "communication",
]);

/**
 * @typedef {Object} GateSpec
 * @property {string} gate_scope        what stage the gate guards
 * @property {string[]} blocks_action_ids  which actions it stops
 * @property {string[]} waiver_conditions  when it may be passed without being met
 */

const noGate = Object.freeze({ gate_scope: "none", blocks_action_ids: [], waiver_conditions: [] });

/**
 * The three WHO checkpoints, declared separately.
 *
 * Each checkpoint has its own runtime leaf. The canonical contract remains one
 * reviewed-provisional rubric row while numeric scoring is disabled.
 */
export const WHO_CHECKPOINTS = Object.freeze([
  Object.freeze({
    checkpoint_id: "sign_in",
    gate_scope: "before_induction",
    // Empty since CDR-18 (owner, 20.08.2026). The checkpoints remain real and
    // remain part of the rubric; they are theatre work, largely the nursing
    // team's, and they no longer block a resident's path. What they protect -
    // consent and a warned anaesthetist - blocks induction on its own terms.
    blocks_action_ids: [],
    waiver_conditions: ["life_threatening_haemorrhage_documented"],
    clinical_review_status: "reviewed_provisional",
  }),
  Object.freeze({
    checkpoint_id: "time_out",
    gate_scope: "before_incision",
    blocks_action_ids: [],
    waiver_conditions: [],
    clinical_review_status: "reviewed_provisional",
  }),
  Object.freeze({
    checkpoint_id: "sign_out",
    gate_scope: "before_leaving_theatre",
    blocks_action_ids: [],
    waiver_conditions: [],
    clinical_review_status: "reviewed_provisional",
  }),
]);

/**
 * @typedef {Object} ScoringContractEntry
 * @property {string} canonical_id
 * @property {string} leaf_action_id     the id the engine already uses
 * @property {string} domain
 * @property {number} score_weight       provisional
 * @property {number} criticality        0-4
 * @property {GateSpec} gate
 * @property {boolean} conditional       scored only when the state warrants it
 */

/** @type {ScoringContractEntry[]} */
export const SCORING_CONTRACT = Object.freeze([
  {
    canonical_id: "informed_consent",
    leaf_action_id: "informed_consent",
    domain: "perioperative_safety",
    score_weight: 2,
    criticality: 4,
    gate: {
      gate_scope: "before_intervention",
      blocks_action_ids: ["appendectomy_here"],
      // The surgeon's example: an emergency operation on a patient who cannot
      // consent is lawful when the exception is documented.
      waiver_conditions: [
        "emergency_and_patient_lacks_capacity_documented",
        "life_threatening_delay_documented",
      ],
    },
  },
  {
    canonical_id: "notify_anesthesia",
    leaf_action_id: "notify_anesthesia",
    domain: "perioperative_safety",
    score_weight: 2,
    criticality: 3,
    gate: {
      gate_scope: "before_induction",
      blocks_action_ids: ["appendectomy_here"],
      waiver_conditions: [],
    },
  },
  {
    canonical_id: "notify_operating_team",
    leaf_action_id: "notify_operating_team",
    domain: "perioperative_safety",
    score_weight: 1,
    criticality: 2,
    gate: noGate,
  },
  {
    canonical_id: "who_surgical_safety_checkpoints",
    leaf_action_id: "who_time_out",
    leaf_action_ids: ["who_sign_in", "who_time_out", "who_sign_out"],
    domain: "perioperative_safety",
    score_weight: 2,
    criticality: 4,
    // No longer a gate: see CDR-18 and the note on WHO_CHECKPOINTS above. The
    // row stays in the rubric - the checkpoints are still worth discussing in
    // the debrief - and its weight and criticality remain a CDR-10 question.
    gate: {
      gate_scope: "none",
      blocks_action_ids: [],
      waiver_conditions: [],
      checkpoints: WHO_CHECKPOINTS.map((checkpoint) => checkpoint.checkpoint_id),
    },
  },
  {
    canonical_id: "preop_risk_assessment",
    leaf_action_id: "preop_risk_assessment",
    domain: "perioperative_safety",
    score_weight: 2,
    criticality: 3,
    gate: {
      gate_scope: "before_induction",
      blocks_action_ids: ["appendectomy_here"],
      waiver_conditions: [],
    },
  },
  {
    canonical_id: "vte_risk_assessment",
    leaf_action_id: "vte_risk_assessment",
    domain: "perioperative_safety",
    score_weight: 1,
    criticality: 2,
    gate: noGate,
  },
  {
    canonical_id: "vital_signs_reassessment",
    leaf_action_id: "vital_signs_reassessment",
    domain: "diagnostic_reasoning",
    score_weight: 3,
    criticality: 3,
    gate: noGate,
  },
  {
    canonical_id: "recognize_sepsis",
    leaf_action_id: "recognize_sepsis",
    domain: "diagnostic_reasoning",
    score_weight: 4,
    criticality: 4,
    gate: noGate,
    // Scored only where the state warrants it. Elsewhere `not_applicable`, never
    // `missed`: a learner cannot fail to recognise sepsis in a patient who has
    // none.
    conditional: true,
    condition_ru: "оценивается только при совместимом септическом состоянии",
  },
  {
    canonical_id: "call_senior_surgeon",
    leaf_action_id: "call_senior_surgeon",
    domain: "escalation",
    score_weight: 3,
    criticality: 4,
    gate: noGate,
    conditional: true,
    condition_ru: "оценивается только при наличии показаний к эскалации",
  },
  {
    canonical_id: "call_intensive_care",
    leaf_action_id: "call_intensive_care",
    domain: "escalation",
    score_weight: 4,
    criticality: 4,
    gate: noGate,
    conditional: true,
    condition_ru: "оценивается только при наличии показаний к эскалации",
  },
  {
    // Renamed on the surgeon's instruction and moved out of escalation. Naming
    // uncertainty is a reasoning act, not a call for help: a resident who says
    // "I do not know yet, and here is what would tell me" has reasoned, not
    // escalated.
    canonical_id: "calibrate_and_state_uncertainty",
    leaf_action_id: "declare_uncertainty",
    legacy_canonical_id: "declare_uncertainty",
    domain: "diagnostic_reasoning",
    score_weight: 2,
    criticality: 2,
    gate: noGate,
  },
  {
    canonical_id: "structured_handover",
    leaf_action_id: "structured_handover",
    domain: "communication",
    score_weight: 2,
    criticality: 3,
    gate: noGate,
  },
  {
    canonical_id: "explain_to_patient",
    leaf_action_id: "explain_to_patient",
    domain: "communication",
    score_weight: 2,
    criticality: 2,
    gate: noGate,
  },
  {
    canonical_id: "document_decision",
    leaf_action_id: "document_decision",
    domain: "communication",
    score_weight: 1,
    criticality: 2,
    gate: noGate,
  },
].map((entry) =>
  Object.freeze({
    conditional: false,
    ...entry,
    gate: Object.freeze({ ...entry.gate }),
    clinical_review_status: "reviewed_provisional",
    // Reviewed is not live. Scoring stays off until pilot calibration.
    eligible_for_scoring: false,
  })
));

export const contractByLeafId = new Map(
  SCORING_CONTRACT.flatMap((entry) =>
    (entry.leaf_action_ids || [entry.leaf_action_id]).map((leafId) => [leafId, entry])
  )
);

/**
 * Which contract entries count for a given case.
 *
 * The surgeon's requirement: "итоговый балл должен нормализоваться по действиям,
 * доступным в конкретном case preset". An action the case does not contain is
 * not in the denominator - a male patient's case owes nobody a beta-hCG, and a
 * learner who never ordered one has not missed anything.
 *
 * @param {object} caseData
 * @returns {{domain: string, entries: ScoringContractEntry[], max_weight: number}[]}
 */
export function scorableByDomain(caseData) {
  const present = new Set(
    [
      ...(caseData.expected_actions || []),
      ...(caseData.acceptable_alternatives || []),
      ...(caseData.unnecessary_actions || []),
      ...(caseData.unsafe_actions || []),
    ].map((action) => action.id)
  );

  return SCORING_DOMAINS.map((domain) => {
    const entries = SCORING_CONTRACT.filter(
      (entry) =>
        entry.domain === domain
        && (entry.leaf_action_ids || [entry.leaf_action_id]).some((leafId) => present.has(leafId))
    );
    return {
      domain,
      entries,
      // Conditional entries are excluded from the denominator until their
      // condition holds; the engine adds them when it does.
      max_weight: entries
        .filter((entry) => !entry.conditional)
        .reduce((total, entry) => total + entry.score_weight, 0),
    };
  });
}
