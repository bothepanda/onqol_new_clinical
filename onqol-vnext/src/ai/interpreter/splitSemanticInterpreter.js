import { createCommand, validateCommand } from "../../core/commands/commandTypes.js";
import { stage2ActionFormat, normalizeStage2Output, stage2SafeContext } from "./stage2ActionSchema.js";
import { bindModelCommands } from "./deterministicParameterBinder.js";
import { validateActionCandidates } from "./actionCandidateValidation.js";
import { DEFAULT_PROMOTION_POLICY } from "./promotionPolicy.js";
import { buildConversationFrame, frameForModel } from "./conversationContext.js";
import { actionTypeGrounded, buildModelAllowlist, detectParameterInventions, identifyingParamKey, validateModelConcepts } from "./modelConceptValidation.js";
import {
  ACTION_RESPONSE_FORMAT,
  MENTOR_RESPONSE_FORMAT,
  REASONING_DOMAINS,
  REASONING_RESPONSE_FORMAT,
  SEMANTIC_TASK,
  parseTaskOutput,
  validateTaskOutput,
} from "./semanticTaskSchemas.js";

export function routeSemanticTasks({ turnContext = {} }) {
  return turnContext.openMentorQuestion
    ? [SEMANTIC_TASK.ACTION, SEMANTIC_TASK.MENTOR_ANSWER]
    : [SEMANTIC_TASK.ACTION, SEMANTIC_TASK.REASONING];
}

export function buildSemanticTaskRequest({ task, text, locale, turnContext = {}, bundle }) {
  const allowlist = buildModelAllowlist({ bundle, turnContext });
  if (task === SEMANTIC_TASK.ACTION) return buildActionRequest({ text, locale, turnContext, allowlist });
  if (task === SEMANTIC_TASK.REASONING) return buildReasoningRequest({ text, locale, allowlist });
  if (task === SEMANTIC_TASK.MENTOR_ANSWER) return buildMentorRequest({ text, locale, turnContext, allowlist });
  throw new Error(`unknown_semantic_task:${task}`);
}

/**
 * `validationMode`:
 *   "legacy_strict"        the frozen Wave 2.3 shadow contract - any candidate error
 *                          makes the task `concept_validation_failure`.
 *   "candidate_arbitrated" interpreter v3 - each candidate gets its own
 *                          ACCEPT / CLARIFY / REJECT result and the task stays
 *                          `valid`. Only provider / transport / schema failure
 *                          is task-level.
 */
export const VALIDATION_MODE = Object.freeze({ LEGACY_STRICT: "legacy_strict", CANDIDATE_ARBITRATED: "candidate_arbitrated" });

export async function interpretSemanticTask({
  task, provider, text, locale, turnContext = {}, bundle, strictAction = false,
  validationMode = VALIDATION_MODE.LEGACY_STRICT, policy = DEFAULT_PROMOTION_POLICY,
}) {
  const request = buildSemanticTaskRequest({ task, text, locale, turnContext, bundle });
  if (strictAction && task === SEMANTIC_TASK.ACTION) {
    request.responseFormat = stage2ActionFormat(request.allowlist);
    stage2SafeContext(request);
  }
  const startedAt = Date.now();
  let completion;
  try {
    completion = await provider.complete({
      task,
      messages: request.messages,
      responseFormat: request.responseFormat,
    });
  } catch (error) {
    return failure(task, providerFailureStatus(error), {
      elapsedMs: Date.now() - startedAt,
      errorCode: errorCode(error),
      request,
      providerEvidence: error?.providerEvidence ?? null,
    });
  }

  const raw = completion?.output ?? completion?.text ?? null;
  const providerEvidence = Object.freeze({
    captured: true,
    rawProviderPayload: completion,
    rawProviderOutput: raw,
    returnedModelMetadata: completion?.meta ?? null,
  });
  if (raw == null || (typeof raw !== "string" && !plainObject(raw))) {
    return failure(task, "provider_invalid_response", {
      elapsedMs: Date.now() - startedAt, request, providerEvidence, rawOutput: raw,
    });
  }

  let parsed;
  try {
    parsed = parseTaskOutput(raw);
  } catch (error) {
    return failure(task, "provider_invalid_response", {
      elapsedMs: Date.now() - startedAt, errorCode: errorCode(error), request, providerEvidence, rawOutput: raw,
    });
  }
  let schema;
  try {
    schema = validateTaskOutput(task, strictAction ? normalizeStage2Output(parsed) : parsed);
  } catch {
    return failure(task, "schema_validation_failure", {
      elapsedMs: Date.now() - startedAt, request, providerEvidence, rawOutput: raw, parsedOutput: parsed,
      schemaErrors: ["malformed_structure"],
    });
  }
  if (!schema.ok) {
    return failure(task, "schema_validation_failure", {
      elapsedMs: Date.now() - startedAt, request, providerEvidence, rawOutput: raw, parsedOutput: parsed, schemaErrors: schema.errors,
    });
  }

  try {
    const validated = task === SEMANTIC_TASK.ACTION
      ? (validationMode === VALIDATION_MODE.CANDIDATE_ARBITRATED
        ? validateActionCandidates({ output: schema.value, text, turnContext, allowlist: request.allowlist, policy })
        : validateActionTask({ output: schema.value, text, turnContext, allowlist: request.allowlist }))
      : task === SEMANTIC_TASK.REASONING
        ? validateReasoningTask({ output: schema.value, text, allowlist: request.allowlist })
        : validateMentorTask({ output: schema.value, text, turnContext, allowlist: request.allowlist });
    return {
      task,
      status: validated.errors.length && validationMode !== VALIDATION_MODE.CANDIDATE_ARBITRATED ? "concept_validation_failure" : "valid",
      clinicalAuthority: "none",
      elapsedMs: Date.now() - startedAt,
      errorCode: null,
      request,
      output: schema.value,
      parsedOutput: parsed,
      rawOutput: raw,
      providerEvidence,
      providerMeta: completion?.meta ?? null,
      schemaErrors: [],
      conceptErrors: validated.errors,
      ...validated,
    };
  } catch (error) {
    return failure(task, "local_processing_failure", {
      elapsedMs: Date.now() - startedAt, errorCode: errorCode(error), request, providerEvidence,
      rawOutput: raw, parsedOutput: parsed, output: schema.value,
    });
  }
}

export async function runSplitSemanticShadow({ provider, text, locale, turnContext = {}, bundle }) {
  const tasks = routeSemanticTasks({ turnContext });
  const settled = await Promise.allSettled(tasks.map((task) => interpretSemanticTask({
    task, provider, text, locale, turnContext, bundle,
  })));
  const taskResults = Object.fromEntries(tasks.map((task, index) => [
    task,
    settled[index].status === "fulfilled"
      ? settled[index].value
      : failure(task, "local_processing_failure", { errorCode: errorCode(settled[index].reason) }),
  ]));
  const action = taskResults[SEMANTIC_TASK.ACTION];
  const reasoning = taskResults[SEMANTIC_TASK.REASONING];
  const mentor = taskResults[SEMANTIC_TASK.MENTOR_ANSWER];
  return {
    kind: "split_semantic_shadow",
    status: Object.values(taskResults).every((result) => result.status === "valid") ? "valid" : "partial_or_failed",
    clinicalAuthority: "none",
    executedSource: "deterministic",
    routedTasks: tasks,
    taskResults,
    acceptedCommands: action?.acceptedCommands ?? [],
    proposedCommands: action?.proposedCommands ?? [],
    actionValidation: action?.actionValidation ?? [],
    commandValidation: action?.commandValidation ?? [],
    bindingDiagnostics: action?.bindingDiagnostics ?? [],
    modelOutput: {
      clinicalActions: action?.output?.clinicalActions ?? [],
      patientQuestions: action?.output?.patientQuestions ?? [],
      ambiguities: action?.output?.ambiguities ?? [],
      unresolvedFragments: action?.output?.unresolvedFragments ?? [],
      reasoningDelta: reasoning?.acceptedReasoningDelta ?? mentor?.acceptedReasoningDelta ?? {},
      mentorAnswerDelta: mentor?.acceptedMentorAnswerDelta ?? {},
    },
    normalizedReasoning: reasoning?.acceptedReasoningDelta ?? mentor?.acceptedReasoningDelta ?? {},
    providerEvidenceCaptured: Object.values(taskResults).every((result) => result.providerEvidence?.captured === true),
  };
}

function buildActionRequest({ text, locale, turnContext, allowlist }) {
  const actionAllowlist = serializableActionAllowlist(allowlist);
  return {
    messages: [
      {
        role: "system",
        content: [
          "Extract only explicit learner clinical actions and explicit questions addressed to the simulated patient.",
          "Do not interpret diagnoses, differential, rationale, monitoring intent, educational meaning, or answers to a mentor question.",
          "A diagnosis or short clinical observation alone is not an action. Tentative or conditional operation, procedure, transfer, disposition, or discharge wording is not a committed action.",
          "Every action and patient question needs verbatim evidenceSpans copied from rawLearnerText and an allowlisted canonical concept ID.",
          "Unsupported concepts stay unresolved; never substitute the nearest generic action. Incomplete high-risk orders stay incomplete.",
          "When the learner names only a category of investigations (for example a class of markers or a modality without a region) and not one specific allowlisted concept, report an ambiguity with reason ambiguous_target instead of choosing one member of the category.",
          "allowlist.tests are modeled investigations. allowlist.recognizedUnmodeledTests are investigations the platform recognises but cannot simulate: when the learner names one, propose ORDER_TEST with that testId (the platform reports it as a simulator limitation) and never substitute a modeled study for it. Imaging language (ultrasound, CT, visualization, a picture of the abdomen) is a request for a study, never a physical examination.",
          "Return one action per distinct learner action. A question addressed to the patient is a patientQuestion, not a clinicalAction.",
          "Do not supply dose, unit, route, volume, duration, interval, or timing values in params; deterministic code binds only values literally present in evidence.",
          "When an open mentor question exists, answer nouns are not measurement orders without explicit ordering language.",
          "When precedingSystemQuestion is present, read a short or elliptical learner reply against it before any generic reading: a noun that fills the slot the question asked about names its answer; a yes/no reply is not itself an action. The identity of an act must come from the learner's own words, never from the question, and no dose, route, volume or duration may be taken from the question.",
          "Return only the task JSON schema.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          rawLearnerText: text,
          locale,
          openStaffClarification: turnContext.openClarification ?? null,
          ...(frameForModel(buildConversationFrame(turnContext)) ? { precedingSystemQuestion: frameForModel(buildConversationFrame(turnContext)) } : {}),
          allowlist: actionAllowlist,
        }),
      },
    ],
    responseFormat: ACTION_RESPONSE_FORMAT,
    allowlist,
    exposedContract: actionAllowlist,
  };
}

function buildReasoningRequest({ text, locale, allowlist }) {
  const reasoningAllowlist = {
    conceptIds: allowlist.reasoningConceptIds,
    managementIntents: allowlist.managementIntents,
    destinations: allowlist.destinations,
    consultationRoles: allowlist.staffRoles,
    domains: REASONING_DOMAINS,
  };
  return {
    messages: [
      {
        role: "system",
        content: [
          "Extract only reasoning explicitly stated in the learner's current text.",
          "Abstain by returning an empty reasoningDelta when no reasoning domain is stated. Do not fill a template and do not infer clinically logical severity, confidence, rationale, urgency, contingency, disposition, or consultation.",
          "Every non-empty domain requires one exact evidenceSpan copied verbatim from rawLearnerText. Use only allowlisted canonical concepts.",
          "At the top level always return exactly reasoningDelta, ambiguities, and meta. reasoningDelta must be exactly {} when no reasoning is stated. Omit every unused domain; never emit empty objects, empty strings, placeholder values, or default assessments.",
          "Do not return orders, investigations, medications, procedures, patient questions, waiting, reassessment commands, transfers, or management commitment as executable actions.",
          "Tentative or conditional plans remain reasoning intent; they are never current committed actions.",
          "Return only the task JSON schema.",
        ].join(" "),
      },
      { role: "user", content: JSON.stringify({ rawLearnerText: text, locale, allowlist: reasoningAllowlist }) },
    ],
    responseFormat: REASONING_RESPONSE_FORMAT,
    allowlist,
    exposedContract: reasoningAllowlist,
  };
}

function buildMentorRequest({ text, locale, turnContext, allowlist }) {
  const question = turnContext.openMentorQuestion;
  if (!question) throw new Error("mentor_task_requires_open_question");
  const expectedDomains = question.expectedDomains ?? question.expects ?? [];
  const mentorContract = {
    learnerText: text,
    locale,
    expectedDomains,
    mentorQuestionSemanticType: question.semanticType ?? question.issueId ?? question.id ?? null,
    previousMentorQuestionText: question.text ?? question.textRu ?? null,
    reasoningConceptIds: allowlist.reasoningConceptIds,
    reasoningDomains: REASONING_DOMAINS,
  };
  return {
    messages: [
      {
        role: "system",
        content: [
          "Interpret the learner text only as a contextual answer to the currently open mentor question.",
          "Decide whether the question was answered, which expected semantic domains were actually expressed, and whether the answer is sufficient, partial, vague, or none.",
          "Every claimed domain or reasoning field requires exact verbatim evidence from learnerText. Do not infer a complete answer from clinical plausibility.",
          "A genuine 'не знаю' or evasion is not a substantive answer. Short phrases may be valid answers when the open question supplies their context.",
          "At the top level always return exactly answered, mentorAnswerDelta, reasoningDelta, ambiguities, and meta. Omit unused reasoning domains; never emit empty objects, empty strings, placeholders, or default assessments.",
          "Do not return clinical actions, orders, investigations, medications, procedures, patient questions, waiting, transfer, or operative commitment.",
          "Return only the task JSON schema.",
        ].join(" "),
      },
      { role: "user", content: JSON.stringify(mentorContract) },
    ],
    responseFormat: MENTOR_RESPONSE_FORMAT,
    allowlist,
    exposedContract: mentorContract,
  };
}

function validateActionTask({ output, text, turnContext, allowlist }) {
  const legacyShape = { ...output, reasoningDelta: {}, mentorAnswerDelta: {} };
  const concepts = validateModelConcepts({
    output: legacyShape,
    allowlist,
    rawText: text,
    openClarification: turnContext.openClarification,
  });
  const bindingDiagnostics = bindModelCommands({
    actions: output.clinicalActions,
    rawText: text,
    openClarification: turnContext.openClarification,
  });
  const commandValidation = bindingDiagnostics.map((item) => {
    if (!allowlist.commandTypes.includes(item.command.type)) return { index: item.index, outcome: "REJECT", missing: [] };
    const command = createCommand({ id: `wave23-shadow-${item.index}`, type: item.command.type, params: item.command.params, sourceText: item.command.evidence });
    return { index: item.index, ...validateCommand(command) };
  });
  const rawErrors = [...concepts.errors];
  for (const validation of commandValidation) {
    if (validation.outcome !== "CLARIFY") continue;
    const detail = concepts.actionValidation[validation.index];
    if (detail) {
      detail.eligibleForBinding = false;
      if (!detail.errors.includes("missing_required_parameter")) detail.errors.push("missing_required_parameter");
    }
    rawErrors.push(`clinicalActions[${validation.index}].missing_required_parameter`);
  }
  const proposedCommands = bindingDiagnostics.map((item) => item.command);
  const acceptedCommands = proposedCommands.filter((_, index) => concepts.actionValidation[index]?.eligibleForBinding && commandValidation[index]?.outcome === "SUFFICIENT");

  // A proposal whose only problem is that its identifying concept (which test,
  // which drug, which region...) is not grounded in the learner's own words is
  // not evidence of invention - it is the same "recognised but incomplete
  // order" shape `validateCommand` already turns into a CLARIFY for a missing
  // required parameter (Contract §10). Strip the ungrounded identifier and let
  // the existing structural-completeness path ask for it, instead of silently
  // discarding the whole turn. High-risk action types never qualify (see
  // `identifyingParamKey`), and anything with a *different* kind of error
  // (an invented id, unverifiable evidence, an injection) is still rejected.
  const ambiguousCommands = [];
  proposedCommands.forEach((command, index) => {
    const detail = concepts.actionValidation[index];
    if (!detail || detail.eligibleForBinding) return;
    if (!detail.errors.includes("lexical_anchor_missing")) return;
    if (detail.errors.some((error) => error !== "lexical_anchor_missing" && error !== "missing_required_parameter")) return;
    const key = identifyingParamKey(command);
    if (!key || command.params[key] == null || !actionTypeGrounded(command)) return;
    const params = Object.fromEntries(Object.entries(command.params).filter(([paramKey]) => paramKey !== key));
    ambiguousCommands.push({ index, type: command.type, params, evidence: command.evidence, evidenceSpans: command.evidenceSpans });
  });
  const ambiguousIndexes = new Set(ambiguousCommands.map((item) => item.index));
  const errors = ambiguousIndexes.size
    ? rawErrors.filter((error) => !isAmbiguousResolvedError(error, ambiguousIndexes))
    : rawErrors;
  const afterBinder = detectParameterInventions({
    output: {
      ...legacyShape,
      clinicalActions: proposedCommands.map((command) => ({
        type: command.type, params: command.params, evidenceSpans: command.evidenceSpans, statedParameters: [],
      })),
    },
    rawText: text,
    openClarification: turnContext.openClarification,
  });
  return {
    errors: unique(errors),
    actionValidation: concepts.actionValidation,
    bindingDiagnostics,
    commandValidation,
    proposedCommands,
    acceptedCommands,
    ambiguousCommands,
    inventions: { ...concepts.inventions, beforeBinder: concepts.inventions, afterBinder },
  };
}

function isAmbiguousResolvedError(error, ambiguousIndexes) {
  const match = /^clinicalActions\[(\d+)\]\.(lexical_anchor_missing|missing_required_parameter)$/.exec(error);
  return Boolean(match) && ambiguousIndexes.has(Number(match[1]));
}

function validateReasoningTask({ output, text, allowlist }) {
  const validation = validateGroundedReasoning(output.reasoningDelta, text, allowlist);
  const ambiguityErrors = validateEvidenceItems(output.ambiguities, text, "ambiguities");
  return {
    errors: [...validation.errors, ...ambiguityErrors],
    reasoningValidation: validation.items,
    acceptedReasoningDelta: validation.accepted,
  };
}

function validateMentorTask({ output, text, turnContext, allowlist }) {
  const expected = new Set(turnContext.openMentorQuestion?.expectedDomains ?? turnContext.openMentorQuestion?.expects ?? []);
  const errors = [];
  const delta = output.mentorAnswerDelta;
  for (const [index, span] of delta.evidenceSpans.entries()) if (!containsNormalized(text, span)) errors.push(`mentorAnswerDelta.evidenceSpans[${index}]_not_verbatim`);
  for (const domain of delta.domains) if (expected.size && !expected.has(domain)) errors.push(`mentorAnswerDelta.domain_not_expected:${domain}`);
  if (!output.answered && delta.domains.length) errors.push("mentorAnswerDelta.domains_present_when_unanswered");
  if (output.answered && !delta.domains.length && !delta.stuck) errors.push("mentorAnswerDelta.answered_without_domain");
  if (delta.domains.length && !delta.evidenceSpans.length) errors.push("mentorAnswerDelta.missing_evidence");
  const reasoning = validateGroundedReasoning(output.reasoningDelta, text, allowlist);
  errors.push(...reasoning.errors, ...validateEvidenceItems(output.ambiguities, text, "ambiguities"));
  return {
    errors: unique(errors),
    acceptedMentorAnswerDelta: errors.some((item) => item.startsWith("mentorAnswerDelta"))
      ? { domains: [], evidenceSpans: [], completeness: "none", stuck: delta.stuck }
      : structuredClone(delta),
    acceptedReasoningDelta: reasoning.accepted,
    mentorValidation: { expectedDomains: [...expected], errors: errors.filter((item) => item.startsWith("mentorAnswerDelta")) },
  };
}

function validateGroundedReasoning(delta, text, allowlist) {
  const accepted = {};
  const errors = [];
  const items = [];
  for (const [domain, value] of Object.entries(delta)) {
    if (!meaningful(value)) continue;
    if (Array.isArray(value)) {
      const acceptedItems = [];
      for (const [index, item] of value.entries()) {
        const itemErrors = validateReasoningClaim(domain, item, text, allowlist);
        items.push({ domain, index, accepted: itemErrors.length === 0, errors: itemErrors });
        errors.push(...itemErrors.map((error) => `reasoningDelta.${domain}[${index}].${error}`));
        if (!itemErrors.length) acceptedItems.push(structuredClone(item));
      }
      if (acceptedItems.length) accepted[domain] = acceptedItems;
    } else {
      const itemErrors = validateReasoningClaim(domain, value, text, allowlist);
      items.push({ domain, accepted: itemErrors.length === 0, errors: itemErrors });
      errors.push(...itemErrors.map((error) => `reasoningDelta.${domain}.${error}`));
      if (!itemErrors.length) accepted[domain] = structuredClone(value);
    }
  }
  return { accepted, errors, items };
}

function validateReasoningClaim(domain, item, text, allowlist) {
  const errors = [];
  if (!containsNormalized(text, item?.evidenceSpan)) errors.push("evidence_not_verbatim");
  if (["workingDiagnosis", "differential"].includes(domain) && !allowlist.reasoningConceptIds.includes(item?.conceptId)) errors.push("concept_not_allowlisted");
  if (domain === "managementIntent" && !allowlist.managementIntents.includes(item?.intent)) errors.push("intent_not_allowlisted");
  if (domain === "dispositionIntent" && !allowlist.destinations.includes(item?.intent)) errors.push("destination_not_allowlisted");
  if (domain === "consultationIntent" && !allowlist.staffRoles.includes(item?.intent)) errors.push("role_not_allowlisted");
  const anchors = REASONING_GROUNDING_ANCHORS[domain] ?? [];
  if (anchors.length && !anchors.some((anchor) => normalize(item?.evidenceSpan).includes(anchor))) errors.push("domain_anchor_missing");
  return errors;
}

function validateEvidenceItems(items, text, path) {
  const errors = [];
  for (const [index, item] of items.entries()) if (!containsNormalized(text, item.evidenceSpan)) errors.push(`${path}[${index}].evidence_not_verbatim`);
  return errors;
}

function serializableActionAllowlist(allowlist) {
  const deterministicOnly = new Set(["dose", "doseMg", "route", "volumeMl", "durationMinutes", "intervalMinutes", "afterMinutes"]);
  return {
    clinicalActionTypes: allowlist.commandTypes,
    parameterSchemas: Object.fromEntries(Object.entries(allowlist.parameterSchemas).map(([type, keys]) => [type, keys.filter((key) => !deterministicOnly.has(key))])),
    concepts: {
      tests: allowlist.tests, recognizedUnmodeledTests: allowlist.recognizedUnmodeledTests ?? [], chemistryAnalytes: allowlist.chemistryAnalytes, drugs: allowlist.drugs,
      fluids: allowlist.fluids, procedures: allowlist.procedures, regions: allowlist.regions,
      patientQuestionTopics: allowlist.patientQuestionTopics, staffRoles: allowlist.staffRoles,
      destinations: allowlist.destinations, managementIntents: allowlist.managementIntents,
      operativeChoices: allowlist.operativeChoices,
    },
  };
}

function failure(task, status, details = {}) {
  return {
    task, status, clinicalAuthority: "none", elapsedMs: details.elapsedMs ?? null, errorCode: details.errorCode ?? null,
    request: details.request ?? null, output: details.output ?? null, parsedOutput: details.parsedOutput ?? null,
    rawOutput: details.rawOutput ?? null, providerEvidence: details.providerEvidence ?? null,
    providerMeta: details.providerEvidence?.returnedModelMetadata ?? null,
    schemaErrors: details.schemaErrors ?? [], conceptErrors: [], errors: [],
    actionValidation: [], commandValidation: [], bindingDiagnostics: [], proposedCommands: [], acceptedCommands: [],
    acceptedReasoningDelta: {}, acceptedMentorAnswerDelta: {},
  };
}

function providerFailureStatus(error) { return error?.statusKind ?? (error?.name === "AbortError" ? "provider_timeout" : "provider_transport_error"); }
function errorCode(error) { return String(error?.code ?? error?.message ?? error?.name ?? "processing_error").slice(0, 180); }
function normalize(value) { return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\u00a0/g, " ").replace(/\s+/g, " "); }
function containsNormalized(text, span) { const value = normalize(span); return Boolean(value) && normalize(text).includes(value); }
function plainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function unique(values) { return [...new Set(values)]; }
function meaningful(value) {
  if (Array.isArray(value)) return value.some(meaningful);
  if (!plainObject(value)) return value !== null && value !== undefined && value !== "" && value !== false;
  return Object.values(value).some(meaningful);
}

const REASONING_GROUNDING_ANCHORS = Object.freeze({
  stabilityAssessment: ["стабил", "нестабил", "гемодинами", "давлен", "пульс", "чсс"],
  workingDiagnosis: ["диагноз", "аппендиц", "думаю", "похоже", "вероят"],
  differential: ["дифференциал", "внематоч", "исключ", "менее вероят", "не снима"],
  managementIntent: ["план", "тактик", "наблюд", "леч", "операц", "оперир", "лапар"],
  rationale: ["потому", "чтобы", "из-за", "так как", "поэтому"],
  reassessmentPlan: ["повтор", "переоцен", "снова", "след", "отслеж", "монитор", "контрол"],
  contingencyPlan: ["если", "при ", "ухудш", "измен", "паден", "усил"],
  dispositionIntent: ["перев", "направ", "отделен", "палат", "домой", "выпис"],
  consultationIntent: ["обсуд", "совет", "консульт", "позов", "вызов"],
});
