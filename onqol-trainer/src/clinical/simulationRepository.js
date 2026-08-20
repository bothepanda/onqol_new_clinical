import { createUuid } from "./ids.js";
import { scrubSensitiveText } from "./privacy.js";

export const SIMULATION_EVENT_TYPES = Object.freeze([
  "case_started",
  "user_message",
  "action_extracted",
  "finding_revealed",
  "diagnosis_proposed",
  "management_action",
  "state_transition",
  "critical_error",
  "case_completed",
  "case_abandoned",
  "parser_failure",
  "system_error",
]);

const STORAGE_KEYS = Object.freeze({
  anonymousUserId: "onqol_anonymous_user_id",
  sessions: "onqol_simulation_sessions_v1",
  eventAnalytics: "onqol_simulation_event_analytics_v1",
  eventRawText: "onqol_simulation_event_raw_text_v1",
  // Full engine-session snapshots, for resuming and for exporting a run.
  // Previously the trainer component wrote these to its own localStorage key,
  // which meant two persistence paths and no seam to put a server behind.
  sessionSnapshots: "onqol_simulation_session_snapshots_v1",
});

export const LOCAL_SESSION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const IMMUTABLE_SESSION_FIELDS = Object.freeze([
  "session_id",
  "session_code",
  "anonymous_user_id",
  "case_id",
  "case_version",
  "disease_card_id",
  "disease_card_version",
  "scoring_rubric_version",
  "router_version",
  "case_content_hash",
  "scoring_rubric_hash",
  "locale",
  "resource_context",
  "started_at",
]);

/**
 * Events whose session is unknown. Nothing writes here in normal operation; the
 * bucket exists so a malformed record cannot silently join another session's log.
 */
const UNATTRIBUTED_EVENTS_KEY = "unattributed";

/**
 * Analytics events, grouped by session.
 *
 * They used to live in one flat array per browser. Every record carried its own
 * `session_id`, so the data was separable - but two residents sharing a machine,
 * or one resident with two tabs open, wrote into one growing list, and any
 * export that forgot to filter carried both. Grouping makes the separation
 * structural instead of a filter the caller has to remember.
 *
 * The array shape is still read, so a browser holding events from before this
 * change keeps them.
 */
function readEventsBySession(storage) {
  const stored = readJson(storage, STORAGE_KEYS.eventAnalytics, {});
  if (!Array.isArray(stored)) return stored && typeof stored === "object" ? stored : {};
  const grouped = {};
  for (const event of stored) {
    const key = event?.session_id || UNATTRIBUTED_EVENTS_KEY;
    grouped[key] = [...(grouped[key] || []), event];
  }
  return grouped;
}

function readJson(storage, key, fallback) {
  try {
    const value = storage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function withoutVerbatim(value) {
  if (Array.isArray(value)) return value.map(withoutVerbatim);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(?:^raw_|_verbatim$|^quote$|learner_text|reasoning_delta)/i.test(key))
      .map(([key, entry]) => [key, withoutVerbatim(entry)])
  );
}

function privacySafeSessionSnapshot(session, savedAt, retentionMs) {
  return {
    ...withoutVerbatim(session),
    // Current-tab transcript is intentionally not a persistence format. It may
    // contain pasted patient data or a mentor echo of learner wording.
    messages: [],
    turnPlans: [],
    eventLog: (session.eventLog || []).map((entry) => withoutVerbatim(entry)),
    persistence_policy: "raw_text_off",
    saved_at: new Date(savedAt).toISOString(),
    expires_at: new Date(savedAt + retentionMs).toISOString(),
  };
}

export function getOrCreateAnonymousUserId(storage = globalThis.localStorage, options = {}) {
  const now = options.now?.() ?? Date.now();
  const retentionMs = options.retentionMs || LOCAL_SESSION_RETENTION_MS;
  const existing = storage.getItem(STORAGE_KEYS.anonymousUserId);
  if (existing) {
    try {
      const record = JSON.parse(existing);
      if (record?.id && Date.parse(record.expires_at || 0) > now) return record.id;
    } catch {
      // Legacy string ids are rotated once into an expiring record.
    }
  }
  const anonymousUserId = createUuid();
  storage.setItem(
    STORAGE_KEYS.anonymousUserId,
    JSON.stringify({
      id: anonymousUserId,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + retentionMs).toISOString(),
    })
  );
  return anonymousUserId;
}

export class SimulationRepository {
  createSession() {
    throw new Error("SimulationRepository.createSession() is not implemented.");
  }

  appendEvent() {
    throw new Error("SimulationRepository.appendEvent() is not implemented.");
  }

  updateSession() {
    throw new Error("SimulationRepository.updateSession() is not implemented.");
  }

  completeSession() {
    throw new Error("SimulationRepository.completeSession() is not implemented.");
  }

  /**
   * Store a full engine session.
   *
   * The seam a server-backed implementation would replace. It exists so the
   * trainer component never touches storage itself; today the only
   * implementation is local, and nothing about this makes the pilot's logging
   * centralised or multi-user.
   */
  saveSession() {
    throw new Error("SimulationRepository.saveSession() is not implemented.");
  }

  exportSession() {
    throw new Error("SimulationRepository.exportSession() is not implemented.");
  }

  deleteSession() {
    throw new Error("SimulationRepository.deleteSession() is not implemented.");
  }
}

export class BrowserSimulationRepository extends SimulationRepository {
  constructor(storage = globalThis.localStorage, options = {}) {
    super();
    this.storage = storage;
    this.persistRawText = options.persistRawText === true;
    this.retentionMs = options.retentionMs || LOCAL_SESSION_RETENTION_MS;
    this.now = options.now || Date.now;
    this.purgeExpired();
  }

  purgeExpired() {
    const now = this.now();
    const sessions = readJson(this.storage, STORAGE_KEYS.sessions, {});
    const snapshots = readJson(this.storage, STORAGE_KEYS.sessionSnapshots, {});
    const analytics = readEventsBySession(this.storage);
    const rawTextByEvent = readJson(this.storage, STORAGE_KEYS.eventRawText, {});
    const expiredIds = new Set();
    for (const [sessionId, record] of Object.entries(sessions)) {
      if (Date.parse(record.local_expires_at || 0) <= now) expiredIds.add(sessionId);
    }
    for (const [sessionId, snapshot] of Object.entries(snapshots)) {
      if (Date.parse(snapshot.expires_at || 0) <= now) expiredIds.add(sessionId);
    }
    let expiredEventCount = 0;
    for (const [sessionId, events] of Object.entries(analytics)) {
      const active = events.filter((event) => {
        const explicitExpiry = Date.parse(event.local_expires_at || 0);
        const timestamp = Date.parse(event.timestamp || 0);
        const expiry = Number.isFinite(explicitExpiry) && explicitExpiry > 0
          ? explicitExpiry
          : timestamp + this.retentionMs;
        const keep = Number.isFinite(expiry) && expiry > now;
        if (!keep) {
          expiredEventCount += 1;
          delete rawTextByEvent[event.event_id];
        }
        return keep;
      });
      if (active.length) analytics[sessionId] = active;
      else delete analytics[sessionId];
    }
    if (!expiredIds.size && expiredEventCount === 0) return 0;
    for (const sessionId of expiredIds) {
      for (const event of analytics[sessionId] || []) {
        delete rawTextByEvent[event.event_id];
      }
      delete sessions[sessionId];
      delete snapshots[sessionId];
      delete analytics[sessionId];
    }
    this.storage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
    this.storage.setItem(STORAGE_KEYS.sessionSnapshots, JSON.stringify(snapshots));
    this.storage.setItem(STORAGE_KEYS.eventAnalytics, JSON.stringify(analytics));
    this.storage.setItem(STORAGE_KEYS.eventRawText, JSON.stringify(rawTextByEvent));
    return expiredIds.size + expiredEventCount;
  }

  createSession(sessionRecord) {
    const sessions = readJson(this.storage, STORAGE_KEYS.sessions, {});
    if (sessions[sessionRecord.session_id]) {
      throw new Error(`Session ${sessionRecord.session_id} already exists.`);
    }
    sessions[sessionRecord.session_id] = {
      ...sessionRecord,
      local_expires_at: new Date(this.now() + this.retentionMs).toISOString(),
    };
    this.storage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
    return sessions[sessionRecord.session_id];
  }

  appendEvent(eventRecord) {
    if (!SIMULATION_EVENT_TYPES.includes(eventRecord.event_type)) {
      throw new Error(`Unknown simulation event type: ${eventRecord.event_type}`);
    }

    const eventId = eventRecord.event_id || createUuid();
    const normalized = {
      event_id: eventId,
      session_id: eventRecord.session_id,
      timestamp: eventRecord.timestamp || new Date().toISOString(),
      event_type: eventRecord.event_type,
      parsed_actions: eventRecord.parsed_actions || [],
      simulator_state_before: eventRecord.simulator_state_before || null,
      simulator_state_after: eventRecord.simulator_state_after || null,
      findings_revealed: eventRecord.findings_revealed || [],
      scoring_events: eventRecord.scoring_events || [],
      parser_confidence: eventRecord.parser_confidence ?? null,
      retrieval_sources_used: eventRecord.retrieval_sources_used || [],
      model_info: eventRecord.model_info || null,
      latency_ms: eventRecord.latency_ms ?? null,
      error_code: eventRecord.error_code || null,
      local_expires_at: new Date(this.now() + this.retentionMs).toISOString(),
    };
    const analytics = readEventsBySession(this.storage);
    const sessionId = normalized.session_id || UNATTRIBUTED_EVENTS_KEY;
    analytics[sessionId] = [...(analytics[sessionId] || []), normalized];
    this.storage.setItem(STORAGE_KEYS.eventAnalytics, JSON.stringify(analytics));

    if (
      this.persistRawText &&
      eventRecord.raw_user_text !== undefined &&
      eventRecord.raw_user_text !== null
    ) {
      const rawTextByEvent = readJson(this.storage, STORAGE_KEYS.eventRawText, {});
      rawTextByEvent[eventId] = scrubSensitiveText(eventRecord.raw_user_text);
      this.storage.setItem(STORAGE_KEYS.eventRawText, JSON.stringify(rawTextByEvent));
    }

    return {
      ...normalized,
      raw_user_text:
        !this.persistRawText ||
        eventRecord.raw_user_text === undefined ||
        eventRecord.raw_user_text === null
          ? null
          : scrubSensitiveText(eventRecord.raw_user_text),
    };
  }

  updateSession(sessionId, patch) {
    const sessions = readJson(this.storage, STORAGE_KEYS.sessions, {});
    const current = sessions[sessionId];
    if (!current) throw new Error(`Session ${sessionId} does not exist.`);

    for (const field of IMMUTABLE_SESSION_FIELDS) {
      if (Object.hasOwn(patch, field) && !equalJson(patch[field], current[field])) {
        throw new Error(`Immutable session field cannot be changed: ${field}`);
      }
    }

    sessions[sessionId] = { ...current, ...patch };
    this.storage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
    return sessions[sessionId];
  }

  completeSession(sessionId, completion = {}) {
    return this.updateSession(sessionId, {
      completed_at: completion.completed_at || new Date().toISOString(),
      completion_status: completion.completion_status || "completed",
      overall_score: completion.overall_score ?? null,
      domain_scores: completion.domain_scores || null,
      critical_errors_count: completion.critical_errors_count ?? 0,
    });
  }

  listSessions() {
    return Object.values(readJson(this.storage, STORAGE_KEYS.sessions, {}));
  }

  /**
   * Events for one session, or for all of them.
   *
   * `sessionId` is the form that matters for a pilot: an export handed to a
   * reviewer must carry one participant's run and nothing else. The unfiltered
   * form remains for local research export, where the caller has already
   * decided it wants everything on this machine.
   */
  listEvents({ includeRawText = false, sessionId = null } = {}) {
    const analytics = readEventsBySession(this.storage);
    const events = sessionId
      ? [...(analytics[sessionId] || [])]
      : Object.values(analytics).flat();
    if (!includeRawText) return events;
    const rawTextByEvent = readJson(this.storage, STORAGE_KEYS.eventRawText, {});
    return events.map((event) => ({
      ...event,
      raw_user_text: rawTextByEvent[event.event_id] ?? null,
    }));
  }

  deleteRawEventText(eventId) {
    const rawTextByEvent = readJson(this.storage, STORAGE_KEYS.eventRawText, {});
    delete rawTextByEvent[eventId];
    this.storage.setItem(STORAGE_KEYS.eventRawText, JSON.stringify(rawTextByEvent));
  }

  saveSession(session) {
    const snapshots = readJson(this.storage, STORAGE_KEYS.sessionSnapshots, {});
    const now = this.now();
    for (const [sessionId, snapshot] of Object.entries(snapshots)) {
      if (Date.parse(snapshot.expires_at || 0) <= now) delete snapshots[sessionId];
    }
    const persisted = privacySafeSessionSnapshot(session, now, this.retentionMs);
    snapshots[session.session_id] = persisted;
    this.storage.setItem(STORAGE_KEYS.sessionSnapshots, JSON.stringify(snapshots));
    return persisted;
  }

  exportSession(sessionId) {
    const snapshots = readJson(this.storage, STORAGE_KEYS.sessionSnapshots, {});
    const snapshot = snapshots[sessionId];
    if (!snapshot) return null;
    if (Date.parse(snapshot.expires_at || 0) <= this.now()) {
      delete snapshots[sessionId];
      this.storage.setItem(STORAGE_KEYS.sessionSnapshots, JSON.stringify(snapshots));
      return null;
    }
    return snapshot;
  }

  deleteSession(sessionId) {
    const sessions = readJson(this.storage, STORAGE_KEYS.sessions, {});
    const snapshots = readJson(this.storage, STORAGE_KEYS.sessionSnapshots, {});
    const analytics = readEventsBySession(this.storage);
    const rawTextByEvent = readJson(this.storage, STORAGE_KEYS.eventRawText, {});
    const removedEventIds = (analytics[sessionId] || []).map((entry) => entry.event_id);
    delete sessions[sessionId];
    delete snapshots[sessionId];
    for (const eventId of removedEventIds) delete rawTextByEvent[eventId];
    this.storage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
    this.storage.setItem(STORAGE_KEYS.sessionSnapshots, JSON.stringify(snapshots));
    delete analytics[sessionId];
    this.storage.setItem(STORAGE_KEYS.eventAnalytics, JSON.stringify(analytics));
    this.storage.setItem(STORAGE_KEYS.eventRawText, JSON.stringify(rawTextByEvent));
    return true;
  }

  exportResearchData({ includeRawText = false } = {}) {
    return {
      export_schema_version: "1.0.0",
      exported_at: new Date().toISOString(),
      sessions: this.listSessions(),
      events: this.listEvents({ includeRawText }),
    };
  }
}

export function createSimulationRepository(options = {}) {
  return new BrowserSimulationRepository(options.storage || globalThis.localStorage, options);
}
