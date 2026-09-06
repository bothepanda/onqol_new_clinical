export const WAVE23_SCHEMA_VERSION = "wave23-split-semantic-v1";

export const SEMANTIC_TASK = Object.freeze({
  ACTION: "action_interpreter",
  REASONING: "reasoning_interpreter",
  MENTOR_ANSWER: "contextual_mentor_answer_interpreter",
});

export const REASONING_DOMAINS = Object.freeze([
  "stabilityAssessment",
  "workingDiagnosis",
  "differential",
  "managementIntent",
  "rationale",
  "reassessmentPlan",
  "contingencyPlan",
  "dispositionIntent",
  "consultationIntent",
]);

const ISSUE_REASONS = Object.freeze([
  "unsupported_concept",
  "missing_required_parameter",
  "missing_unit",
  "missing_route",
  "ambiguous_target",
  "ambiguous_action",
  "tentative_not_committed",
  "unrecognized_fragment",
]);

const issueSchema = {
  type: "object",
  additionalProperties: false,
  required: ["evidenceSpan", "reason"],
  properties: {
    evidenceSpan: { type: "string", minLength: 1 },
    reason: { enum: ISSUE_REASONS },
    explanation: { type: "string" },
  },
};

const metaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "confidence"],
  properties: {
    schemaVersion: { const: WAVE23_SCHEMA_VERSION },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

export const ACTION_RESPONSE_FORMAT = responseFormat("onqol_wave23_action", {
  type: "object",
  additionalProperties: false,
  required: ["clinicalActions", "patientQuestions", "ambiguities", "unresolvedFragments", "meta"],
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
    meta: metaSchema,
  },
});

const groundedConcept = {
  type: "object",
  additionalProperties: false,
  required: ["conceptId", "evidenceSpan"],
  properties: {
    conceptId: { type: "string", minLength: 1 },
    evidenceSpan: { type: "string", minLength: 1 },
    uncertaintyExpressed: { type: "boolean" },
  },
};

const groundedIntent = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "evidenceSpan"],
  properties: {
    intent: { type: "string", minLength: 1 },
    evidenceSpan: { type: "string", minLength: 1 },
    tentative: { type: "boolean" },
  },
};

export const REASONING_DELTA_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    stabilityAssessment: {
      type: "object", additionalProperties: false, required: ["assessment", "evidenceSpan"],
      properties: { assessment: { enum: ["stable", "unstable", "uncertain"] }, evidenceSpan: { type: "string", minLength: 1 } },
    },
    workingDiagnosis: groundedConcept,
    differential: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["conceptId", "status", "evidenceSpan"],
        properties: {
          conceptId: { type: "string", minLength: 1 },
          status: { enum: ["active", "deprioritized", "ruled_out"] },
          evidenceSpan: { type: "string", minLength: 1 },
        },
      },
    },
    managementIntent: groundedIntent,
    rationale: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["text", "evidenceSpan"],
        properties: { text: { type: "string", minLength: 1 }, evidenceSpan: { type: "string", minLength: 1 } },
      },
    },
    reassessmentPlan: {
      type: "object", additionalProperties: false, required: ["targets", "evidenceSpan"],
      properties: {
        targets: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
        timingText: { type: "string" },
        evidenceSpan: { type: "string", minLength: 1 },
      },
    },
    contingencyPlan: {
      type: "object", additionalProperties: false, required: ["triggerText", "evidenceSpan"],
      properties: {
        triggerText: { type: "string", minLength: 1 },
        responseText: { type: "string" },
        evidenceSpan: { type: "string", minLength: 1 },
      },
    },
    dispositionIntent: groundedIntent,
    consultationIntent: groundedIntent,
  },
});

export const REASONING_RESPONSE_FORMAT = responseFormat("onqol_wave23_reasoning", {
  type: "object",
  additionalProperties: false,
  required: ["reasoningDelta", "ambiguities", "meta"],
  properties: {
    reasoningDelta: REASONING_DELTA_SCHEMA,
    ambiguities: { type: "array", items: issueSchema },
    meta: metaSchema,
  },
});

export const MENTOR_RESPONSE_FORMAT = responseFormat("onqol_wave23_mentor_answer", {
  type: "object",
  additionalProperties: false,
  required: ["answered", "mentorAnswerDelta", "reasoningDelta", "ambiguities", "meta"],
  properties: {
    answered: { type: "boolean" },
    mentorAnswerDelta: {
      type: "object",
      additionalProperties: false,
      required: ["domains", "evidenceSpans", "completeness", "stuck"],
      properties: {
        domains: { type: "array", items: { type: "string", minLength: 1 } },
        evidenceSpans: { type: "array", items: { type: "string", minLength: 1 } },
        completeness: { enum: ["sufficient", "partial", "vague", "none"] },
        stuck: { type: "boolean" },
      },
    },
    reasoningDelta: REASONING_DELTA_SCHEMA,
    ambiguities: { type: "array", items: issueSchema },
    meta: metaSchema,
  },
});

export function validateTaskOutput(task, candidate) {
  const errors = [];
  if (!plainObject(candidate)) return invalid(["output_must_be_object"]);
  if (task === SEMANTIC_TASK.ACTION) validateAction(candidate, errors);
  else if (task === SEMANTIC_TASK.REASONING) validateReasoning(candidate, errors);
  else if (task === SEMANTIC_TASK.MENTOR_ANSWER) validateMentor(candidate, errors);
  else return invalid(["unknown_semantic_task"]);
  return errors.length ? invalid(errors) : { ok: true, value: structuredClone(candidate), errors: [] };
}

export function parseTaskOutput(raw) {
  if (plainObject(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("provider_output_not_json");
  return JSON.parse(raw);
}

function validateAction(candidate, errors) {
  exactKeys(candidate, ["clinicalActions", "patientQuestions", "ambiguities", "unresolvedFragments", "meta"], "output", errors);
  array(candidate.clinicalActions, "clinicalActions", errors);
  array(candidate.patientQuestions, "patientQuestions", errors);
  issues(candidate.ambiguities, "ambiguities", errors);
  issues(candidate.unresolvedFragments, "unresolvedFragments", errors);
  for (const [index, action] of (candidate.clinicalActions ?? []).entries()) {
    const path = `clinicalActions[${index}]`;
    if (!plainObject(action)) { errors.push(`${path}_must_be_object`); continue; }
    allowedKeys(action, ["type", "params", "evidenceSpans", "statedParameters"], path, errors);
    if (typeof action.type !== "string" || !action.type.trim()) errors.push(`${path}.type_required`);
    if (!plainObject(action.params)) errors.push(`${path}.params_must_be_object`);
    nonEmptyStrings(action.evidenceSpans, `${path}.evidenceSpans`, errors);
    if (action.statedParameters !== undefined) strings(action.statedParameters, `${path}.statedParameters`, errors);
  }
  for (const [index, question] of (candidate.patientQuestions ?? []).entries()) {
    const path = `patientQuestions[${index}]`;
    if (!plainObject(question)) { errors.push(`${path}_must_be_object`); continue; }
    exactKeys(question, ["topic", "evidenceSpans"], path, errors);
    if (typeof question.topic !== "string" || !question.topic.trim()) errors.push(`${path}.topic_required`);
    nonEmptyStrings(question.evidenceSpans, `${path}.evidenceSpans`, errors);
  }
  meta(candidate.meta, errors);
}

function validateReasoning(candidate, errors) {
  exactKeys(candidate, ["reasoningDelta", "ambiguities", "meta"], "output", errors);
  reasoningDelta(candidate.reasoningDelta, "reasoningDelta", errors);
  issues(candidate.ambiguities, "ambiguities", errors);
  meta(candidate.meta, errors);
}

function validateMentor(candidate, errors) {
  exactKeys(candidate, ["answered", "mentorAnswerDelta", "reasoningDelta", "ambiguities", "meta"], "output", errors);
  if (typeof candidate.answered !== "boolean") errors.push("answered_must_be_boolean");
  if (!plainObject(candidate.mentorAnswerDelta)) errors.push("mentorAnswerDelta_must_be_object");
  else {
    exactKeys(candidate.mentorAnswerDelta, ["domains", "evidenceSpans", "completeness", "stuck"], "mentorAnswerDelta", errors);
    strings(candidate.mentorAnswerDelta.domains, "mentorAnswerDelta.domains", errors);
    strings(candidate.mentorAnswerDelta.evidenceSpans, "mentorAnswerDelta.evidenceSpans", errors);
    if (!["sufficient", "partial", "vague", "none"].includes(candidate.mentorAnswerDelta.completeness)) errors.push("mentorAnswerDelta.completeness_invalid");
    if (typeof candidate.mentorAnswerDelta.stuck !== "boolean") errors.push("mentorAnswerDelta.stuck_must_be_boolean");
  }
  reasoningDelta(candidate.reasoningDelta, "reasoningDelta", errors);
  issues(candidate.ambiguities, "ambiguities", errors);
  meta(candidate.meta, errors);
}

function reasoningDelta(value, path, errors) {
  if (!plainObject(value)) { errors.push(`${path}_must_be_object`); return; }
  allowedKeys(value, REASONING_DOMAINS, path, errors);
  for (const domain of Object.keys(value)) {
    const item = value[domain];
    if (!meaningful(item)) continue;
    if (domain === "differential" || domain === "rationale") {
      array(item, `${path}.${domain}`, errors);
      for (const [index, entry] of (item ?? []).entries()) grounded(entry, `${path}.${domain}[${index}]`, errors);
    } else grounded(item, `${path}.${domain}`, errors);
  }
}

function grounded(value, path, errors) {
  if (!plainObject(value)) { errors.push(`${path}_must_be_object`); return; }
  if (typeof value.evidenceSpan !== "string" || !value.evidenceSpan.trim()) errors.push(`${path}.evidenceSpan_required`);
}

function issues(value, path, errors) {
  array(value, path, errors);
  for (const [index, issue] of (value ?? []).entries()) {
    const itemPath = `${path}[${index}]`;
    if (!plainObject(issue)) { errors.push(`${itemPath}_must_be_object`); continue; }
    allowedKeys(issue, ["evidenceSpan", "reason", "explanation"], itemPath, errors);
    if (typeof issue.evidenceSpan !== "string" || !issue.evidenceSpan.trim()) errors.push(`${itemPath}.evidenceSpan_required`);
    if (!ISSUE_REASONS.includes(issue.reason)) errors.push(`${itemPath}.reason_invalid`);
  }
}

function meta(value, errors) {
  if (!plainObject(value)) { errors.push("meta_must_be_object"); return; }
  exactKeys(value, ["schemaVersion", "confidence"], "meta", errors);
  if (value.schemaVersion !== WAVE23_SCHEMA_VERSION) errors.push("schema_version_invalid");
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) errors.push("confidence_out_of_range");
}

function responseFormat(name, schema) { return Object.freeze({ type: "json_schema", json_schema: { name, strict: false, schema } }); }
function exactKeys(value, keys, path, errors) { allowedKeys(value, keys, path, errors); for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}_required`); }
function allowedKeys(value, keys, path, errors) { const allowed = new Set(keys); for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}_not_allowed`); }
function array(value, path, errors) { if (!Array.isArray(value)) errors.push(`${path}_must_be_array`); }
function strings(value, path, errors) { array(value, path, errors); if (Array.isArray(value) && value.some((item) => typeof item !== "string")) errors.push(`${path}_must_contain_strings`); }
function nonEmptyStrings(value, path, errors) { strings(value, path, errors); if (Array.isArray(value) && (!value.length || value.some((item) => !item.trim()))) errors.push(`${path}_must_contain_non_empty_strings`); }
function plainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function meaningful(value) {
  if (Array.isArray(value)) return value.some(meaningful);
  if (!plainObject(value)) return value !== null && value !== undefined && value !== "" && value !== false;
  return Object.values(value).some(meaningful);
}
function invalid(errors) { return { ok: false, value: null, errors }; }
