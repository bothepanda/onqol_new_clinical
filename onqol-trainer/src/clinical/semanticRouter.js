import { buildAllowedActionMap } from "./schemas/caseSchema.js";
import {
  DISPOSITION_DESTINATIONS,
  normalizeReasoningDelta,
  verbatimOrNull,
} from "./core/reasoningState.js";
import {
  ADMINISTRATION_ROUTES,
  ROUTER_INTENT_TYPES as SCHEMA_INTENT_TYPES,
  ROUTER_SCHEMA_VERSION,
} from "./schemas/routerSchema.js";

// Re-exported from the contract rather than declared twice: the list the prompt
// offers and the enum the provider enforces must be the same list.
export const ROUTER_INTENT_TYPES = [...SCHEMA_INTENT_TYPES];
export { ROUTER_SCHEMA_VERSION };

const END_CASE_RE =
  /^\s*(?:конец\s+кейса|завершить\s+(?:кейс|сессию)|finish|end\s+case)[.!?]?\s*$/iu;

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

function normalizeForGrounding(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DIAGNOSTIC_FRAMING_RE =
  /(дифференц|исключ|подозр|гипотез|думаю|считаю|вероят|похоже|рабочи[йм]\s+диагноз|может\s+быть)/iu;
const ACTION_FRAMING_RE =
  /(назнач|выполн|сдела|провед|осмотр|анализ|тест|узи|кт|мрт|введ|перевед|вызов|консультац)/iu;

// The router may classify a named hypothesis, but it may not invent one. These
// patterns are the learner-language aliases from the appendicitis vocabulary,
// reduced to stems so ordinary inflection and minor spelling variation survive.
const HYPOTHESIS_GROUNDING_PATTERNS = Object.freeze({
  diagnosis_acute_appendicitis: /ап+енд?[а-я]{0,3}ц[а-я]{0,2}ит|appendicitis/iu,
  acute_appendicitis: /ап+енд?[а-я]{0,3}ц[а-я]{0,2}ит|appendicitis/iu,
  uncomplicated_appendicitis: /неосложненн\S*\s+ап+енд?[а-я]{0,3}ц[а-я]{0,2}ит|uncomplicated\s+appendicitis/iu,
  complicated_appendicitis:
    /осложненн\S*\s+ап+ендицит|перфоративн\S*\s+ап+ендицит|гангренозн\S*\s+ап+ендицит|appendicitis\s+with\s+peritonitis|complicated\s+appendicitis/iu,
  differential_ectopic: /внематоч|эктопическ|жатырдан\s+тыс|эктопиялық\s+жүктілік|ectopic\s+pregnancy|tubal\s+pregnancy/iu,
  ectopic_pregnancy: /внематоч|эктопическ|жатырдан\s+тыс|эктопиялық\s+жүктілік|ectopic\s+pregnancy|tubal\s+pregnancy/iu,
  ovarian_torsion: /перекрут\S*\s+(яичник|придат)|торси\S*\s+яичник|аналық\s+без\S*\s+бұрал|ovarian\s+torsion|adnexal\s+torsion/iu,
  pelvic_inflammatory_disease:
    /взомт|\bпид\b|\bpid\b|сальпингит|воспалительн\S*\s+заболеван\S*\s+орган\S*\s+малого\s+таза|pelvic\s+inflammatory/iu,
  renal_colic:
    /почечн\S*\s+колик|камень\S*\s+мочеточник|мочекамен|уретеролити|бүйрек\s+шаншу|несепағар\S*\s+тас|renal\s+colic|ureter\S*\s+(colic|stone)|urolithiasis/iu,
  gastroenteritis: /гастроэнтерит|кишечн\S*\s+инфекц|ішек\s+инфекция|gastroenteritis|enteric\s+infection/iu,
  acute_prostatitis: /простатит|prostatitis/iu,
  prostatic_abscess: /абсцесс\S*\s+прост|prostatic\s+abscess/iu,
});

/**
 * A routed diagnosis is allowed to create a diagnosis action only when the
 * learner's own contiguous fragment actually names that hypothesis.
 *
 * This is intentionally stricter than the language model. In the live pilot
 * check, a pregnancy-status check was once turned into an ectopic differential,
 * and an abdominal examination was followed by "the differential was recorded"
 * although the learner had stated none. Dropping an uncertain diagnosis signal
 * is safer than adding reasoning the learner never expressed.
 */
function diagnosisGrounded(action, requestedFragment, learnerText) {
  if (action?.intent_type !== "diagnosis") return true;
  if (learnerText === undefined) return true;
  // Older fixtures and a defensive non-strict provider response may omit the
  // fragment. The full learner turn is still an admissible grounding surface;
  // it can prove the diagnosis was named, never manufacture one.
  const fragment = normalizeForGrounding(requestedFragment || learnerText);
  if (!fragment) return false;
  if (action.id === "diagnosis_acute_appendicitis") {
    return /ап+енд?[а-я]{0,3}ц[а-я]{0,2}ит/iu.test(fragment);
  }
  if (action.id === "differential_ectopic") {
    if (/(внематоч|эктопическ|аднексит)/iu.test(fragment)) return true;
    return /беремен/iu.test(fragment) && DIAGNOSTIC_FRAMING_RE.test(fragment);
  }
  return (action.accepted_phrasings || [])
    .map(normalizeForGrounding)
    .filter((phrase) => phrase.length >= 4)
    .some((phrase) => fragment.includes(phrase));
}

function hypothesisGrounded(conceptId, allowed, conceptMap, learnerText) {
  if (learnerText === undefined) return true;
  const candidates = [conceptId, ...(conceptMap[conceptId] || [])];
  const text = normalizeForGrounding(learnerText);

  for (const candidate of candidates) {
    const pattern = HYPOTHESIS_GROUNDING_PATTERNS[candidate];
    if (pattern?.test(text)) return true;
    const action = allowed.get(candidate);
    if (action?.intent_type === "diagnosis" && diagnosisGrounded(action, learnerText, learnerText)) {
      return true;
    }
  }
  return false;
}

function keepGroundedReasoning(reasoning, allowed, conceptMap, learnerText) {
  if (!reasoning) return null;
  const isGrounded = (conceptId) =>
    hypothesisGrounded(conceptId, allowed, conceptMap, learnerText);
  const items = reasoning.differential.items.filter((item) => isGrounded(item.concept_id));
  const workingConcept = reasoning.working_diagnosis.concept_id;
  const workingGrounded = workingConcept ? isGrounded(workingConcept) : false;

  return {
    ...reasoning,
    working_diagnosis: {
      ...reasoning.working_diagnosis,
      stated: reasoning.working_diagnosis.stated && workingGrounded,
      concept_id: workingGrounded ? workingConcept : null,
      uncertainty_stated: workingGrounded
        ? reasoning.working_diagnosis.uncertainty_stated
        : false,
    },
    differential: {
      ...reasoning.differential,
      stated: items.length > 0,
      ranked: items.length > 0 && reasoning.differential.ranked,
      has_dangerous_alternative:
        items.length > 0 && reasoning.differential.has_dangerous_alternative,
      concept_ids: items.map((item) => item.concept_id),
      items,
    },
  };
}

function unknownFragmentKind(fragment, learnerText) {
  const whole = String(learnerText || "");
  if (
    fragment &&
    DIAGNOSTIC_FRAMING_RE.test(whole) &&
    !ACTION_FRAMING_RE.test(String(fragment))
  ) {
    return "reasoning_only";
  }
  return "unrecognized_fragment";
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
      "For every intent, copy the shortest exact contiguous span that requested it into requested_fragment. Never paraphrase that field.",
      "Use recent conversation only to resolve pronouns or elliptical follow-ups. Extract actions only from raw_user_text, never repeat actions merely because they appear in history.",
      "The separate simulator handles arbitrary questions. A question does not need a concept_id unless it expresses a scoring-relevant action.",
      "Broad requests should map to the relevant available sub-concepts.",
      "OPERATIVE LANGUAGE. A possibility is not a decision and a decision is not a performed procedure.",
      "Map hypothetical/tentative language (for example possible surgery, preparing for a potential operation, considering surgery) only to operative_intent or prepare_for_possible_surgery when those concepts are allowed. Never map it to procedure start or source-control completion.",
      "Map a committed appendectomy decision without an access to decision_for_appendectomy. Map an explicitly committed open or laparoscopic procedure to the corresponding operative_approach concept.",
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
      "",
      "HYPOTHESES. List one entry in `differential.items` per diagnosis the learner names, including the one they lead with.",
      "Set `rank` only when the learner orders them - by number, by wording (\"наиболее вероятен\", \"менее вероятно\", \"в первую очередь думаю о\"), or by explicit comparison. Leave rank null for an unordered list.",
      "Set `dangerous` only on a hypothesis the learner themselves frames as the one that must not be missed. Do not mark something dangerous because you know it is.",
      "CONTINGENCY TRIGGERS. `contingency.trigger_concept_ids` lists investigations whose RESULT the learner says would change the plan (\"если ХГЧ положительный - меняю тактику\" gives the pregnancy test concept).",
      "Record the investigation only. Never record the imagined result, and never record a trigger phrased as a change in the patient rather than as a test.",
      "",
      "QUOTES. Fields ending in `_verbatim`, plus `evidence_for`, `evidence_against` and `justification`, must contain text COPIED EXACTLY from raw_user_text.",
      "Copy a contiguous span, character for character. Do not translate, summarise, correct spelling, complete a sentence, merge two spans, or write your own description of what the learner said.",
      "A quote that is not an exact span of raw_user_text is discarded by the caller, so an approximation is worth nothing - return null or an empty list instead.",
      "Quote the shortest span that carries the thought. If the learner did not say the thing, there is no quote: return null.",
      "Reasoning fields never create an action. If the learner discusses a test without requesting it, that belongs in reasoning only.",
      "When uncertain, return false or null. A guess here is worse than a gap.",
      "",
      "THIRD JOB: TREATMENT PARAMETERS.",
      "When the learner orders a drug or a fluid, transcribe what they specified into `action_parameters`.",
      "`concept_id` must be the concept the order belongs to, and `verbatim` must be the exact span of raw_user_text carrying the order.",
      "Fill only what the learner actually said. A dose they did not give is null, not a typical dose.",
      "Normalise units into the numeric fields when the learner's wording is unambiguous - \"1 л\" is volume_ml 1000 - and leave the ambiguous ones null.",
      "\"2 мг\" and \"2 мл\" are different orders. Transcribe exactly what was written and never repair it.",
      "One entry per distinct order. Two boluses at two rates are two entries, not one summed volume.",
      "These parameters describe an order; they never create it, never confirm it is correct and never change a score.",
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
              requested_fragment: "exact span of raw_user_text for this intent | null",
            },
          ],
          unresolved_fragments: [],
          action_parameters: [
            {
              concept_id: "allowed_concept_id the order belongs to",
              verbatim: "exact span of raw_user_text carrying this order",
              drug_name: "string | null",
              dose_value: "number | null",
              dose_unit: "string | null",
              route: ADMINISTRATION_ROUTES.join(" | ") + " | null",
              rate: "string | null",
              frequency: "string | null",
              duration: "string | null",
              fluid_type: "string | null",
              volume_ml: "number | null",
              timing: "string | null",
            },
          ],
          reasoning: {
            stability: { stated: "boolean", learner_assessment: "stable | unstable | uncertain | null" },
            problem_representation_stated: "boolean",
            problem_representation_verbatim:
              "exact span of raw_user_text where the learner summarises the patient, else null",
            working_diagnosis: {
              stated: "boolean",
              concept_id: "allowed_concept_id | null",
              uncertainty_stated: "boolean",
            },
            differential: {
              stated: "boolean",
              ranked: "boolean",
              has_dangerous_alternative: "boolean",
              items: [
                {
                  concept_id: "allowed_concept_id",
                  rank: "integer >= 1 when the learner ordered the hypotheses, else null",
                  dangerous: "boolean - the learner calls this the one not to miss",
                  evidence_for: ["exact spans of raw_user_text arguing for this hypothesis"],
                  evidence_against: ["exact spans of raw_user_text arguing against it"],
                },
              ],
            },
            test_reasoning: [
              {
                concept_id: "allowed_concept_id",
                purpose_stated: "boolean",
                management_consequence_stated: "boolean",
                justification:
                  "exact span of raw_user_text saying why this investigation is wanted, else null",
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
            contingency: {
              stated: "boolean",
              trigger_concept_ids: [],
              trigger_verbatim: [
                "exact spans of raw_user_text saying what would change the plan, including triggers that name no investigation",
              ],
            },
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

/**
 * Treatment parameters, kept only where the learner's own words back them.
 *
 * `verbatim` is the anchor. A parameter set whose quote is not an exact span of
 * this turn's message is dropped whole: the numbers would then be the model's,
 * and a dose nobody typed must never appear in a training record.
 *
 * Nothing here creates or validates an action. The engine has already decided
 * what happened; this only describes it for the reviewer.
 */
export function normalizeActionParameters(raw, options = {}) {
  if (!Array.isArray(raw)) return [];
  const allowed =
    options.allowedConceptIds instanceof Set
      ? options.allowedConceptIds
      : new Set(options.allowedConceptIds || []);
  const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const number = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : null);

  const parameters = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const conceptId = entry.concept_id;
    if (typeof conceptId !== "string") continue;
    if (allowed.size > 0 && !allowed.has(conceptId)) continue;
    const verbatim = verbatimOrNull(entry.verbatim, options.learnerText);
    if (!verbatim) continue;

    parameters.push({
      concept_id: conceptId,
      verbatim,
      drug_name: text(entry.drug_name),
      dose_value: number(entry.dose_value),
      dose_unit: text(entry.dose_unit),
      route: ADMINISTRATION_ROUTES.includes(entry.route) ? entry.route : null,
      rate: text(entry.rate),
      frequency: text(entry.frequency),
      duration: text(entry.duration),
      fluid_type: text(entry.fluid_type),
      volume_ml: number(entry.volume_ml),
      timing: text(entry.timing),
      // Says out loud what this record is for, so no later reader mistakes a
      // transcription for a judgement.
      review_status: "transcribed_not_validated",
      eligible_for_scoring: false,
    });
  }
  return parameters;
}

export function validateRouterOutput(routerPayload, caseData, options = {}) {
  const allowed = buildAllowedActionMap(caseData);
  const conceptMap = options.conceptMap || {};
  const parsed = parseJsonPayload(routerPayload);
  const intents = [];
  const actions = [];
  const invalidConcepts = [];
  const recognizedButUndefined = [];
  const unresolvedByKind = [];
  const managementDecisions = [];
  const rejectedUngroundedIntents = [];
  const seenActions = new Set();

  for (const rawIntent of parsed.intents || []) {
    const type = ROUTER_INTENT_TYPES.includes(rawIntent?.type) ? rawIntent.type : "unknown";
    const conceptId = rawIntent?.concept_id || null;
    const confidence = Number.isFinite(Number(rawIntent?.confidence))
      ? Math.max(0, Math.min(1, Number(rawIntent.confidence)))
      : 0;
    const requestedFragment = verbatimOrNull(rawIntent?.requested_fragment, options.learnerText);

    if (conceptId && !allowed.has(conceptId) && !Object.hasOwn(conceptMap, conceptId)) {
      invalidConcepts.push(conceptId);
      intents.push({
        type: "unknown",
        concept_id: null,
        confidence: 0,
        requested_fragment: requestedFragment,
      });
      if (requestedFragment) {
        unresolvedByKind.push({
          concept_id: null,
          kind: "unrecognized_fragment",
          requested_fragment: requestedFragment,
          reason_code: "invalid_router_concept",
        });
      }
      continue;
    }

    intents.push({ type, concept_id: conceptId, confidence, requested_fragment: requestedFragment });
    if (type === "unknown" && requestedFragment) {
      const fragmentKind = unknownFragmentKind(requestedFragment, options.learnerText);
      unresolvedByKind.push({
        concept_id: null,
        kind: fragmentKind,
        requested_fragment: requestedFragment,
        reason_code: fragmentKind === "reasoning_only" ? "router_reasoning_only" : "router_unrecognized",
      });
    }
    // What KIND of thing is this? An empty mapping used to mean six different
    // things; the registry says which one, so the engine can answer each
    // honestly instead of falling silent. See conceptRegistry.js.
    const typed = conceptId ? options.conceptRegistry?.(conceptId) || null : null;
    // "Когда будет УЗИ?" arrives as a question, and a question is exactly what
    // it is - but it still deserves an answer about availability. These two
    // kinds answer whatever intent type they arrive under.
    const answersAnyIntent = typed && ["resource_query", "unsupported"].includes(typed.kind);
    if (conceptId && (answersAnyIntent || (type !== "question" && type !== "unknown"))) {
      if (typed?.kind === "management_decision") {
        managementDecisions.push({
          concept_id: conceptId,
          decision_id: typed.decision_id,
          commitment: "ordered",
        });
        continue;
      }
      if (typed?.kind === "operative_approach") {
        managementDecisions.push({
          concept_id: conceptId,
          decision_id: "operative_approach",
          approach: typed.approach,
          commitment: "selected",
          requested_fragment: requestedFragment,
        });
        continue;
      }
      if (typed && typed.kind !== "action" && typed.kind !== "finding_bundle") {
        unresolvedByKind.push({
          concept_id: conceptId,
          kind: typed.kind,
          // Whatever the kind needs in order to answer: a reason, a question,
          // the slot to read, the candidate actions.
          reason_ru: typed.reason_ru || typed.unavailable_reason_ru || null,
          question_ru: typed.question_ru || null,
          slot_id: typed.slot_id || null,
          finding_bundle: typed.finding_bundle || null,
          candidates: typed.candidates || [],
          findings_status: typed.findings_status || null,
          requested_fragment: requestedFragment,
          reason_code: `typed_${typed.kind}`,
        });
        continue;
      }
      if (typed?.kind === "action" && typed.findings_status && !(typed.maps_to || []).length) {
        // A real action whose authored result has not been signed off. Saying so
        // is a better answer than saying nothing.
        unresolvedByKind.push({
          concept_id: conceptId,
          kind: "action_not_modelled",
          reason_ru: typed.unavailable_reason_ru || null,
          findings_status: typed.findings_status,
          slot_id: null,
          finding_bundle: null,
          candidates: [],
          question_ru: null,
          requested_fragment: requestedFragment,
          reason_code: "authored_finding_unavailable",
        });
        continue;
      }

      const mappedIds = allowed.has(conceptId) ? [conceptId] : conceptMap[conceptId] || [];
      const validMappedIds = mappedIds.filter((id) => allowed.has(id));

      if (validMappedIds.length === 0) {
        recognizedButUndefined.push(conceptId);
        unresolvedByKind.push({
          concept_id: conceptId,
          kind: "action_not_available_for_patient",
          requested_fragment: requestedFragment,
          reason_code: "action_absent_from_patient_variant",
        });
        continue;
      }

      for (const mappedId of validMappedIds) {
        const mappedAction = allowed.get(mappedId);
        if (type === "diagnosis" && !diagnosisGrounded(mappedAction, requestedFragment, options.learnerText)) {
          rejectedUngroundedIntents.push({
            concept_id: conceptId,
            mapped_action_id: mappedId,
            requested_fragment: requestedFragment,
            reason_code: "diagnosis_not_grounded_in_learner_text",
          });
          continue;
        }
        if (!seenActions.has(mappedId)) {
          actions.push({
            id: mappedId,
            source: "semantic_router",
            intent_type: type,
            confidence,
            routed_concept_id: conceptId,
            ...(requestedFragment ? { requested_fragment: requestedFragment } : {}),
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
      // Quotes are checked against the message the learner actually sent. See
      // verbatimOrNull: without this a model could write anything into a field
      // the mentor is allowed to quote back.
      learnerText: options.learnerText,
    });
    reasoning = keepGroundedReasoning(
      reasoning,
      allowed,
      conceptMap,
      options.learnerText
    );
  } catch {
    reasoning = null;
  }

  return {
    intents,
    actions,
    invalidConcepts,
    recognizedButUndefined,
    // Concepts that were understood but are not actions: hypotheses, resource
    // questions, orders too vague to act on, and actions whose authored result
    // is not signed. Each gets its own answer downstream.
    unresolvedByKind,
    managementDecisions,
    rejectedUngroundedIntents,
    reasoning,
    actionParameters: normalizeActionParameters(parsed.action_parameters, {
      allowedConceptIds: new Set([...allowed.keys(), ...Object.keys(conceptMap)]),
      learnerText: options.learnerText,
    }),
    routerSchemaVersion: ROUTER_SCHEMA_VERSION,
    unresolvedFragments: (parsed.unresolved_fragments || [])
      .map((fragment) => verbatimOrNull(fragment, options.learnerText))
      .filter(Boolean),
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
  return validateRouterOutput(routerPayload, caseData, {
    conceptMap,
    conceptRegistry: options.conceptRegistry,
    learnerText: input,
  });
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
