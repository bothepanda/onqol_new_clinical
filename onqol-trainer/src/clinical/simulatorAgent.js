import {
  buildPatientInformationPolicy,
  isAuthorizedInformationSource,
  PATIENT_INFORMATION_CLASS,
} from "./informationPolicy.js";

const PREMATURE_TEACHING_RE =
  /диагноз\s+сформулирован\s+верно|это\s+подтверждает|высокая\s+вероятность|\bправильно\b|\bверно\b|overall\s+score|learner\s+score|you\s+are\s+(?:correct|right)/i;

function parseJsonPayload(payload) {
  if (typeof payload === "object" && payload !== null) return payload;
  const text = String(payload || "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Simulator agent did not return JSON.");
    return JSON.parse(match[0]);
  }
}

function compactSessionState(session) {
  const memory = session.workingMemory || {};
  return {
    session_id: session.session_id,
    phase: session.phase,
    completed_actions: session.completedActions,
    unsafe_actions: session.unsafeActions,
    unnecessary_actions: session.unnecessaryActions,
    revealed_findings: session.revealedFindings,
    applied_transitions: session.appliedTransitions,
    working_memory: {
      turn_number: memory.turnNumber || 0,
      working_diagnosis: memory.workingDiagnosis || null,
      differentials: memory.differentials || [],
      action_states: memory.actionStates || {},
      pending_operationalization: memory.pendingOperationalization || [],
      last_learner_move: memory.lastLearnerMove || null,
    },
    finished: session.finished,
  };
}

export function buildClinicalSimulatorPrompt({
  input,
  caseData,
  diseaseCard,
  retrievalCorpus,
  sessionBefore,
  deterministicUpdate,
  locale = "ru",
}) {
  const requiredLockedSources = deterministicUpdate.findingsRevealed.map((findingId) => {
    const group = Object.hasOwn(caseData.hidden_findings || {}, findingId)
      ? "hidden_findings"
      : "available_findings";
    return `${group}.${findingId}`;
  });

  return {
    system: [
      "You are the ON QOL Clinical Simulator Agent, representing the patient and clinical environment during an active simulation.",
      "Understand arbitrary natural clinical language in Russian or Kazakh. Learner questions do not need a predefined concept_id.",
      "You receive the complete Case Blueprint, Disease Card, retrieval corpus, current state, and conversation history.",
      "The action extraction and scoring pipeline is separate. Never score the learner, grade them, confirm correctness, teach guideline reasoning, or reveal the expected next decision during simulation.",
      "Return only data explicitly requested, automatically visible, caused by a performed action, or required by an applied state transition.",
      "LOCKED_FACT must be copied from the Case Card. INFERABLE_FINDING is allowed only when listed by id in the authored policy and must not alter diagnosis, severity, timeline, resources, or key decisions. Otherwise use UNKNOWN.",
      "Never reveal a hidden finding unless it is listed among already revealed findings or required_locked_sources.",
      "Retrieval helps understand terminology only. It cannot create patient facts, score the learner, or override the Case Card.",
      "Return strict JSON only. Do not include a closing tutoring question; the application appends the neutral prompt.",
    ].join("\n"),
    user: JSON.stringify(
      {
        locale,
        raw_user_text: input,
        case_blueprint: caseData,
        disease_card: diseaseCard,
        retrieval_corpus: retrievalCorpus,
        patient_information_policy: buildPatientInformationPolicy(caseData),
        current_state_before: compactSessionState(sessionBefore),
        current_state_after: compactSessionState(deterministicUpdate.session),
        conversation_history: sessionBefore.messages,
        extracted_actions: deterministicUpdate.parsed.actions,
        required_locked_sources: requiredLockedSources,
        neutral_closing_prompt: deterministicUpdate.neutralPrompt,
        output_schema: {
          response_parts: [
            {
              classification: "LOCKED_FACT | INFERABLE_FINDING | UNKNOWN",
              source_id:
                "available_findings.<id> | hidden_findings.<id> | initial_presentation | authored inferable finding id | null",
              exact_text:
                "Only for a short exact substring copied from initial_presentation, or authored inferable text. Omit for finding source ids and UNKNOWN.",
            },
          ],
          retrieval_sources_used: ["source id used only for terminology understanding"],
        },
      },
      null,
      2
    ),
  };
}

function sourceFindingId(sourceId) {
  const [group, findingId] = String(sourceId || "").split(".");
  return ["available_findings", "hidden_findings"].includes(group) ? findingId : null;
}

function formatFinding(caseData, sourceId) {
  const [group, findingId] = String(sourceId).split(".");
  const finding = caseData[group]?.[findingId];
  return finding ? `**${finding.title}:** ${finding.text}` : "";
}

function validateAndMaterializePart(caseData, part, revealedFindingIds) {
  if (!isAuthorizedInformationSource(caseData, part, revealedFindingIds)) return null;

  if (part.classification === PATIENT_INFORMATION_CLASS.UNKNOWN) {
    return {
      text: "Эти данные не заданы в карте пациента.",
      findingId: null,
      source: { classification: part.classification, source_id: null },
    };
  }

  if (part.classification === PATIENT_INFORMATION_CLASS.INFERABLE_FINDING) {
    const authored = (caseData.inferable_findings || []).find((finding) => finding.id === part.source_id);
    const text = String(part.exact_text || authored?.text || "").trim();
    if (!text || PREMATURE_TEACHING_RE.test(text)) return null;
    return {
      text,
      findingId: null,
      source: { classification: part.classification, source_id: part.source_id },
    };
  }

  if (part.source_id === "initial_presentation") {
    const exactText = String(part.exact_text || "").trim();
    if (!exactText || !caseData.initial_presentation.text.includes(exactText)) return null;
    return {
      text: exactText,
      findingId: null,
      source: { classification: part.classification, source_id: part.source_id },
    };
  }

  const text = formatFinding(caseData, part.source_id);
  if (!text) return null;
  return {
    text,
    findingId: sourceFindingId(part.source_id),
    source: { classification: part.classification, source_id: part.source_id },
  };
}

function requiredFindingParts(caseData, deterministicUpdate) {
  return deterministicUpdate.findingsRevealed.map((findingId) => {
    const group = Object.hasOwn(caseData.hidden_findings || {}, findingId)
      ? "hidden_findings"
      : "available_findings";
    const sourceId = `${group}.${findingId}`;
    return {
      text: formatFinding(caseData, sourceId),
      findingId,
      source: { classification: PATIENT_INFORMATION_CLASS.LOCKED_FACT, source_id: sourceId },
    };
  });
}

function materializeEnvelope(caseData, envelope, deterministicUpdate) {
  const revealed = [
    ...new Set([
      ...(deterministicUpdate.session.revealedFindings || []),
      ...(deterministicUpdate.findingsRevealed || []),
    ]),
  ];
  const materialized = requiredFindingParts(caseData, deterministicUpdate);
  const seenSources = new Set(materialized.map((part) => part.source.source_id));

  for (const rawPart of envelope.response_parts || []) {
    const part = validateAndMaterializePart(caseData, rawPart, revealed);
    if (!part || seenSources.has(part.source.source_id)) continue;
    materialized.push(part);
    seenSources.add(part.source.source_id);
  }

  const body = [...new Set(materialized.map((part) => part.text).filter(Boolean))];
  const reply = [...body, deterministicUpdate.neutralPrompt].join("\n\n");
  if (PREMATURE_TEACHING_RE.test(reply)) throw new Error("Simulator response contained premature teaching.");

  return {
    reply,
    informationUsed: materialized.map((part) => part.source),
    additionalFindingIds: materialized
      .map((part) => part.findingId)
      .filter((findingId) => findingId && !deterministicUpdate.findingsRevealed.includes(findingId)),
    retrievalSourcesUsed: Array.isArray(envelope.retrieval_sources_used)
      ? envelope.retrieval_sources_used.filter((source) => typeof source === "string")
      : [],
  };
}

export async function runClinicalSimulatorAgent(context, options = {}) {
  const fallback = {
    reply: context.deterministicUpdate.reply,
    informationUsed: requiredFindingParts(context.caseData, context.deterministicUpdate).map(
      (part) => part.source
    ),
    additionalFindingIds: [],
    retrievalSourcesUsed: [],
    provider: "deterministic_fallback",
    model: null,
    version: options.simulatorVersion || "0.1.0",
    errorCode: null,
  };

  if (!options.llm) return fallback;

  try {
    const prompt = buildClinicalSimulatorPrompt(context);
    const payload = await options.llm(prompt);
    const materialized = materializeEnvelope(
      context.caseData,
      parseJsonPayload(payload),
      context.deterministicUpdate
    );
    return {
      ...materialized,
      provider: options.provider || "anthropic",
      model: options.model || null,
      version: options.simulatorVersion || "0.1.0",
      errorCode: null,
    };
  } catch {
    return { ...fallback, errorCode: "simulator_agent_fallback" };
  }
}
