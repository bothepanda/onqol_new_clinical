import { createUuid } from "./ids.js";

export function snapshotSimulatorState(session) {
  if (!session) return null;
  return {
    phase: session.phase,
    completed_actions: [...(session.completedActions || [])],
    unsafe_actions: [...(session.unsafeActions || [])],
    unnecessary_actions: [...(session.unnecessaryActions || [])],
    revealed_findings: [...(session.revealedFindings || [])],
    applied_transitions: [...(session.appliedTransitions || [])],
    completion_status: session.completion_status,
  };
}

export function createSimulationEvent(eventType, sessionId, fields = {}) {
  return {
    event_id: createUuid(),
    session_id: sessionId,
    timestamp: fields.timestamp || new Date().toISOString(),
    event_type: eventType,
    raw_user_text: fields.raw_user_text ?? null,
    parsed_actions: fields.parsed_actions || [],
    simulator_state_before: fields.simulator_state_before || null,
    simulator_state_after: fields.simulator_state_after || null,
    findings_revealed: fields.findings_revealed || [],
    scoring_events: fields.scoring_events || [],
    parser_confidence: fields.parser_confidence ?? null,
    retrieval_sources_used: fields.retrieval_sources_used || [],
    model_info: fields.model_info || null,
    latency_ms: fields.latency_ms ?? null,
    error_code: fields.error_code || null,
  };
}

export function buildSessionRecord(session) {
  return {
    session_id: session.session_id,
    anonymous_user_id: session.anonymous_user_id,
    case_id: session.case_id,
    case_version: session.case_version,
    disease_card_id: session.disease_card_id,
    disease_card_version: session.disease_card_version,
    scoring_rubric_version: session.scoring_rubric_version,
    router_version: session.router_version,
    case_content_hash: session.case_content_hash,
    scoring_rubric_hash: session.scoring_rubric_hash,
    started_at: session.started_at,
    completed_at: session.completed_at,
    locale: session.locale,
    difficulty: session.difficulty,
    resource_context: session.resource_context,
    selection_method: session.selection_method,
    overall_score: null,
    domain_scores: null,
    critical_errors_count: 0,
    completion_status: session.completion_status,
  };
}

function sharedTurnFields(sessionBefore, result, modelInfo) {
  return {
    parsed_actions: result.parsed.actions,
    simulator_state_before: snapshotSimulatorState(sessionBefore),
    simulator_state_after: snapshotSimulatorState(result.session),
    findings_revealed: result.findingsRevealed,
    scoring_events: result.scoringEvents,
    parser_confidence: result.parsed.parserConfidence ?? null,
    retrieval_sources_used: result.simulator?.retrievalSourcesUsed || [],
    model_info: modelInfo,
    latency_ms: result.latencyMs ?? null,
    error_code: result.simulator?.errorCode || null,
  };
}

export function buildTurnEvents(sessionBefore, result, rawUserText, modelInfo = null) {
  const fields = sharedTurnFields(sessionBefore, result, modelInfo);
  const events = [
    createSimulationEvent("user_message", sessionBefore.session_id, {
      ...fields,
      raw_user_text: rawUserText,
    }),
    createSimulationEvent("action_extracted", sessionBefore.session_id, fields),
  ];
  const diagnosisActions = result.parsed.actions.filter((action) => action.intent_type === "diagnosis");
  const managementActions = result.parsed.actions.filter(
    (action) => action.intent_type === "management" && action.id !== "end_case"
  );
  const criticalErrors = result.scoringEvents.filter(
    (event) => event.action_kind === "unsafe" && event.critical && event.eligible_for_scoring
  );

  if (diagnosisActions.length > 0) {
    events.push(
      createSimulationEvent("diagnosis_proposed", sessionBefore.session_id, {
        ...fields,
        parsed_actions: diagnosisActions,
      })
    );
  }
  if (managementActions.length > 0) {
    events.push(
      createSimulationEvent("management_action", sessionBefore.session_id, {
        ...fields,
        parsed_actions: managementActions,
      })
    );
  }
  if (result.findingsRevealed.length > 0) {
    events.push(createSimulationEvent("finding_revealed", sessionBefore.session_id, fields));
  }
  if (result.stateTransitions.length > 0) {
    events.push(createSimulationEvent("state_transition", sessionBefore.session_id, fields));
  }
  if (criticalErrors.length > 0) {
    events.push(
      createSimulationEvent("critical_error", sessionBefore.session_id, {
        ...fields,
        scoring_events: criticalErrors,
      })
    );
  }
  if (result.session.finished) {
    events.push(createSimulationEvent("case_completed", sessionBefore.session_id, fields));
  }

  return events;
}

