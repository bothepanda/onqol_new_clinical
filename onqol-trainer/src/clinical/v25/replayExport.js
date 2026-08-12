import { scrubSensitiveText } from "../privacy.js";

export const V25_REPLAY_EXPORT_SCHEMA_VERSION = "3.5.0";

function redactMessages(messages) {
  return (messages || []).map((message) => ({
    role: message.role,
    content: scrubSensitiveText(message.content || ""),
  }));
}

function withoutLearnerVerbatim(value) {
  if (Array.isArray(value)) return value.map(withoutLearnerVerbatim);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/(?:^raw_|_verbatim$|^quote$|learner_text|reasoning_delta)/i.test(key)
      )
      .map(([key, entry]) => [key, withoutLearnerVerbatim(entry)])
  );
}

/**
 * Build a self-contained audit/replay package without exporting unredacted
 * learner text. The deterministic replay inputs are the frozen case composition,
 * the full scenario and the ordered engine events/actions.
 */
export function buildV25ReplayExport(session, exportedAt = new Date().toISOString()) {
  if (!session?.session_id) throw new Error("A persisted session is required for replay export.");

  const composition = session.v35_composition || null;
  return {
    export_schema_version: V25_REPLAY_EXPORT_SCHEMA_VERSION,
    exported_at: exportedAt,
    data_policy: {
      raw_learner_text_included: false,
      transcript_redacted: true,
    },
    replay: {
      engine_version: session.engine_version || null,
      product_version: session.product_version || null,
      content_version: session.content_version || null,
      case_preset_id: composition?.case_preset_id || null,
      selection_method: composition?.selection_method || null,
      requested_seed: composition?.requested_seed || session.scenario?.seed || null,
      effective_seed: composition?.effective_seed || session.scenario?.seed || null,
      selection_attempts: composition?.selection_attempts || [],
    },
    session: {
      session_id: session.session_id,
      institution_id: session.institution_id,
      cohort_id: session.cohort_id,
      learner_id: session.learner_id,
      locale: session.locale,
      case_id: session.case_id,
      case_version: session.case_version,
      disease_card_id: session.disease_card_id,
      disease_card_version: session.disease_card_version,
      rubric_version: session.scoring_rubric_version,
      router_version: session.router_version,
      started_at: session.started_at,
      completed_at: session.completed_at,
      terminal_status: session.terminal_status || session.completion_status || "in_progress",
      completion_status: session.completion_status || session.terminal_status || "in_progress",
      scenario: session.scenario,
      v35_composition: composition,
    },
    state_snapshot: {
      phase: session.phase,
      path_state: session.pathState || null,
      completed_actions: session.completedActions || [],
      unsafe_actions: session.unsafeActions || [],
      unnecessary_actions: session.unnecessaryActions || [],
      revealed_findings: session.revealedFindings || [],
      prerequisite_warnings: session.prerequisiteWarnings || [],
      working_memory: withoutLearnerVerbatim(session.workingMemory || null),
      temporal_state: session.temporalState || null,
      resource_queue: session.resourceQueue || {},
    },
    transcript: redactMessages(session.messages),
    events: withoutLearnerVerbatim(session.eventLog || []),
    action_log: session.actionLog || [],
    scoring: session.scoring || null,
    report: session.report || null,
  };
}
