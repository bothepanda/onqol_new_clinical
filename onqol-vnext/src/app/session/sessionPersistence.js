import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";

export const SESSION_STORAGE_KEY = "onqol.session.v1";
export const SESSION_PERSISTENCE_VERSION = 1;

export function createPersistedSession({ session, messages }) {
  return {
    schemaVersion: SESSION_PERSISTENCE_VERSION,
    savedAt: new Date().toISOString(),
    start: {
      sessionId: session.sessionId,
      seed: session.state.session.seed,
      mode: session.state.session.mode,
      realProfileId: session.state.session.mode === "real" ? session.state.hospital.profileId : undefined,
      casePresetId: session.events.find((event) => event.type === "SESSION_STARTED")?.payload.casePresetId,
      sessionPurpose: session.state.session.purpose,
      interactionFlags: session.state.session.interactionFlags,
      locale: session.state.session.locale,
      startIso: session.clockRoot.startIso,
      contentVersions: session.state.session.contentVersions,
    },
    learnerTurns: session.events
      .filter((event) => event.type === "LEARNER_TURN_RECEIVED")
      .map((event) => event.payload.rawText),
    expectedEvents: session.events,
    messages,
    completed: session.state.session.status === "complete",
  };
}

export function savePersistedSession(storage, value) {
  if (!storage) return;
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
}

export function clearPersistedSession(storage) {
  storage?.removeItem(SESSION_STORAGE_KEY);
}

export function loadPersistedSession(storage, bundle) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(SESSION_STORAGE_KEY));
    if (!value || value.schemaVersion !== SESSION_PERSISTENCE_VERSION || !validStart(value.start)) return null;
    const currentVersions = { [bundle.disease.disease_id]: bundle.__contentVersion ?? "unversioned" };
    if (JSON.stringify(value.start.contentVersions) !== JSON.stringify(currentVersions)) return null;
    if (!Array.isArray(value.learnerTurns) || !Array.isArray(value.expectedEvents) || !Array.isArray(value.messages)) return null;

    let session = createSession({ ...value.start, bundle });
    for (const text of value.learnerTurns) {
      if (typeof text !== "string") return null;
      session = submitLearnerTurn({ session, text }).session;
    }
    // Never partially restore clinical truth. The reconstructed causal log
    // must byte-match what was stored, otherwise the artifact is discarded.
    if (JSON.stringify(session.events) !== JSON.stringify(value.expectedEvents)) return null;
    return { session, messages: value.messages, completed: value.completed === true };
  } catch {
    return null;
  }
}

function validStart(start) {
  return Boolean(
    start && typeof start.sessionId === "string" && typeof start.seed === "string" &&
      ["reference", "real"].includes(start.mode) && typeof start.casePresetId === "string" &&
      typeof start.sessionPurpose === "string" && typeof start.locale === "string" &&
      typeof start.startIso === "string" && start.contentVersions && typeof start.contentVersions === "object",
  );
}
