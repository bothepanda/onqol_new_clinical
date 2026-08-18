import {
  allowedSourceIdsForTurn,
  buildPatientInformationPolicy,
  buildSanitizedCaseView,
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
  sessionBefore,
  deterministicUpdate,
  locale = "ru",
}) {
  const allowedSourceIds = allowedSourceIdsForTurn(
    sessionBefore.revealedFindings || [],
    deterministicUpdate.findingsRevealed || []
  );
  const caseView = buildSanitizedCaseView(caseData, allowedSourceIds);
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
      "You receive a turn-scoped patient view containing only facts already revealed or deterministically unlocked on this turn.",
      "Absence from the patient view is a hard boundary, not permission to infer, reconstruct, or retrieve a fact.",
      "The action extraction and scoring pipeline is separate. Never score the learner, grade them, confirm correctness, teach guideline reasoning, or reveal the expected next decision during simulation.",
      "Return only data explicitly requested, automatically visible, caused by a performed action, or required by an applied state transition.",
      "Every LOCKED_FACT source_id must appear in allowed_locked_sources and its text must come from patient_view. Otherwise use UNKNOWN.",
      "Every UNKNOWN must identify exactly one requested_fragment copied verbatim from raw_user_text and one reason_code. Never emit an unanchored UNKNOWN.",
      "INFERABLE_FINDING is allowed only when listed by id in the authored policy and must not alter diagnosis, severity, timeline, resources, or key decisions.",
      "No disease card, answer key, rubric, hidden truth, future result, or retrieval corpus is available to you.",
      "Return strict JSON only. Do not include a closing tutoring question; the application appends the neutral prompt.",
    ].join("\n"),
    user: JSON.stringify(
      {
        locale,
        raw_user_text: input,
        patient_view: caseView,
        patient_information_policy: buildPatientInformationPolicy(caseView),
        current_state_before: compactSessionState(sessionBefore),
        current_state_after: compactSessionState(deterministicUpdate.session),
        conversation_history: sessionBefore.messages,
        extracted_actions: deterministicUpdate.parsed.actions,
        allowed_locked_sources: [...allowedSourceIds],
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
              requested_fragment:
                "For UNKNOWN only: exact contiguous substring copied from raw_user_text; otherwise null.",
              reason_code:
                "not_authorized_finding | unrecognized_fragment | unknown_medication | not_modelled_for_variant | null",
            },
          ],
          retrieval_sources_used: [],
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

function addressedUnknownText(reasonCode, fragment) {
  if (reasonCode === "unknown_medication") {
    return `Не распознано лекарство: «${fragment}». Уточни название и назначение; действие не применено.`;
  }
  if (["not_authorized_finding", "not_modelled_for_variant"].includes(reasonCode)) {
    return `«${fragment}»: результат пока не смоделирован для этого варианта кейса.`;
  }
  return `Не распознано: «${fragment}». Уточни, что именно назначаешь.`;
}

function validateAndMaterializePart(
  caseData,
  part,
  revealedFindingIds,
  allowedSourceIds,
  rawUserText
) {
  if (!isAuthorizedInformationSource(caseData, part, revealedFindingIds, allowedSourceIds)) {
    return { part: null, suppressReason: "unauthorized_information_source" };
  }

  if (part.classification === PATIENT_INFORMATION_CLASS.UNKNOWN) {
    const fragment = String(part.requested_fragment || "").trim();
    const reasonCode = String(part.reason_code || "").trim();
    if (!fragment || !String(rawUserText || "").includes(fragment)) {
      return { part: null, suppressReason: "unknown_without_exact_requested_fragment" };
    }
    if (![
      "not_authorized_finding",
      "unrecognized_fragment",
      "unknown_medication",
      "not_modelled_for_variant",
    ].includes(reasonCode)) {
      return { part: null, suppressReason: "unknown_without_reason_code" };
    }
    return {
      part: {
        text: addressedUnknownText(reasonCode, fragment),
        findingId: null,
        source: {
          classification: part.classification,
          source_id: null,
          requested_fragment: fragment,
          reason_code: reasonCode,
        },
      },
      suppressReason: null,
    };
  }

  if (part.classification === PATIENT_INFORMATION_CLASS.INFERABLE_FINDING) {
    const authored = (caseData.inferable_findings || []).find((finding) => finding.id === part.source_id);
    const text = String(part.exact_text || authored?.text || "").trim();
    if (!text || PREMATURE_TEACHING_RE.test(text)) {
      return { part: null, suppressReason: "invalid_inferable_finding" };
    }
    return { part: {
      text,
      findingId: null,
      source: { classification: part.classification, source_id: part.source_id },
    }, suppressReason: null };
  }

  if (part.source_id === "initial_presentation") {
    const exactText = String(part.exact_text || "").trim();
    if (!exactText || !caseData.initial_presentation.text.includes(exactText)) {
      return { part: null, suppressReason: "initial_presentation_text_not_exact" };
    }
    return { part: {
      text: exactText,
      findingId: null,
      source: { classification: part.classification, source_id: part.source_id },
    }, suppressReason: null };
  }

  const text = formatFinding(caseData, part.source_id);
  if (!text) return { part: null, suppressReason: "authored_finding_missing" };
  return { part: {
    text,
    findingId: sourceFindingId(part.source_id),
    source: { classification: part.classification, source_id: part.source_id },
  }, suppressReason: null };
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

function materializeEnvelope(caseData, envelope, deterministicUpdate, sessionBefore) {
  const allowedSourceIds = allowedSourceIdsForTurn(
    sessionBefore.revealedFindings || [],
    deterministicUpdate.findingsRevealed || []
  );
  const revealed = [
    ...new Set([
      ...(deterministicUpdate.session.revealedFindings || []),
      ...(deterministicUpdate.findingsRevealed || []),
    ]),
  ];
  const materialized = requiredFindingParts(caseData, deterministicUpdate);
  const partKey = (part) =>
    part.source.source_id || `${part.source.classification}:${part.source.requested_fragment || ""}`;
  const seenSources = new Set(materialized.map(partKey));
  const responseParts = [];
  const suppressedResponseParts = [];

  for (const rawPart of envelope.response_parts || []) {
    const validation = validateAndMaterializePart(
      caseData,
      rawPart,
      revealed,
      allowedSourceIds,
      deterministicUpdate.rawUserText
    );
    const part = validation.part;
    if (!part) {
      suppressedResponseParts.push({
        ...rawPart,
        suppress_reason: validation.suppressReason || "invalid_part",
      });
      continue;
    }
    const key = partKey(part);
    if (seenSources.has(key)) {
      suppressedResponseParts.push({ ...rawPart, suppress_reason: "duplicate_part" });
      continue;
    }
    materialized.push(part);
    seenSources.add(key);
    responseParts.push({ ...part.source, suppress_reason: null });
  }

  const body = [...new Set(materialized.map((part) => part.text).filter(Boolean))];
  const reply = [...body, deterministicUpdate.neutralPrompt].join("\n\n");
  if (PREMATURE_TEACHING_RE.test(reply)) throw new Error("Simulator response contained premature teaching.");

  return {
    reply,
    informationUsed: materialized.map((part) => part.source),
    additionalFindingIds: materialized
      .map((part) => part.findingId)
      .filter(
        (findingId) =>
          findingId && !deterministicUpdate.session.revealedFindings.includes(findingId)
      ),
    // No retrieval corpus is provided to the simulator. A model cannot claim
    // provenance for sources it was never allowed to read.
    retrievalSourcesUsed: [],
    responseParts,
    suppressedResponseParts,
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
    responseParts: [],
    suppressedResponseParts: [],
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
      context.deterministicUpdate,
      context.sessionBefore
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
