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
import { scrubSensitiveText } from "../privacy.js";

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

test("anonymous user id rotates after the local retention window", () => {
  const storage = new MemoryStorage();
  let now = Date.parse("2026-08-20T00:00:00.000Z");
  const first = getOrCreateAnonymousUserId(storage, { now: () => now, retentionMs: 1_000 });
  now += 1_001;
  const second = getOrCreateAnonymousUserId(storage, { now: () => now, retentionMs: 1_000 });
  assert.notEqual(first, second);
});

test("opt-in redaction covers labeled names, addresses, birth dates, ids and cards", () => {
  const scrubbed = scrubSensitiveText(
    "ФИО: Иванов Иван Иванович; адрес: Алматы, Абая 1; дата рождения: 01.02.1990; " +
      "удостоверение: N12345678; карта 4111 1111 1111 1111"
  );
  assert.match(scrubbed, /\[NAME_REDACTED\]/);
  assert.match(scrubbed, /\[ADDRESS_REDACTED\]/);
  assert.match(scrubbed, /\[DOB_REDACTED\]/);
  assert.match(scrubbed, /\[ID_REDACTED\]/);
  assert.match(scrubbed, /\[CARD_REDACTED\]/);
  assert.doesNotMatch(scrubbed, /Иванов|Абая|01\.02\.1990|N12345678|4111/);
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

test("raw text is off by default and only an explicit opt-in stores a scrubbed copy", () => {
  const storage = new MemoryStorage();
  const defaultRepository = new BrowserSimulationRepository(storage);
  const session = createInitialSession(acuteAppendicitisCase, {
    anonymousUserId: getOrCreateAnonymousUserId(storage),
  });
  defaultRepository.createSession(buildSessionRecord(session));
  const event = createSimulationEvent("user_message", session.session_id, {
    raw_user_text:
      "Почта doctor@example.com, телефон +7 (701) 123-45-67, ИИН 900101301234. ОАК.",
    parsed_actions: [{ id: "cbc", confidence: 0.98 }],
  });
  const defaultResult = defaultRepository.appendEvent(event);
  assert.equal(defaultResult.raw_user_text, null);
  assert.equal(defaultRepository.listEvents({ includeRawText: true })[0].raw_user_text, null);

  const optedInStorage = new MemoryStorage();
  const repository = new BrowserSimulationRepository(optedInStorage, { persistRawText: true });
  repository.createSession(buildSessionRecord(session));
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

test("persisted engine snapshots exclude transcript, plans and learner verbatim", () => {
  const storage = new MemoryStorage();
  let now = Date.parse("2026-08-10T00:00:00.000Z");
  const repository = new BrowserSimulationRepository(storage, {
    retentionMs: 1_000,
    now: () => now,
  });
  const session = {
    session_id: "privacy-session",
    messages: [
      { role: "assistant", content: "Синтетическая презентация" },
      {
        role: "user",
        content:
          "ФИО: Иванов Иван Иванович; адрес: Алматы, Абая 1; дата рождения: 01.02.1990; карта 4111 1111 1111 1111",
      },
    ],
    turnPlans: [{ input: "ИИН 900101301234" }],
    workingMemory: {
      reasoningState: { quote: "реальные данные пациента", trigger_verbatim: "секрет" },
    },
    eventLog: [
      {
        event_type: "clinical_turn",
        raw_text_redacted: "всё ещё текст",
        reasoning_delta: { quote: "вставка" },
      },
    ],
  };

  const persisted = repository.saveSession(session);
  assert.equal(persisted.persistence_policy, "raw_text_off");
  assert.deepEqual(persisted.messages, []);
  assert.deepEqual(persisted.turnPlans, []);
  assert.equal(JSON.stringify(persisted).includes("Иванов"), false);
  assert.equal(JSON.stringify(persisted).includes("900101301234"), false);
  assert.equal(JSON.stringify(persisted).includes("всё ещё текст"), false);
  assert.equal(repository.exportSession(session.session_id)?.session_id, session.session_id);

  now += 1_001;
  assert.equal(repository.exportSession(session.session_id), null);
});

test("session deletion removes record, snapshot, analytics and opted-in raw text", () => {
  const storage = new MemoryStorage();
  const repository = new BrowserSimulationRepository(storage, { persistRawText: true });
  const session = createInitialSession(acuteAppendicitisCase, {
    anonymousUserId: getOrCreateAnonymousUserId(storage),
  });
  repository.createSession(buildSessionRecord(session));
  repository.saveSession({ ...session, messages: [] });
  repository.appendEvent(
    createSimulationEvent("user_message", session.session_id, { raw_user_text: "секрет" })
  );

  repository.deleteSession(session.session_id);
  assert.equal(repository.listSessions().some((entry) => entry.session_id === session.session_id), false);
  assert.equal(repository.exportSession(session.session_id), null);
  assert.equal(repository.listEvents({ includeRawText: true }).length, 0);
});

test("opening the repository purges every local artifact of an expired session", () => {
  const storage = new MemoryStorage();
  let now = Date.parse("2026-08-20T00:00:00.000Z");
  const repository = new BrowserSimulationRepository(storage, {
    persistRawText: true,
    retentionMs: 1_000,
    now: () => now,
  });
  const session = createInitialSession(acuteAppendicitisCase, {
    anonymousUserId: getOrCreateAnonymousUserId(storage, { now: () => now, retentionMs: 1_000 }),
  });
  repository.createSession(buildSessionRecord(session));
  repository.saveSession(session);
  repository.appendEvent(
    createSimulationEvent("user_message", session.session_id, { raw_user_text: "секрет" })
  );
  now += 1_001;
  const reopened = new BrowserSimulationRepository(storage, {
    persistRawText: true,
    retentionMs: 1_000,
    now: () => now,
  });
  assert.equal(reopened.listSessions().length, 0);
  assert.equal(reopened.listEvents({ includeRawText: true }).length, 0);
  assert.equal(reopened.exportSession(session.session_id), null);
});

test("orphan and unattributed analytics expire without a session record", () => {
  const storage = new MemoryStorage();
  let now = Date.parse("2026-08-20T00:00:00.000Z");
  const repository = new BrowserSimulationRepository(storage, {
    persistRawText: true,
    retentionMs: 1_000,
    now: () => now,
  });
  repository.appendEvent(
    createSimulationEvent("user_message", "orphan-session", { raw_user_text: "секрет" })
  );
  repository.appendEvent(
    createSimulationEvent("system_error", null, { raw_user_text: "другой секрет" })
  );
  assert.equal(repository.listEvents({ includeRawText: true }).length, 2);
  now += 1_001;
  const reopened = new BrowserSimulationRepository(storage, {
    persistRawText: true,
    retentionMs: 1_000,
    now: () => now,
  });
  assert.equal(reopened.listEvents({ includeRawText: true }).length, 0);
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
