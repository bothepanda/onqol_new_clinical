import { createCommand, validateCommand } from "../../core/commands/commandTypes.js";
import { normalizeReasoningDelta } from "../../core/reasoning/reasoningState.js";
import { bindModelCommands, HIGH_RISK_PARAMETER_KEYS } from "./deterministicParameterBinder.js";
import { MODEL_RESPONSE_FORMAT, parseModelOutput, validateModelOutput } from "./modelOutputSchema.js";
import { buildModelAllowlist, detectParameterInventions, validateModelConcepts, validateNormalizedReasoning } from "./modelConceptValidation.js";

export const SAFE_INTERACTION_CONTEXT_KEYS = Object.freeze([
  "location",
  "observations",
  "revealedResults",
  "currentManagementIntent",
  "openMentorQuestion",
  "openStaffClarification",
  "pendingDecision",
  "interactionContracts",
]);

export function buildModelInterpreterRequest({ text, locale, learnerVisible, turnContext, allowlist }) {
  const safeContext = buildSafeInteractionContext({ learnerVisible, turnContext });
  return {
    messages: [
      {
        role: "system",
        content: [
          "Interpret only the learner's current text; never create clinical truth, advice, prerequisites, or missing commitment.",
          "Keep channels independent: clinicalActions are executable-world proposals only; learner claims go only to reasoningDelta; replies to an open mentor question go only to mentorAnswerDelta; patient questions also go to patientQuestions.",
          "Leave a channel as {} or [] when the learner supplied nothing for it. Never paraphrase an ordinary action into reasoningDelta or mentorAnswerDelta. When there is no openMentorQuestion, mentorAnswerDelta must be {}. Do not give feedback, advice, follow-up questions, or clinical explanations in mentorAnswerDelta.",
          "An explicit question addressed to the simulated patient must use the corresponding ASK_PATIENT or ASK_FASTING_HISTORY clinical action and mirror its topic/evidence in patientQuestions.",
          "Never emit STATE_REASONING or ANSWER_MENTOR as clinicalActions.",
          "When openMentorQuestion exists, interpret the reply against that question before generic action routing; do not turn answer nouns such as pain, pressure, temperature, or heart rate into measurement orders without explicit ordering language.",
          "Every clinical action requires one or more evidenceSpans copied verbatim from rawLearnerText. Each span must contain the lexical anchor for every proposed concept and explicit parameter.",
          "Use only allowlisted action types and concept IDs. If a concept is unsupported, emit no nearby generic action; preserve its exact span in unresolvedFragments with reason unsupported_concept.",
          "Use only parameter names listed for that action. The analytes parameter is valid only for testId chemistry and may contain only allowlisted canonical analyte IDs explicitly named in the same evidence span.",
          "Use only canonical ambiguity/unresolved reason codes. Do not add renal function, consent, fasting, allergies, tests, or other clinical prerequisites unless the learner literally mentioned them and they are required to interpret the stated command.",
          "Tentative phrases such as возможно, можно, вероятно, потенциально, если потребуется, рассмотреть, думаю о, and equivalents are reasoning or tentative_not_committed, never committed operation, procedure, transfer, disposition, or management actions unless the learner also states explicit commitment.",
          "A diagnosis claim is reasoning only. Planning reassessment in one hour is not WAIT and does not advance time; emit a reassessment action only when the learner explicitly performs/orders it.",
          "Reasoning examples: 'думаю, это [названный диагноз]' means workingDiagnosis with the matching allowlisted reasoning conceptId only; '[диагноз] пока в дифференциале' means differential active; '[диагноз] считаю менее вероятным' means differential deprioritized; 'я исключил [диагноз]' means differential ruled_out; 'пациент стабилен' means stability stable; 'начинаю наблюдение, повторный осмотр через час' means observation active plus reassessmentIntervalStated and zero clinicalActions; 'от наблюдения отказываюсь' means observation active false; diagnostic uncertainty belongs in workingDiagnosis uncertaintyExpressed.",
          "Mentor examples when the matching open question exists: 'резкое ухудшение' is mentorAnswerDelta contingency and zero actions; 'боль, давление, температуру и ЧСС' is mentorAnswerDelta observation_targets and zero measurement actions.",
          "For parameterized actions, return allowlisted concept IDs. statedParameters is optional and, if used, only names categories explicitly present. Do not place dose, doseMg, route, volumeMl, durationMinutes, intervalMinutes, afterMinutes, conversions, or calculated totals in params; deterministic code rebuilds them from evidence spans.",
          "Return only the required JSON schema.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          rawLearnerText: text,
          locale,
          interactionContext: safeContext,
          allowlist: serializableAllowlist(allowlist),
        }),
      },
    ],
    responseFormat: MODEL_RESPONSE_FORMAT,
    safeContext,
  };
}

export async function interpretWithModel({ provider, text, locale, learnerVisible, turnContext, bundle }) {
  const allowlist = buildModelAllowlist({ bundle, turnContext });
  const request = buildModelInterpreterRequest({ text, locale, learnerVisible, turnContext, allowlist });
  let completion;
  try {
    completion = await provider.complete({ task: "interaction_shadow", messages: request.messages, responseFormat: request.responseFormat });
  } catch (error) {
    return baseFailure({ status: providerFailureStatus(error), error, request, allowlist });
  }

  // Evidence is captured before parsing, schema checks, concept checks,
  // normalization, binding, or comparison. Nothing below mutates this record.
  const raw = completion?.output ?? completion?.text ?? null;
  const providerMeta = completion?.meta ?? null;
  const providerEvidence = Object.freeze({
    captured: true,
    rawProviderPayload: completion,
    rawProviderOutput: raw,
    returnedModelMetadata: providerMeta,
  });

  if (raw == null || (typeof raw !== "string" && !plainObject(raw))) {
    return baseFailure({ status: "provider_invalid_response", request, allowlist, providerEvidence, providerMeta, rawOutput: raw });
  }

  let parsed;
  try {
    parsed = parseModelOutput(raw);
  } catch (error) {
    return baseFailure({ status: "provider_invalid_response", error, request, allowlist, providerEvidence, providerMeta, rawOutput: raw });
  }

  const schema = validateModelOutput(parsed);
  if (!schema.ok) {
    return baseFailure({
      status: "schema_validation_failure", request, allowlist, providerEvidence, providerMeta, rawOutput: raw,
      schemaErrors: schema.errors, parsedOutput: parsed,
    });
  }

  let concepts;
  try {
    concepts = validateModelConcepts({ output: schema.value, allowlist, rawText: text, openClarification: turnContext.openClarification });
  } catch (error) {
    return baseFailure({
      status: "concept_validation_failure", error, request, allowlist, providerEvidence, providerMeta, rawOutput: raw,
      output: schema.value,
    });
  }

  let normalizedReasoning;
  try {
    normalizedReasoning = normalizeReasoningDelta(schema.value.reasoningDelta);
  } catch (error) {
    return baseFailure({
      status: "normalization_failure", error, request, allowlist, providerEvidence, providerMeta, rawOutput: raw,
      output: schema.value, conceptErrors: concepts.errors, actionValidation: concepts.actionValidation,
    });
  }

  const reasoningValidation = validateNormalizedReasoning({ normalizedReasoning, allowlist });
  const conceptErrors = [...concepts.errors, ...reasoningValidation.errors];
  let bindingDiagnostics;
  try {
    bindingDiagnostics = bindModelCommands({
      actions: schema.value.clinicalActions,
      rawText: text,
      openClarification: turnContext.openClarification,
    });
  } catch (error) {
    return baseFailure({
      status: "binder_failure", error, request, allowlist, providerEvidence, providerMeta, rawOutput: raw,
      output: schema.value, conceptErrors, actionValidation: concepts.actionValidation, normalizedReasoning,
    });
  }

  const commandValidation = bindingDiagnostics.map((item) => {
    if (!allowlist.commandTypes.includes(item.command.type)) return { index: item.index, outcome: "REJECT", missing: [] };
    const command = createCommand({ id: `shadow-${item.index}`, type: item.command.type, params: item.command.params, sourceText: item.command.evidence });
    return { index: item.index, ...validateCommand(command) };
  });
  for (const validation of commandValidation) {
    if (validation.outcome !== "CLARIFY") continue;
    const detail = concepts.actionValidation[validation.index];
    detail.eligibleForBinding = false;
    if (!detail.errors.includes("missing_required_parameter")) detail.errors.push("missing_required_parameter");
    conceptErrors.push(`clinicalActions[${validation.index}].missing_required_parameter`);
  }

  const boundCommands = bindingDiagnostics.map((item) => item.command);
  const acceptedCommands = boundCommands.filter((_, index) => concepts.actionValidation[index]?.eligibleForBinding && commandValidation[index]?.outcome === "SUFFICIENT");
  const inventionsAfterBinder = detectParameterInventions({
    output: {
      ...schema.value,
      clinicalActions: boundCommands.map((command) => ({
        type: command.type,
        params: command.params,
        evidenceSpans: command.evidenceSpans,
        statedParameters: [],
      })),
    },
    rawText: text,
    openClarification: turnContext.openClarification,
  });
  const inventions = { ...concepts.inventions, beforeBinder: concepts.inventions, afterBinder: inventionsAfterBinder };
  const status = conceptErrors.length ? "concept_validation_failure" : "valid";
  return {
    status,
    output: schema.value,
    parsedOutput: parsed,
    schemaErrors: [],
    conceptErrors,
    actionValidation: concepts.actionValidation,
    commandValidation,
    normalizedReasoning,
    inventions,
    proposedCommands: boundCommands,
    boundCommands,
    acceptedCommands,
    bindingDiagnostics,
    request,
    allowlist,
    providerMeta,
    rawOutput: raw,
    providerEvidence,
    errorCode: null,
  };
}

export function buildSafeInteractionContext({ learnerVisible, turnContext }) {
  return {
    location: learnerVisible.location,
    observations: learnerVisible.observations,
    revealedResults: (learnerVisible.revealedResults ?? []).map((item) => ({ id: item.id, status: item.status })),
    currentManagementIntent: turnContext.managementIntent ?? null,
    openMentorQuestion: turnContext.openMentorQuestion ?? null,
    openStaffClarification: turnContext.openClarification ?? null,
    pendingDecision: turnContext.pendingDecisionId
      ? { id: turnContext.pendingDecisionId, optionIds: (turnContext.pendingDecisionOptions ?? []).map((option) => option.id) }
      : null,
    interactionContracts: {
      clinicalAuthority: "none",
      highRiskParameterSource: "deterministic_verbatim_binder",
      incompleteOrders: "reject_or_clarify_semantically",
      reasoningChannel: "reasoningDelta_only",
      mentorAnswerChannel: "mentorAnswerDelta_only",
    },
  };
}

function serializableAllowlist(allowlist) {
  const highRisk = new Set(HIGH_RISK_PARAMETER_KEYS);
  return {
    clinicalActionTypes: allowlist.commandTypes,
    forbiddenInternalCommandTypes: ["STATE_REASONING", "ANSWER_MENTOR"],
    parameterSchemas: Object.fromEntries(Object.entries(allowlist.parameterSchemas).map(([type, keys]) => [type, keys.filter((key) => !highRisk.has(key))])),
    statedParameterCategories: ["dose", "dose_unit", "route", "volume", "duration", "interval", "bolus"],
    conceptIds: {
      tests: allowlist.tests, chemistryAnalytes: allowlist.chemistryAnalytes,
      drugs: allowlist.drugs, fluids: allowlist.fluids, procedures: allowlist.procedures,
      reasoning: allowlist.reasoningConceptIds, regions: allowlist.regions,
      patientQuestionTopics: allowlist.patientQuestionTopics, staffRoles: allowlist.staffRoles,
      destinations: allowlist.destinations, managementIntents: allowlist.managementIntents,
      routes: allowlist.routes, operativeChoices: allowlist.operativeChoices,
    },
    canonicalInterpretationReasons: [
      "unsupported_concept", "missing_required_parameter", "missing_unit", "missing_route",
      "ambiguous_target", "ambiguous_action", "tentative_not_committed", "unrecognized_fragment",
    ],
  };
}

function baseFailure({
  status, error = null, request, allowlist, providerEvidence = null, providerMeta = null, rawOutput = null,
  parsedOutput = null, output = null, schemaErrors = [], conceptErrors = [], actionValidation = [], normalizedReasoning = null,
}) {
  return {
    status, errorCode: localErrorCode(error), request, allowlist, providerEvidence, providerMeta, rawOutput,
    parsedOutput, output, schemaErrors, conceptErrors, actionValidation, normalizedReasoning,
    commandValidation: [], bindingDiagnostics: [], proposedCommands: [], boundCommands: [], acceptedCommands: [],
    inventions: { highRisk: [], inventedNumericParameterCount: 0, beforeBinder: { highRisk: [], inventedNumericParameterCount: 0 }, afterBinder: { highRisk: [], inventedNumericParameterCount: 0 } },
  };
}

function providerFailureStatus(error) { return error?.name === "AbortError" ? "provider_timeout" : "provider_transport_error"; }
function localErrorCode(error) { return error ? String(error?.code ?? error?.message ?? error?.name ?? "processing_error").slice(0, 160) : null; }
function plainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
