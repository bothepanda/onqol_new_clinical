/**
 * Developer diagnostics (KNOWN_GAPS §12): what the learner must never see -
 * hidden truth, the seed, the scheduler queue, active rules and the event
 * stream - gathered in one read-only snapshot for the dev panel.
 *
 * Nothing here feeds back into the session. The panel is mounted only in a
 * Vite dev build that is not a pilot build, and only when the page was opened
 * with `?diag=1` (see `diagnosticsEnabled`).
 */
export function diagnosticsEnabled({ dev, pilot, search }) {
  if (!dev || pilot) return false;
  return new URLSearchParams(search ?? "").get("diag") === "1";
}

export function buildDiagnostics(session, { recentEvents = 30 } = {}) {
  if (!session) return null;
  const { state } = session;
  const started = session.events.find((event) => event.type === "SESSION_STARTED");
  return {
    session: {
      sessionId: session.sessionId,
      seed: state.session.seed,
      casePresetId: started?.payload.casePresetId ?? null,
      mode: state.session.mode,
      purpose: state.session.purpose,
      hospitalProfileId: state.hospital.profileId,
      contentVersions: state.session.contentVersions,
      elapsedMinutes: state.clock.elapsedMinutes,
      turn: state.turn,
      status: state.session.status,
    },
    truth: state.truth,
    physiology: state.physiology,
    symptoms: state.symptoms,
    location: state.location,
    pending: (state.pending ?? []).map((item) => ({ id: item.id, kind: item.kind, dueAtMinutes: item.dueAtMinutes })),
    dynamicConstraints: (state.hospital.dynamicConstraints ?? []).map((item) => ({
      id: item.id, active: item.active, resolvesAtMinutes: item.resolvesAtMinutes ?? null, resolvedAtMinutes: item.resolvedAtMinutes ?? null,
    })),
    simulatorLimitations: state.simulatorLimitations,
    mentor: state.mentor,
    events: session.events.slice(-recentEvents).map((event) => ({
      seq: event.seq, atMinutes: event.atMinutes, type: event.type, source: event.cause?.source ?? null, commandId: event.cause?.commandId ?? null,
    })),
  };
}
