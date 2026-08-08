import test from "node:test";
import assert from "node:assert/strict";
import { assertComparableRubricVersions, stratifySessionsForAnalytics } from "../analytics.js";
import { createInitialSession } from "../caseEngine.js";
import { acuteAppendicitisCase } from "../cases/acuteAppendicitis.js";
import { buildSessionRecord, createSimulationEvent } from "../simulationEvents.js";
import {
  BrowserSimulationRepository,
  getOrCreateAnonymousUserId,
} from "../simulationRepository.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

test("anonymous user id is random-looking and reused across sessions", () => {
  const storage = new MemoryStorage();
  const first = getOrCreateAnonymousUserId(storage);
  const second = getOrCreateAnonymousUserId(storage);

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test("session persists frozen versions and refuses retrospective version changes", () => {
  const storage = new MemoryStorage();
  const repository = new BrowserSimulationRepository(storage);
  const anonymousUserId = getOrCreateAnonymousUserId(storage);
  const session = createInitialSession(acuteAppendicitisCase, { anonymousUserId });
  const record = repository.createSession(buildSessionRecord(session));

  assert.equal(record.case_version, "1.2.0");
  assert.equal(record.disease_card_version, "0.2.0");
  assert.equal(record.scoring_rubric_version, "1.1.0");
  assert.equal(record.router_version, "0.3.1");
  assert.match(record.case_content_hash, /^fnv1a64:/);
  assert.match(record.scoring_rubric_hash, /^fnv1a64:/);
  assert.throws(
    () => repository.updateSession(session.session_id, { scoring_rubric_version: "9.0.0" }),
    /Immutable session field/
  );
});

test("raw text is scrubbed and stored separately from analytics", () => {
  const storage = new MemoryStorage();
  const repository = new BrowserSimulationRepository(storage);
  const session = createInitialSession(acuteAppendicitisCase, {
    anonymousUserId: getOrCreateAnonymousUserId(storage),
  });
  repository.createSession(buildSessionRecord(session));
  const event = createSimulationEvent("user_message", session.session_id, {
    raw_user_text:
      "Почта doctor@example.com, телефон +7 (701) 123-45-67, ИИН 900101301234. ОАК.",
    parsed_actions: [{ id: "cbc", confidence: 0.98 }],
  });
  repository.appendEvent(event);

  const analyticsOnly = repository.listEvents();
  const withRaw = repository.listEvents({ includeRawText: true });

  assert.equal(Object.hasOwn(analyticsOnly[0], "raw_user_text"), false);
  assert.deepEqual(analyticsOnly[0].parsed_actions, [{ id: "cbc", confidence: 0.98 }]);
  assert.match(withRaw[0].raw_user_text, /\[EMAIL_REDACTED\]/);
  assert.match(withRaw[0].raw_user_text, /\[PHONE_REDACTED\]/);
  assert.match(withRaw[0].raw_user_text, /\[IIN_REDACTED\]/);
  assert.doesNotMatch(withRaw[0].raw_user_text, /doctor@example\.com|900101301234/);

  repository.deleteRawEventText(event.event_id);
  assert.equal(repository.listEvents({ includeRawText: true })[0].raw_user_text, null);
  assert.equal(repository.listEvents()[0].parsed_actions[0].id, "cbc");
});

test("completed and abandoned sessions preserve their original version snapshot", () => {
  const storage = new MemoryStorage();
  const repository = new BrowserSimulationRepository(storage);
  const anonymousUserId = getOrCreateAnonymousUserId(storage);
  const completed = createInitialSession(acuteAppendicitisCase, { anonymousUserId });
  const abandoned = createInitialSession(acuteAppendicitisCase, { anonymousUserId });
  repository.createSession(buildSessionRecord(completed));
  repository.createSession(buildSessionRecord(abandoned));

  repository.completeSession(completed.session_id, {
    completion_status: "completed",
    overall_score: 82,
    domain_scores: { Management: 90 },
    critical_errors_count: 1,
  });
  repository.completeSession(abandoned.session_id, { completion_status: "abandoned" });
  const sessions = repository.listSessions();
  const completedRecord = sessions.find((record) => record.session_id === completed.session_id);
  const abandonedRecord = sessions.find((record) => record.session_id === abandoned.session_id);

  assert.equal(completedRecord.overall_score, 82);
  assert.equal(completedRecord.completion_status, "completed");
  assert.equal(abandonedRecord.completion_status, "abandoned");
  assert.equal(abandonedRecord.case_version, completedRecord.case_version);
  assert.equal(abandonedRecord.scoring_rubric_hash, completedRecord.scoring_rubric_hash);
});

test("analytics cannot silently combine materially different rubric versions", () => {
  const sessions = [
    { case_id: "case-a", case_version: "1.0.0", scoring_rubric_version: "1.0.0", disease_card_version: "1.0.0", router_version: "1.0.0" },
    { case_id: "case-a", case_version: "1.0.0", scoring_rubric_version: "2.0.0", disease_card_version: "1.0.0", router_version: "1.0.0" },
  ];

  assert.throws(() => assertComparableRubricVersions(sessions), /Stratify or explicitly normalize/);
  assert.equal(stratifySessionsForAnalytics(sessions).length, 2);
});
