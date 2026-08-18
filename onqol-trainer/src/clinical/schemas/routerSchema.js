// The semantic router contract. One definition, imported by everything.
//
// WHY THIS FILE EXISTS
//
// The prompt and the strict JSON Schema used to live in different files and had
// drifted apart. The prompt asked for ranked hypotheses with evidence spans, a
// verbatim problem representation, a justification per investigation and a
// contingency object. The gateway's schema allowed a bare list of concept ids,
// no verbatim, no justification and a single `contingency_stated` boolean.
//
// With `strict: true`, Structured Outputs cannot return a field the schema does
// not name. So the prompt was asking for reasoning the transport was physically
// unable to carry, and the difference was invisible: the model answered inside
// the schema it was given, and the richer half was silently never produced.
//
// The first live run shows the cost. "Подозрение на воспаление простаты или
// проблемы с кишечником" came back as `differential.stated = true` with an empty
// list - the learner named two hypotheses and the trainer recorded none, then
// asked her to rank a list that was empty.
//
// Anything that builds the prompt, validates a response or ships the schema to
// the provider now reads THIS file, and a test asserts they agree.
//
// WHAT THE ROUTER IS FOR, AND WHAT IT MAY NOT DO
//
// It transcribes. It reports that the learner made a claim and quotes the words
// they used. It never judges whether the claim is medically right, never invents
// a concept id, and nothing it returns can complete an action or move a score -
// those are the deterministic engine's alone.

import { DISPOSITION_DESTINATIONS, STABILITY_ASSESSMENTS } from "../core/reasoningState.js";

/**
 * Bump on any change to the shape below.
 *
 * Logged with every routed turn, so a session recorded under one contract can
 * be told apart from a session recorded under another.
 */
export const ROUTER_SCHEMA_VERSION = "router-v3";

export const ROUTER_INTENT_TYPES = Object.freeze([
  "request_history",
  "request_examination",
  "request_test",
  "diagnosis",
  "management",
  "question",
  "unknown",
]);

/** Routes of administration the router may transcribe. */
export const ADMINISTRATION_ROUTES = Object.freeze([
  "intravenous",
  "intramuscular",
  "oral",
  "rectal",
  "subcutaneous",
  "other",
]);

const bool = { type: "boolean" };
const nullableString = { type: ["string", "null"] };
const stringList = { type: "array", items: { type: "string" } };

/** Strict object helper: OpenAI requires every property to be required. */
function strictObject(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/**
 * Treatment parameters, transcription only.
 *
 * The first live run lost "кетотоп 2 мг в/м" into a bare `analgesia`, and
 * "1 л быстро, 1 л за след 3 часа" into a bare `iv_fluids`. Neither the volume,
 * the rate, the drug nor the route survived, so no reviewer could tell what was
 * actually ordered.
 *
 * These fields NEVER create an action, never confirm one is right and never move
 * a score. They attach to an intent the engine already validated, and they exist
 * so a clinician can read the session afterwards. `verbatim` is the anchor: a
 * normalised value that is not backed by an exact span of the learner's own text
 * is discarded by the caller.
 */
const actionParameters = strictObject({
  concept_id: { type: "string" },
  verbatim: { type: "string" },
  drug_name: nullableString,
  dose_value: { type: ["number", "null"] },
  dose_unit: nullableString,
  route: { type: ["string", "null"], enum: [...ADMINISTRATION_ROUTES, null] },
  rate: nullableString,
  frequency: nullableString,
  duration: nullableString,
  fluid_type: nullableString,
  volume_ml: { type: ["number", "null"] },
  timing: nullableString,
});

const reasoning = strictObject({
  stability: strictObject({
    stated: bool,
    learner_assessment: { type: ["string", "null"], enum: [...STABILITY_ASSESSMENTS, null] },
  }),
  problem_representation_stated: bool,
  // Added in router-v2. The prompt has always asked for it.
  problem_representation_verbatim: nullableString,
  working_diagnosis: strictObject({
    stated: bool,
    concept_id: nullableString,
    uncertainty_stated: bool,
  }),
  differential: strictObject({
    stated: bool,
    ranked: bool,
    has_dangerous_alternative: bool,
    // Added in router-v2, replacing a bare `concept_ids` list. One entry per
    // hypothesis the learner names, with the learner's own words as evidence.
    items: {
      type: "array",
      items: strictObject({
        concept_id: { type: "string" },
        rank: { type: ["integer", "null"] },
        dangerous: bool,
        evidence_for: stringList,
        evidence_against: stringList,
      }),
    },
  }),
  test_reasoning: {
    type: "array",
    items: strictObject({
      concept_id: { type: "string" },
      purpose_stated: bool,
      management_consequence_stated: bool,
      // Added in router-v2.
      justification: nullableString,
    }),
  },
  management: strictObject({
    plan_stated: bool,
    urgency_stated: bool,
    rationale_stated: bool,
  }),
  observation: strictObject({
    active: bool,
    goal_stated: bool,
    reassessment_interval_stated: bool,
    escalation_criteria_stated: bool,
  }),
  reassessment_stated: bool,
  // Added in router-v2, replacing a bare `contingency_stated` boolean. A
  // contingency without its trigger is not a contingency.
  contingency: strictObject({
    stated: bool,
    trigger_concept_ids: stringList,
    trigger_verbatim: stringList,
  }),
  disposition: strictObject({
    stated: bool,
    destination: { type: ["string", "null"], enum: [...DISPOSITION_DESTINATIONS, null] },
  }),
  consultation: strictObject({
    own_assessment_stated: bool,
    consultation_question_stated: bool,
  }),
});

/** The JSON Schema handed to the provider. */
export const ROUTER_JSON_SCHEMA = Object.freeze(
  strictObject({
    intents: {
      type: "array",
      items: strictObject({
        type: { type: "string", enum: [...ROUTER_INTENT_TYPES] },
        concept_id: nullableString,
        confidence: { type: "number" },
        // Exact learner span for this one intent. It is the audit link between
        // a compound sentence, the mapped action and any addressed failure.
        requested_fragment: nullableString,
      }),
    },
    unresolved_fragments: stringList,
    action_parameters: { type: "array", items: actionParameters },
    reasoning,
  })
);

/** The `text.format` envelope for the Responses API. */
export const ROUTER_RESPONSE_FORMAT = Object.freeze({
  type: "json_schema",
  name: "onqol_action_extraction",
  strict: true,
  schema: ROUTER_JSON_SCHEMA,
});
