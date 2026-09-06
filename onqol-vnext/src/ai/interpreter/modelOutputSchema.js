export const MODEL_INTERPRETATION_SCHEMA_VERSION = "interaction-shadow-v2.2";

export const INTERPRETATION_REASON_CODES = Object.freeze([
  "unsupported_concept",
  "missing_required_parameter",
  "missing_unit",
  "missing_route",
  "ambiguous_target",
  "ambiguous_action",
  "tentative_not_committed",
  "unrecognized_fragment",
]);

const TOP_LEVEL_KEYS = new Set([
  "clinicalActions",
  "reasoningDelta",
  "mentorAnswerDelta",
  "patientQuestions",
  "ambiguities",
  "unresolvedFragments",
  "meta",
]);
const REASONING_KEYS = new Set([
  "stability", "problemRepresentation", "workingDiagnosis", "differential", "investigations", "management",
  "observation", "reassessment", "contingency", "disposition", "consultation", "statement",
]);
const MENTOR_KEYS = new Set([
  "domains", "evidenceSpans", "contingency", "observationTargets", "rationale", "stuck",
]);
const REASON_CODES = new Set(INTERPRETATION_REASON_CODES);

export function validateModelOutput(candidate) {
  const errors = [];
  if (!plainObject(candidate)) return failure(["output_must_be_object"]);
  rejectUnknownKeys(candidate, TOP_LEVEL_KEYS, "output", errors);

  validateArray(candidate.clinicalActions, "clinicalActions", errors);
  validateArray(candidate.patientQuestions, "patientQuestions", errors);
  validateIssueArray(candidate.ambiguities, "ambiguities", errors);
  validateIssueArray(candidate.unresolvedFragments, "unresolvedFragments", errors);
  if (!plainObject(candidate.reasoningDelta)) errors.push("reasoningDelta_must_be_object");
  else rejectUnknownKeys(candidate.reasoningDelta, REASONING_KEYS, "reasoningDelta", errors);
  if (!plainObject(candidate.mentorAnswerDelta)) errors.push("mentorAnswerDelta_must_be_object");
  else {
    rejectUnknownKeys(candidate.mentorAnswerDelta, MENTOR_KEYS, "mentorAnswerDelta", errors);
    if (candidate.mentorAnswerDelta.domains !== undefined) {
      validateStringArray(candidate.mentorAnswerDelta.domains, "mentorAnswerDelta.domains", errors);
    }
    if (candidate.mentorAnswerDelta.evidenceSpans !== undefined) {
      validateNonEmptyStringArray(candidate.mentorAnswerDelta.evidenceSpans, "mentorAnswerDelta.evidenceSpans", errors, { allowEmpty: true });
    }
  }

  for (const [index, action] of (candidate.clinicalActions ?? []).entries()) {
    const path = `clinicalActions[${index}]`;
    if (!plainObject(action)) {
      errors.push(`${path}_must_be_object`);
      continue;
    }
    rejectUnknownKeys(action, new Set(["type", "params", "evidenceSpans", "statedParameters"]), path, errors);
    if (typeof action.type !== "string" || !action.type.trim()) errors.push(`${path}.type_required`);
    if (!plainObject(action.params)) errors.push(`${path}.params_must_be_object`);
    validateNonEmptyStringArray(action.evidenceSpans, `${path}.evidenceSpans`, errors);
    if (action.statedParameters !== undefined) validateStringArray(action.statedParameters, `${path}.statedParameters`, errors);
  }

  for (const [index, question] of (candidate.patientQuestions ?? []).entries()) {
    const path = `patientQuestions[${index}]`;
    if (!plainObject(question)) {
      errors.push(`${path}_must_be_object`);
      continue;
    }
    rejectUnknownKeys(question, new Set(["topic", "evidenceSpans"]), path, errors);
    if (typeof question.topic !== "string" || !question.topic.trim()) errors.push(`${path}.topic_required`);
    validateNonEmptyStringArray(question.evidenceSpans, `${path}.evidenceSpans`, errors);
  }

  if (!plainObject(candidate.meta)) {
    errors.push("meta_must_be_object");
  } else {
    rejectUnknownKeys(candidate.meta, new Set(["schemaVersion", "confidence", "debugExplanation"]), "meta", errors);
    if (candidate.meta.schemaVersion !== MODEL_INTERPRETATION_SCHEMA_VERSION) errors.push("schema_version_invalid");
    if (!Number.isFinite(candidate.meta.confidence) || candidate.meta.confidence < 0 || candidate.meta.confidence > 1) errors.push("confidence_out_of_range");
    if (candidate.meta.debugExplanation !== undefined && typeof candidate.meta.debugExplanation !== "string") errors.push("meta.debugExplanation_must_be_string");
  }

  return errors.length ? failure(errors) : { ok: true, value: structuredClone(candidate), errors: [] };
}

export function parseModelOutput(raw) {
  if (plainObject(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("provider_output_not_json");
  return JSON.parse(raw);
}

const issueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["evidenceSpan", "reason"],
  properties: {
    evidenceSpan: { type: "string", minLength: 1 },
    reason: { enum: INTERPRETATION_REASON_CODES },
    explanation: { type: "string" },
  },
};

export const MODEL_RESPONSE_FORMAT = Object.freeze({
  type: "json_schema",
  json_schema: {
    name: "onqol_interaction_shadow_v2",
    strict: false,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [...TOP_LEVEL_KEYS],
      properties: {
        clinicalActions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["type", "params", "evidenceSpans"],
            properties: {
              type: { type: "string" },
              params: { type: "object", additionalProperties: true },
              evidenceSpans: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
              statedParameters: { type: "array", items: { enum: ["dose", "dose_unit", "route", "volume", "duration", "interval", "bolus"] } },
            },
          },
        },
        reasoningDelta: {
          type: "object",
          additionalProperties: false,
          properties: {
            stability: objectSchema({ stated: { type: "boolean" }, learnerAssessment: { enum: ["stable", "unstable", "uncertain"] } }),
            problemRepresentation: objectSchema({ stated: { type: "boolean" }, verbatim: { type: "string" } }),
            workingDiagnosis: objectSchema({ stated: { type: "boolean" }, conceptId: { type: "string" }, uncertaintyExpressed: { type: "boolean" } }),
            differential: objectSchema({
              stated: { type: "boolean" },
              items: {
                type: "array",
                items: objectSchema({ conceptId: { type: "string" }, status: { enum: ["active", "deprioritized", "ruled_out"] } }),
              },
            }),
            investigations: objectSchema({
              items: {
                type: "array",
                items: objectSchema({ actionId: { type: "string" }, purposeStated: { type: "boolean" }, managementConsequenceStated: { type: "boolean" }, justification: { type: "string" } }),
              },
            }),
            management: objectSchema({ planStated: { type: "boolean" }, urgencyStated: { type: "boolean" }, rationaleStated: { type: "boolean" } }),
            observation: objectSchema({ active: { type: ["boolean", "null"] }, goalStated: { type: "boolean" }, reassessmentIntervalStated: { type: "boolean" }, escalationCriteriaStated: { type: "boolean" } }),
            reassessment: objectSchema({ stated: { type: "boolean" } }),
            contingency: objectSchema({ stated: { type: "boolean" }, specificity: { type: "string" }, triggerConceptIds: { type: "array", items: { type: "string" } } }),
            disposition: objectSchema({ stated: { type: "boolean" }, destination: { type: "string" } }),
            consultation: objectSchema({ ownAssessmentStated: { type: "boolean" }, consultationQuestionStated: { type: "boolean" } }),
            statement: { type: "string" },
          },
        },
        mentorAnswerDelta: {
          type: "object",
          additionalProperties: false,
          properties: {
            domains: { type: "array", items: { type: "string" } },
            evidenceSpans: { type: "array", items: { type: "string" } },
            contingency: objectSchema({ stated: { type: "boolean" }, specificity: { type: "string" } }),
            observationTargets: { type: "array", items: { type: "string" } },
            rationale: objectSchema({ stated: { type: "boolean" } }),
            stuck: { type: "boolean" },
          },
        },
        patientQuestions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["topic", "evidenceSpans"],
            properties: {
              topic: { type: "string" },
              evidenceSpans: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
            },
          },
        },
        ambiguities: { type: "array", items: issueSchema },
        unresolvedFragments: { type: "array", items: issueSchema },
        meta: {
          type: "object",
          additionalProperties: false,
          required: ["schemaVersion", "confidence"],
          properties: {
            schemaVersion: { const: MODEL_INTERPRETATION_SCHEMA_VERSION },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            debugExplanation: { type: "string" },
          },
        },
      },
    },
  },
});

function validateIssueArray(value, path, errors) {
  validateArray(value, path, errors);
  for (const [index, issue] of (value ?? []).entries()) {
    const itemPath = `${path}[${index}]`;
    if (!plainObject(issue)) {
      errors.push(`${itemPath}_must_be_object`);
      continue;
    }
    rejectUnknownKeys(issue, new Set(["evidenceSpan", "reason", "explanation"]), itemPath, errors);
    if (typeof issue.evidenceSpan !== "string" || !issue.evidenceSpan.trim()) errors.push(`${itemPath}.evidenceSpan_required`);
    if (!REASON_CODES.has(issue.reason)) errors.push(`${itemPath}.reason_invalid`);
    if (issue.explanation !== undefined && typeof issue.explanation !== "string") errors.push(`${itemPath}.explanation_must_be_string`);
  }
}

function rejectUnknownKeys(object, allowed, path, errors) {
  for (const key of Object.keys(object)) if (!allowed.has(key)) errors.push(`${path}.${key}_not_allowed`);
}
function validateArray(value, path, errors) { if (!Array.isArray(value)) errors.push(`${path}_must_be_array`); }
function validateStringArray(value, path, errors) {
  validateArray(value, path, errors);
  if (Array.isArray(value) && value.some((item) => typeof item !== "string")) errors.push(`${path}_must_contain_strings`);
}
function validateNonEmptyStringArray(value, path, errors, { allowEmpty = false } = {}) {
  validateStringArray(value, path, errors);
  if (Array.isArray(value) && !allowEmpty && value.length === 0) errors.push(`${path}_must_not_be_empty`);
  if (Array.isArray(value) && value.some((item) => !item.trim())) errors.push(`${path}_must_not_contain_empty_strings`);
}
function plainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function failure(errors) { return { ok: false, value: null, errors }; }
function objectSchema(properties) { return { type: "object", additionalProperties: false, properties }; }
