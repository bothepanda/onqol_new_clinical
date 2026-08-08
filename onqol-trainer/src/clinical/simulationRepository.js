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
});

const IMMUTABLE_SESSION_FIELDS = Object.freeze([
  "session_id",
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

export function getOrCreateAnonymousUserId(storage = globalThis.localStorage) {
  const existing = storage.getItem(STORAGE_KEYS.anonymousUserId);
  if (existing) return existing;
  const anonymousUserId = createUuid();
  storage.setItem(STORAGE_KEYS.anonymousUserId, anonymousUserId);
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
}

export class BrowserSimulationRepository extends SimulationRepository {
  constructor(storage = globalThis.localStorage) {
    super();
    this.storage = storage;
  }

  createSession(sessionRecord) {
    const sessions = readJson(this.storage, STORAGE_KEYS.sessions, {});
    if (sessions[sessionRecord.session_id]) {
      throw new Error(`Session ${sessionRecord.session_id} already exists.`);
    }
    sessions[sessionRecord.session_id] = { ...sessionRecord };
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
    };
    const analytics = readJson(this.storage, STORAGE_KEYS.eventAnalytics, []);
    analytics.push(normalized);
    this.storage.setItem(STORAGE_KEYS.eventAnalytics, JSON.stringify(analytics));

    if (eventRecord.raw_user_text !== undefined && eventRecord.raw_user_text !== null) {
      const rawTextByEvent = readJson(this.storage, STORAGE_KEYS.eventRawText, {});
      rawTextByEvent[eventId] = scrubSensitiveText(eventRecord.raw_user_text);
      this.storage.setItem(STORAGE_KEYS.eventRawText, JSON.stringify(rawTextByEvent));
    }

    return {
      ...normalized,
      raw_user_text:
        eventRecord.raw_user_text === undefined || eventRecord.raw_user_text === null
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

  listEvents({ includeRawText = false } = {}) {
    const analytics = readJson(this.storage, STORAGE_KEYS.eventAnalytics, []);
    if (!includeRawText) return analytics;
    const rawTextByEvent = readJson(this.storage, STORAGE_KEYS.eventRawText, {});
    return analytics.map((event) => ({
      ...event,
      raw_user_text: rawTextByEvent[event.event_id] ?? null,
    }));
  }

  deleteRawEventText(eventId) {
    const rawTextByEvent = readJson(this.storage, STORAGE_KEYS.eventRawText, {});
    delete rawTextByEvent[eventId];
    this.storage.setItem(STORAGE_KEYS.eventRawText, JSON.stringify(rawTextByEvent));
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
  return new BrowserSimulationRepository(options.storage || globalThis.localStorage);
}
