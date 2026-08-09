import { buildAllowedActionMap } from "./schemas/caseSchema.js";
import { DISPOSITION_DESTINATIONS, normalizeReasoningDelta } from "./core/reasoningState.js";

export const ROUTER_INTENT_TYPES = [
  "request_history",
  "request_examination",
  "request_test",
  "diagnosis",
  "management",
  "question",
  "unknown",
];

const END_CASE_RE = /конец кейса|завершить|finish|end case/i;

export class SemanticRouterUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "SemanticRouterUnavailableError";
  }
}

export function buildAllowedConcepts(caseData, conceptMap = {}) {
  const caseConcepts = [
    ...caseData.expected_actions,
    ...caseData.acceptable_alternatives,
    ...caseData.unnecessary_actions,
    ...caseData.unsafe_actions,
  ].map((action) => ({
    concept_id: action.id,
    type_hint: action.intent_type || inferIntentType(action),
    description: action.router_description || action.concept || action.id,
    phase: action.phase || null,
  }));

  const dictionaryConcepts = Object.entries(conceptMap).map(([conceptId, mapsTo]) => ({
    concept_id: conceptId,
    type_hint: null,
    description: `Dictionary concept. Maps to current case concept(s): ${mapsTo.length ? mapsTo.join(", ") : "recognized_but_undefined"}.`,
    phase: null,
  }));

  return [...caseConcepts, ...dictionaryConcepts];
}

function inferIntentType(action) {
  if (action.phase === "investigations") return "request_test";
  if (action.phase === "initial assessment" && /exam|осмотр|abdominal/i.test(action.concept || action.id)) {
    return "request_examination";
  }
  if (action.phase === "initial assessment") return "request_history";
  if (action.phase === "diagnostic reasoning") return "diagnosis";
  if (action.phase === "management") return "management";
  return "unknown";
}

export function buildSemanticRouterPrompt({ input, caseData, session, locale = "ru", conceptMap = {} }) {
  const allowedConcepts = buildAllowedConcepts(caseData, conceptMap);

  return {
    system: [
      "You are the ON QOL Action Extraction pipeline.",
      "Your only job is to extract scoring-relevant learner actions into strict JSON intents.",
      "You may interpret meaning in Russian and Kazakh.",
      "You must not create findings, scores, medical advice, guideline references, or new concept IDs.",
      "Use only concept_id values from the allowed concepts list.",
      "A single message may contain multiple intents.",
      "Use recent conversation only to resolve pronouns or elliptical follow-ups. Extract actions only from raw_user_text, never repeat actions merely because they appear in history.",
      "The separate simulator handles arbitrary questions. A question does not need a concept_id unless it expresses a scoring-relevant action.",
      "Broad requests should map to the relevant available sub-concepts.",
      "If part of the message is unclear, return unknown only for that part.",
      "Return JSON only, with no Markdown.",
      "",
      "SECOND JOB: REASONING EXTRACTION.",
      "Alongside intents, report what the learner explicitly articulated, in the `reasoning` object.",
      "This is transcription, not assessment. You record that a claim was made; you never judge whether it is medically right.",
      "Extract only what the learner explicitly states or clearly commits to.",
      "Do not infer medical correctness. Do not decide a diagnosis is right, a test is indicated, or a patient is truly stable.",
      "Do not infer stability from vital signs, from the case, or from the conversation: only the learner saying so counts.",
      "Do not infer a test rationale merely because the rationale would be medically obvious.",
      "Do not infer a dangerous alternative unless the learner names it or clearly frames something as needing to be excluded.",
      "Do not infer a contingency plan from generic words such as \"наблюдаем\" - a contingency needs a stated trigger for changing course.",
      "Reasoning fields never create an action. If the learner discusses a test without requesting it, that belongs in reasoning only.",
      "When uncertain, return false or null. A guess here is worse than a gap.",
    ].join("\n"),
    user: JSON.stringify(
      {
        raw_user_text: input,
        locale,
        current_phase: session.phase,
        completed_actions: session.completedActions || [],
        working_memory: session.workingMemory
          ? {
              working_diagnosis: session.workingMemory.workingDiagnosis,
              differentials: session.workingMemory.differentials,
              pending_operationalization: session.workingMemory.pendingOperationalization,
              last_learner_move: session.workingMemory.lastLearnerMove,
            }
          : null,
        recent_conversation: (session.messages || []).slice(-8),
        allowed_intent_types: ROUTER_INTENT_TYPES,
        allowed_concepts: allowedConcepts,
        routing_note:
          "Concept ids may be case-owned ids or dictionary ids. Dictionary ids are validated and mapped after routing; recognized-but-undefined dictionary ids must not create findings.",
        output_schema: {
          intents: [
            {
              type: "request_history | request_examination | request_test | diagnosis | management | question | unknown",
              concept_id: "allowed_concept_id | null",
              confidence: "0.0-1.0",
            },
          ],
          unresolved_fragments: [],
          reasoning: {
            stability: { stated: "boolean", learner_assessment: "stable | unstable | uncertain | null" },
            problem_representation_stated: "boolean",
            working_diagnosis: {
              stated: "boolean",
              concept_id: "allowed_concept_id | null",
              uncertainty_stated: "boolean",
            },
            differential: {
              stated: "boolean",
              ranked: "boolean",
              has_dangerous_alternative: "boolean",
              concept_ids: [],
            },
            test_reasoning: [
              {
                concept_id: "allowed_concept_id",
                purpose_stated: "boolean",
                management_consequence_stated: "boolean",
              },
            ],
            management: {
              plan_stated: "boolean",
              urgency_stated: "boolean",
              rationale_stated: "boolean",
            },
            observation: {
              active: "boolean",
              goal_stated: "boolean",
              reassessment_interval_stated: "boolean",
              escalation_criteria_stated: "boolean",
            },
            reassessment_stated: "boolean",
            contingency_stated: "boolean",
            disposition: {
              stated: "boolean",
              destination: DISPOSITION_DESTINATIONS.join(" | ") + " | null",
            },
            consultation: {
              own_assessment_stated: "boolean",
              consultation_question_stated: "boolean",
            },
          },
        },
      },
      null,
      2
    ),
  };
}

function parseJsonPayload(payload) {
  if (typeof payload === "object" && payload !== null) return payload;
  const text = String(payload || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Router did not return JSON.");
    return JSON.parse(match[0]);
  }
}

export function validateRouterOutput(routerPayload, caseData, options = {}) {
  const allowed = buildAllowedActionMap(caseData);
  const conceptMap = options.conceptMap || {};
  const parsed = parseJsonPayload(routerPayload);
  const intents = [];
  const actions = [];
  const invalidConcepts = [];
  const recognizedButUndefined = [];
  const seenActions = new Set();

  for (const rawIntent of parsed.intents || []) {
    const type = ROUTER_INTENT_TYPES.includes(rawIntent?.type) ? rawIntent.type : "unknown";
    const conceptId = rawIntent?.concept_id || null;
    const confidence = Number.isFinite(Number(rawIntent?.confidence))
      ? Math.max(0, Math.min(1, Number(rawIntent.confidence)))
      : 0;

    if (conceptId && !allowed.has(conceptId) && !Object.hasOwn(conceptMap, conceptId)) {
      invalidConcepts.push(conceptId);
      intents.push({ type: "unknown", concept_id: null, confidence: 0 });
      continue;
    }

    intents.push({ type, concept_id: conceptId, confidence });
    if (conceptId && type !== "question" && type !== "unknown") {
      const mappedIds = allowed.has(conceptId) ? [conceptId] : conceptMap[conceptId] || [];
      const validMappedIds = mappedIds.filter((id) => allowed.has(id));

      if (validMappedIds.length === 0) {
        recognizedButUndefined.push(conceptId);
        continue;
      }

      for (const mappedId of validMappedIds) {
        if (!seenActions.has(mappedId)) {
          actions.push({
            id: mappedId,
            source: "semantic_router",
            intent_type: type,
            confidence,
            routed_concept_id: conceptId,
          });
          seenActions.add(mappedId);
        }
      }
    }
  }

  // Reasoning is a strictly additive, strictly optional channel. It is
  // normalised against the same allowed-concept set as actions, and any failure
  // to produce a usable object costs the turn its reasoning signal - never the
  // turn itself. A reasoning field can never create a completed action: nothing
  // below touches `actions`.
  let reasoning;
  try {
    reasoning = normalizeReasoningDelta(parsed.reasoning, {
      allowedConceptIds: new Set([...allowed.keys(), ...Object.keys(conceptMap)]),
    });
  } catch {
    reasoning = null;
  }

  return {
    intents,
    actions,
    invalidConcepts,
    recognizedButUndefined,
    reasoning,
    unresolvedFragments: parsed.unresolved_fragments || [],
    unknownText: intents.some((intent) => intent.type === "unknown") ? "unresolved_intent" : "",
    source: "semantic_router",
  };
}

export async function routeUserInput(input, caseData, session, options = {}) {
  if (END_CASE_RE.test(input)) {
    return {
      intents: [{ type: "management", concept_id: "end_case", confidence: 1 }],
      actions: [{ id: "end_case", source: "command", confidence: 1 }],
      invalidConcepts: [],
      reasoning: null,
      unknownText: "",
      source: "command",
    };
  }

  const { llm, locale = "ru", conceptMap = {} } = options;
  if (!llm) {
    throw new SemanticRouterUnavailableError(
      "Semantic router is unavailable: no LLM client was provided."
    );
  }

  const prompt = buildSemanticRouterPrompt({ input, caseData, session, locale, conceptMap });
  const routerPayload = await llm(prompt);
  return validateRouterOutput(routerPayload, caseData, { conceptMap });
}

export function createAnthropicBrowserClient({
  apiKey,
  model = "claude-haiku-4-5-20251001",
  maxTokens = 1200,
  temperature = 0,
}) {
  if (!apiKey) return null;

  return async function anthropicClient(prompt) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Clinical model API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content?.map((block) => block.text || "").join("") || "";
  };
}

export function createAnthropicBrowserRouter(options) {
  return createAnthropicBrowserClient({ ...options, maxTokens: options.maxTokens || 700 });
}
