/**
 * The versioned session export (Core Runtime Spec §30, Contract §61 audit
 * requirement).
 *
 * `current_state` is included for convenience, but it is never the source of
 * truth in this export - `events` is. Re-running `reduceEvents(createInitial
 * State(seed), events)` must reproduce `current_state` exactly; that equality
 * is what `replay.test.js` checks, and it is what makes this export usable
 * for audit, debrief, and disputed-session review instead of merely a
 * snapshot someone has to trust.
 */
const EXPORT_SCHEMA_VERSION = "1.0.0";

export function exportSession({ session, generatedAtIso }) {
  return {
    export_schema_version: EXPORT_SCHEMA_VERSION,
    generated_at: generatedAtIso,
    session: {
      id: session.state.session.id,
      mode: session.state.session.mode,
      locale: session.state.session.locale,
      purpose: session.state.session.purpose,
      interactionFlags: session.state.session.interactionFlags,
      status: session.state.session.status,
      endpoint: session.state.session.endpoint,
    },
    initial_patient_seed: session.state.session.seed,
    hospital_profile: {
      profileId: session.state.hospital.profileId,
      capabilities: session.state.hospital.capabilities,
    },
    content_versions: session.state.session.contentVersions,
    current_state: session.state,
    events: session.events,
    // Derived from the event log rather than tracked separately, so the two
    // cannot disagree: `LEARNER_TURN_RECEIVED` already carries the raw text
    // and the interpreter's reading of it, and the per-command trail events
    // carry what the system then did with each command (task brief P0-8).
    learner_turns: buildLearnerTurns(session.events),
    ai_telemetry: session.aiTelemetry ?? [],
  };
}

/**
 * The causal interaction trail, one entry per learner turn:
 *
 *   what did the learner say          -> rawText
 *   what did the interpreter think    -> intent, interpretedCommands
 *   what did the system execute       -> commandOutcomes[].outcome
 *   what was refused or clarified     -> same, with missing/reasonKey
 *   which rule caused that decision   -> commandOutcomes[].ruleIds
 *   what governance withheld          -> commandOutcomes[].governanceBlocked
 *   what did the mentor say and why   -> mentor
 *
 * Raw learner text is included because the export is the audit artifact the
 * governance spec's §24 requires ("what the learner wrote"). Retention and
 * privacy handling of the exported file remain governed by the project's
 * privacy/retention policy - the export is a download the learner initiates,
 * not a server-side store.
 */
function buildLearnerTurns(events) {
  const turns = [];
  let current = null;

  for (const event of events) {
    if (event.type === "LEARNER_TURN_RECEIVED") {
      current = {
        seq: event.seq,
        atMinutes: event.atMinutes,
        atIso: event.atIso,
        rawText: event.payload.rawText,
        intent: event.payload.intent,
        mentorSignal: event.payload.mentorSignal,
        unmatchedFragments: event.payload.unmatchedFragments ?? [],
        interpretedCommands: event.payload.interpretedCommands,
        commandOutcomes: [],
        mentor: null,
      };
      turns.push(current);
      continue;
    }
    if (!current) continue;

    if (["COMMAND_ACCEPTED", "COMMAND_REJECTED", "CLARIFICATION_REQUESTED"].includes(event.type)) {
      current.commandOutcomes.push({ ...event.payload, eventType: event.type });
    } else if (event.type === "MENTOR_INTERVENED") {
      current.mentor = { ...event.payload };
    }
  }

  return turns;
}

/** Reconstructs state from seed + events only, ignoring any stored snapshot. */
export function verifyReplay({ createInitialFromSeed, reduceEvents, exportBundle }) {
  const rebuilt = reduceEvents(createInitialFromSeed(exportBundle), exportBundle.events);
  return JSON.stringify(rebuilt) === JSON.stringify(exportBundle.current_state);
}
