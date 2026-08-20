/**
 * Concurrent-pilot guarantees.
 *
 * WHY THIS FILE EXISTS
 *
 * Eight residents run ON QOL at the same time from eight machines. Every one of
 * the properties that makes that safe already held before this file was written
 * - sessions are plain values, the generator is a pure function of its seed, and
 * storage is keyed by session. None of it was pinned down by a test, so the next
 * refactor could quietly take any of it away and every existing test would still
 * pass.
 *
 * These are the nine checks from the pilot brief, plus the local-storage
 * separation the brief asks for in section 8. They assert properties, not
 * implementation: a session that stops being a plain value would fail here, and
 * that is the point.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildV35Case } from "../v35/createCase.js";
import { advanceV25Session, createV25Session } from "../v25/engine.js";
import { createKnowledgeBase } from "../v25/knowledgeBase.js";
import { buildV25ReplayExport } from "../v25/replayExport.js";
import process from "node:process";
import { createSessionCode, localDayStamp } from "../ids.js";

/**
 * The pilot runs in Asia/Almaty while CI runs in UTC, and the whole point of
 * the day stamp is that those two disagree for five hours every night. Pinning
 * the zone inside the test is what makes the disagreement visible instead of
 * dependent on where the suite happens to run.
 */
function withTimezone(timeZone, run) {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
import { BrowserSimulationRepository } from "../simulationRepository.js";

/** Minimal localStorage stand-in: the repository only needs get/set. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

function startSession(seed, options = {}) {
  const built = buildV35Case({
    seed,
    locale: "ru",
    previousPresetId: options.previousPresetId || null,
    mode: "learner",
  });
  const session = createV25Session({
    caseData: built.caseData,
    mode: "reference",
    seed,
    locale: "ru",
    learnerId: "anon:test",
    institutionId: "synthetic-pilot",
  });
  return { caseData: built.caseData, session, selection: built.selection };
}

async function play(run, inputs) {
  let session = run.session;
  for (const input of inputs) {
    const result = await advanceV25Session({
      caseData: run.caseData,
      session,
      input,
      knowledgeBase: createKnowledgeBase(),
      options: { locale: "ru", mentor: true, provider: "local" },
    });
    session = result.session;
  }
  return session;
}

const TURNS = ["осмотрю живот", "общий анализ крови", "узи брюшной полости"];

// --- A: identifiers ---------------------------------------------------------

test("A · every session gets its own id and its own readable code", () => {
  const ids = new Set();
  const codes = new Set();
  for (let index = 0; index < 200; index += 1) {
    const { session } = startSession(`reference-a${index}`);
    ids.add(session.session_id);
    codes.add(session.session_code);
  }
  assert.equal(ids.size, 200);
  assert.equal(codes.size, 200);
});

test("A \u00b7 the readable code is transcribable and carries no learner identity", () => {
  const code = withTimezone("Asia/Almaty", () =>
    createSessionCode(new Date("2026-08-20T21:15:00Z")));
  // Date plus five characters. The fixed "ONQOL-" prefix is read as a word, so
  // only the random suffix has to avoid the glyphs that get copied wrong.
  assert.match(code, /^ONQOL-20260821-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/);
  const suffix = code.slice("ONQOL-20260821-".length);
  assert.doesNotMatch(suffix, /[ILOU01]/);
});

test("A \u00b7 the code carries the day the resident had, not the UTC day", () => {
  // 21:15 UTC is already 02:15 the next morning in Almaty. The resident writes
  // that morning's date into the feedback form, so the code has to agree with
  // the wall clock they read it off, not with the server's day boundary.
  const at = new Date("2026-08-20T21:15:00Z");
  assert.equal(withTimezone("Asia/Almaty", () => localDayStamp(at)), "2026-08-21");
  assert.equal(withTimezone("UTC", () => localDayStamp(at)), "2026-08-20");
  assert.match(
    withTimezone("Asia/Almaty", () => createSessionCode(at)),
    /^ONQOL-20260821-/,
  );
});

// --- B, C, D: one session's turns touch nothing else ------------------------

test("B, C, D · acting in A leaves B's state, clock and mentor untouched", async () => {
  const a = startSession("reference-b1");
  const b = startSession("reference-b2");
  const before = JSON.stringify(b.session);

  const played = await play(a, TURNS);

  assert.ok(played.workingMemory.turnNumber > 0, "A actually advanced");
  assert.equal(JSON.stringify(b.session), before, "B is byte-identical");

  // Spelled out, because each of these is a separate line in the brief.
  assert.equal(b.session.workingMemory.turnNumber, 0);
  assert.equal(b.session.temporalState.clockMinutes, a.session.temporalState.clockMinutes);
  assert.notEqual(played.temporalState.clockMinutes, b.session.temporalState.clockMinutes);
  assert.equal(b.session.workingMemory.pendingMentorQuestion, null);
  assert.equal(b.session.completedActions.length, 0);
  assert.equal(b.session.revealedFindings.length, 0);
});

test("D · a mentor question raised in A is not reachable from B", async () => {
  // «обезболю» names an intention without an agent or a route, which is what
  // opens an operationalization question - the mentor state the brief means.
  const a = startSession("reference-d1");
  const b = startSession("reference-d2");

  const played = await play(a, ["обезболю пациента", "покапаю пока"]);

  // Two shapes of open mentor state, and A must hold both: the half-stated
  // order waiting for its slots, and the question the mentor put this turn.
  assert.ok(
    played.workingMemory.pendingOperationalization.length > 0,
    "A holds an order waiting to be operationalized"
  );
  assert.ok(played.workingMemory.pendingMentorQuestion, "A holds an open mentor question");

  assert.deepEqual(b.session.workingMemory.pendingOperationalization, []);
  assert.equal(b.session.workingMemory.pendingMentorQuestion, null);
  assert.deepEqual(b.session.workingMemory.deferredMentorIssues, []);
  assert.deepEqual(b.session.workingMemory.orderRecords, {});
});

// --- E, F: seeds ------------------------------------------------------------

test("E · the same seed reproduces the same patient truth", () => {
  const first = buildV35Case({ seed: "reference-e1", locale: "ru", mode: "learner" });
  const second = buildV35Case({ seed: "reference-e1", locale: "ru", mode: "learner" });

  assert.equal(first.selection.case_preset_id, second.selection.case_preset_id);
  assert.equal(first.selection.effective_seed, second.selection.effective_seed);
  assert.deepEqual(first.patient, second.patient);
});

test("F · different seeds vary the patient inside the approved presets", () => {
  const presets = new Set();
  const patients = new Set();
  for (let index = 0; index < 40; index += 1) {
    const built = buildV35Case({ seed: `reference-f${index}`, locale: "ru", mode: "learner" });
    presets.add(built.selection.case_preset_id);
    patients.add(JSON.stringify(built.patient));
    // Variation never leaves the reviewed preset pool.
    assert.match(built.selection.case_preset_id, /^APP-00[1-4]$/);
  }
  // Not "every seed differs" - only that the pool is genuinely in use.
  assert.ok(presets.size > 1, `expected more than one preset, saw ${[...presets]}`);
  assert.ok(patients.size > 1, "expected patient variation across seeds");
});

// --- G: logs ----------------------------------------------------------------

test("G · each export and each stored log carries only its own session", async () => {
  const a = startSession("reference-g1");
  const b = startSession("reference-g2");
  const playedA = await play(a, TURNS);
  const playedB = await play(b, ["осмотрю живот"]);

  const exportA = buildV25ReplayExport(playedA);
  const exportB = buildV25ReplayExport(playedB);

  assert.equal(exportA.session.session_id, playedA.session_id);
  assert.equal(exportA.session.session_code, playedA.session_code);
  assert.notEqual(exportA.session.session_id, exportB.session.session_id);
  for (const event of exportA.events) {
    if (event.session_id) assert.equal(event.session_id, playedA.session_id);
  }
  assert.notEqual(exportA.events.length, 0);

  // The same separation in local storage, where two tabs on one machine meet.
  const storage = memoryStorage();
  const repository = new BrowserSimulationRepository(storage);
  repository.appendEvent({ session_id: playedA.session_id, event_type: "user_message" });
  repository.appendEvent({ session_id: playedA.session_id, event_type: "action_extracted" });
  repository.appendEvent({ session_id: playedB.session_id, event_type: "user_message" });

  assert.equal(repository.listEvents({ sessionId: playedA.session_id }).length, 2);
  assert.equal(repository.listEvents({ sessionId: playedB.session_id }).length, 1);
  for (const event of repository.listEvents({ sessionId: playedB.session_id })) {
    assert.equal(event.session_id, playedB.session_id);
  }

  // Deleting one participant's data leaves the other's intact.
  repository.deleteSession(playedA.session_id);
  assert.equal(repository.listEvents({ sessionId: playedA.session_id }).length, 0);
  assert.equal(repository.listEvents({ sessionId: playedB.session_id }).length, 1);
});

// --- H: new case ------------------------------------------------------------

test("H · starting a new case carries nothing over from the finished one", async () => {
  const first = startSession("reference-h1");
  const played = await play(first, TURNS);
  assert.ok(played.completedActions.length > 0, "the first case was actually played");

  const second = startSession("reference-h2", {
    previousPresetId: first.session.v35_composition?.case_preset_id,
  });

  assert.notEqual(second.session.session_id, played.session_id);
  assert.notEqual(second.session.session_code, played.session_code);
  assert.notEqual(second.session.scenario.seed, played.scenario.seed);
  assert.deepEqual(second.session.completedActions, []);
  assert.deepEqual(second.session.revealedFindings, []);
  assert.deepEqual(second.session.actionLog, []);
  assert.equal(second.session.workingMemory.turnNumber, 0);
  assert.equal(second.session.workingMemory.pendingMentorQuestion, null);
  assert.deepEqual(second.session.workingMemory.deferredMentorIssues, []);
  assert.equal(second.session.temporalState.clockMinutes, 0);
  assert.equal(second.session.eventLog.length, 1, "a fresh log, holding only case_started");
  assert.equal(second.session.finished, false);
});

// --- I: concurrency ---------------------------------------------------------

test("I · two sessions interleaved over several turns do not contaminate", async () => {
  const a = startSession("reference-i1");
  const b = startSession("reference-i2");
  let sessionA = a.session;
  let sessionB = b.session;

  const scriptA = ["осмотрю живот", "общий анализ крови", "узи брюшной полости"];
  const scriptB = ["соберу анамнез", "тест на беременность"];

  // Alternating, which is what two residents actually look like to the engine.
  for (let turn = 0; turn < Math.max(scriptA.length, scriptB.length); turn += 1) {
    if (scriptA[turn]) {
      sessionA = (
        await advanceV25Session({
          caseData: a.caseData,
          session: sessionA,
          input: scriptA[turn],
          knowledgeBase: createKnowledgeBase(),
          options: { locale: "ru", mentor: true, provider: "local" },
        })
      ).session;
    }
    if (scriptB[turn]) {
      sessionB = (
        await advanceV25Session({
          caseData: b.caseData,
          session: sessionB,
          input: scriptB[turn],
          knowledgeBase: createKnowledgeBase(),
          options: { locale: "ru", mentor: true, provider: "local" },
        })
      ).session;
    }
  }

  assert.equal(sessionA.workingMemory.turnNumber, scriptA.length);
  assert.equal(sessionB.workingMemory.turnNumber, scriptB.length);
  assert.notEqual(sessionA.session_id, sessionB.session_id);

  // The clocks ran independently: B's two turns cost less time than A's three.
  assert.notEqual(sessionA.temporalState.clockMinutes, sessionB.temporalState.clockMinutes);

  // Nothing either resident ordered appears in the other's record. The two
  // scripts share no action by construction, so any overlap is contamination.
  const actionsA = new Set(sessionA.actionLog.map((entry) => entry.action_id));
  const actionsB = new Set(sessionB.actionLog.map((entry) => entry.action_id));
  assert.ok(actionsA.size > 0 && actionsB.size > 0, "both residents ordered something");
  for (const action of actionsB) assert.equal(actionsA.has(action), false);
  for (const action of sessionB.completedActions) {
    assert.equal(sessionA.completedActions.includes(action), false);
  }
  for (const event of sessionB.eventLog) {
    if (event.session_id) assert.equal(event.session_id, sessionB.session_id);
  }
});
