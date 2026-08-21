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
 * Per-turn mentor decision record, for the A/B harness and the pilot review.
 *
 * `regex_policy_shadow` is the pre-v2 deterministic policy's answer, kept
 * alongside the model's so the two can be compared turn by turn rather than
 * argued about. `rejection_reasons` has one entry per rejected attempt, so a
 * turn that was repaired successfully still shows what it was repaired from.
 */
export function buildMentorTelemetry(session) {
  const profiles = (session?.eventLog || []).filter(
    (entry) => entry.event_type === "execution_profile"
  );
  const turns = profiles.map((entry) => ({
    turn_number: entry.turn_number,
    mentor_source: entry.mentor_source || (entry.mentor_execution === "model" ? "llm" : entry.mentor_execution),
    mentor_mode: entry.mentor_mode || null,
    mentor_issue_id: entry.mentor_issue_id || null,
    rejection_reasons: entry.mentor_rejection_reasons || [],
    repair_attempted: Boolean(entry.repair_attempted),
    telemetry_flags: entry.mentor_telemetry_flags || [],
    regex_policy_shadow: entry.regex_policy_shadow || null,
    learner_address_form: entry.learner_address_form || null,
    request_telemetry: entry.request_telemetry || { router: [], simulator: [], mentor: [] },
  }));
  const spoke = turns.filter((turn) => turn.mentor_source !== "not_invoked");
  const rejections = {};
  for (const reason of turns.flatMap((turn) => turn.rejection_reasons)) {
    rejections[reason] = (rejections[reason] || 0) + 1;
  }
  return {
    turns,
    summary: {
      mentor_turns: spoke.length,
      from_model: spoke.filter((turn) => turn.mentor_source === "llm").length,
      from_template: spoke.filter((turn) => turn.mentor_source === "deterministic").length,
      // Distinct from a template since 21.08.2026: the mentor had nothing
      // usable to say and said nothing, and the engine's own prompt carried
      // the turn. See the silent fallback in core/mentorAgent.js.
      from_silence: spoke.filter((turn) => turn.mentor_source === "silent").length,
      repaired: spoke.filter((turn) => turn.repair_attempted).length,
      rejection_reasons: rejections,
      policy_agreement: spoke.filter((turn) => turn.regex_policy_shadow?.agreed_with_mentor).length,
      provider_requests: turns.reduce(
        (sum, turn) =>
          sum + Object.values(turn.request_telemetry || {}).flat().length,
        0
      ),
      provider_total_tokens: turns.reduce(
        (sum, turn) =>
          sum + Object.values(turn.request_telemetry || {})
            .flat()
            .reduce((turnSum, item) => turnSum + (item?.usage?.total_tokens || 0), 0),
        0
      ),
    },
  };
}

/**
 * Build a self-contained audit/replay package without exporting unredacted
 * learner text. The deterministic replay inputs are the frozen case composition,
 * the full scenario and the ordered engine events/actions.
 */
export function buildV25ReplayExport(
  session,
  exportedAt = new Date().toISOString(),
  options = {}
) {
  if (!session?.session_id) throw new Error("A persisted session is required for replay export.");

  const composition = session.v35_composition || null;
  return {
    export_schema_version: V25_REPLAY_EXPORT_SCHEMA_VERSION,
    exported_at: exportedAt,
    data_policy: {
      raw_learner_text_included: false,
      transcript_redacted: true,
      verbatim_transcript_included_after_identifier_scrubbing: true,
      automatic_redaction_is_not_anonymisation: true,
      provider_processing_disclosed_to_participant:
        session.participant_consent?.provider_processing_disclosed === true,
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
      session_code: session.session_code || null,
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
      participant_consent: session.participant_consent || null,
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
    // Additive since base rules v2: one place to read how the mentor decided
    // across the session without walking the event log by hand. Everything here
    // is derived from execution_profile events, which carry no learner text.
    mentor_telemetry: buildMentorTelemetry(session),
    transcript: redactMessages(session.messages),
    events: withoutLearnerVerbatim(session.eventLog || []),
    action_log: session.actionLog || [],
    scoring: session.scoring || null,
    report: session.report || null,
    clinical_reports: (options.clinicalReports || []).filter(
      (report) => report?.context?.session_id === session.session_id
    ),
  };
}
