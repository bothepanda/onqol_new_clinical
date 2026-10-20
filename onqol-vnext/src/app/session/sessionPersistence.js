import { createSession } from "../../core/session/createSession.js";
import { submitLearnerTurn } from "../../core/session/submitLearnerTurn.js";

export const SESSION_STORAGE_KEY = "onqol.session.v1";
export const SESSION_PERSISTENCE_VERSION = 1;

/**
 * One saved session per case. The default case keeps the original key, so a
 * session saved before cases were selectable is still offered for resume.
 */
export function caseStorageKey(casePresetId, defaultCaseId = "APP-004") {
  return casePresetId === defaultCaseId ? SESSION_STORAGE_KEY : `${SESSION_STORAGE_KEY}.${casePresetId}`;
}

export function createPersistedSession({ session, messages }) {
  return {
    schemaVersion: SESSION_PERSISTENCE_VERSION,
    runtimeRevision: "governed-variability-v2",
    savedAt: new Date().toISOString(),
    start: {
      sessionId: session.sessionId,
      seed: session.state.session.seed,
      mode: session.state.session.mode,
      realProfileId: session.state.session.mode === "real" ? session.state.hospital.profileId : undefined,
      casePresetId: session.events.find((event) => event.type === "SESSION_STARTED")?.payload.casePresetId,
      sessionPurpose: session.state.session.purpose,
      ...(session.state.session.clinicalContentPolicy ? { clinicalContentPolicy: session.state.session.clinicalContentPolicy } : {}),
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
    mentorDialogue: session.mentorDialogue ?? [],
    patientDialogue: session.patientDialogue ?? [],
    completed: session.state.session.status === "complete",
  };
}

export function savePersistedSession(storage, value, key = SESSION_STORAGE_KEY) {
  if (!storage) return false;
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function clearPersistedSession(storage, key = SESSION_STORAGE_KEY) {
  try { storage?.removeItem(key); return true; } catch { return false; }
}

export function loadPersistedSession(storage, bundle, key = SESSION_STORAGE_KEY) {
  if (!storage) return null;
  try {
    const value = JSON.parse(storage.getItem(key));
    if (!value || value.schemaVersion !== SESSION_PERSISTENCE_VERSION || !validStart(value.start)) return null;
    const currentVersions = { [bundle.disease.disease_id]: bundle.__contentVersion ?? "unversioned" };
    if (JSON.stringify(value.start.contentVersions) !== JSON.stringify(currentVersions)) return null;
    if (!Array.isArray(value.learnerTurns) || !Array.isArray(value.expectedEvents) || !Array.isArray(value.messages)) return null;

    let session = createSession({ ...value.start, bundle });
    const recordedTurns = value.expectedEvents.filter((event) => event.type === "LEARNER_TURN_RECEIVED");
    if (recordedTurns.length !== value.learnerTurns.length) return null;
    for (const [index, text] of value.learnerTurns.entries()) {
      if (typeof text !== "string") return null;
      const payload = recordedTurns[index].payload;
      if (payload?.rawText !== text) return null;
      const interpreted = payload.recordedInterpretation;
      if (interpreted !== undefined && (!interpreted || !Array.isArray(interpreted.commands) || typeof interpreted.intent !== "string")) return null;
      // Clinical code re-executes the recorded interpretation and must produce
      // the identical causal log. Older deterministic artifacts without this
      // field still use the current deterministic parser and fail closed on a
      // causal-log mismatch; no provider call occurs during restore.
      session = submitLearnerTurn({ session, text, interpreted }).session;
    }
    // Never partially restore clinical truth. The reconstructed causal log
    // must byte-match what was stored, otherwise the artifact is discarded.
    if (JSON.stringify(session.events) !== JSON.stringify(value.expectedEvents)) {
      if (sameExceptAddedInterpretation(session.events, value.expectedEvents)) {
        // Previous deterministic turns did not store the full interpretation.
        // Their clinical log must still match exactly after current parsing.
        session = { ...session, persistenceMigration: "additive_recorded_interpretation" };
      } else {
        if (value.runtimeRevision || !sameLegacyClinicalEvents(session.events, value.expectedEvents)) return null;
        // Pre-V2 artifacts may differ only by additive calibration audit.
        session = { ...session, persistenceMigration: "additive_calibration_audit" };
      }
    }
    if (value.mentorDialogue !== undefined && !Array.isArray(value.mentorDialogue)) return null;
    if (value.mentorDialogue?.length) session = { ...session, mentorDialogue: value.mentorDialogue };
    if (value.patientDialogue !== undefined && !Array.isArray(value.patientDialogue)) return null;
    if (value.patientDialogue?.length) session = { ...session, patientDialogue: value.patientDialogue };
    return { session, messages: value.messages, completed: value.completed === true };
  } catch {
    return null;
  }
}

function sameExceptAddedInterpretation(current, historical) {
  if (current.length !== historical.length) return false;
  const withoutNewField = current.map((event, index) => {
    const copy = structuredClone(event);
    if (copy.type === "LEARNER_TURN_RECEIVED" && historical[index]?.payload?.recordedInterpretation === undefined) {
      delete copy.payload.recordedInterpretation;
    }
    return copy;
  });
  return JSON.stringify(withoutNewField) === JSON.stringify(historical);
}

function validStart(start) {
  return Boolean(
    start && typeof start.sessionId === "string" && typeof start.seed === "string" &&
      ["reference", "real"].includes(start.mode) && typeof start.casePresetId === "string" &&
      typeof start.sessionPurpose === "string" && typeof start.locale === "string" &&
      typeof start.startIso === "string" && start.contentVersions && typeof start.contentVersions === "object",
  );
}

function sameLegacyClinicalEvents(current, historical) {
  const strip = (events) => events.map((event) => {
    const copy = structuredClone(event);
    delete copy.payload.calibration;
    if (copy.type === "LEARNER_TURN_RECEIVED") delete copy.payload.recordedInterpretation;
    for (const item of copy.payload.scheduledPending ?? []) {
      delete item.calibration;
      if (item.specs?.length === 0) delete item.specs;
      if (item.dependencies?.length === 0) delete item.dependencies;
    }
    return copy;
  });
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  // Historical artifacts containing a calibration audit are not legacy and
  // cannot evade validation by omitting the revision field.
  if (historical.some((event) => event.payload?.calibration || event.payload?.scheduledPending?.some((item) => item.calibration))) return false;
  return JSON.stringify(canonical(strip(current))) === JSON.stringify(canonical(historical));
}
