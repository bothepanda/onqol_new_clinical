import { createHash } from "node:crypto";
import { COLLECTION_TARGETS, classifyTurn } from "./residentSplits.mjs";
import { participantOfSession } from "./residentParticipants.mjs";

/**
 * Real resident-turn collection.
 *
 * Input is what the product already produces: the session export a learner
 * downloads (`exportSession.js`, `learner_turns`). Nothing new is recorded about
 * anyone and no identity is read - only the session id (a timestamp, hashed to a
 * short key), the learner's own words, and the small amount of conversational
 * context an interpreter needs (was a clarification or a mentor question open).
 *
 * Rules that keep the collection usable as evidence:
 *  - Only learner-facing sessions count as RESIDENT turns (`purpose` is
 *    learner_pilot or production). Internal-development and faculty-preview
 *    sessions are skipped and reported, never silently counted.
 *  - Ingest is idempotent: a turn's key is a hash of (session, position, words),
 *    so re-ingesting the same export changes nothing.
 *  - The ledger holds words + context and NO label. What the system did with a
 *    turn is kept in a separate SEALED readings file that must not be shown to
 *    a gold labeller (it would anchor the label to the system's reading).
 *  - One session is never split across evaluation partitions, so `sessionKey` is
 *    the grouping key for any later split.
 */
/**
 * 60 is the minimum READINESS gate, not a validation target: the pilot is expected
 * to yield 150-250 turns if collected naturally (residentSplits.mjs). Nothing here
 * caps a ledger; it grows as long as exports are ingested.
 */
export const RESIDENT_TARGET = COLLECTION_TARGETS.minimumReadinessTurns;
export const RESIDENT_PURPOSES = Object.freeze(["learner_pilot", "production"]);
export const LEDGER_SCHEMA = "onqol-resident-turn-ledger-v1";
export const READINGS_SCHEMA = "onqol-resident-turn-system-readings-v1";

const sha = (value) => createHash("sha256").update(value).digest("hex");
export const sessionKeyOf = (sessionId) => `S${sha(String(sessionId)).slice(0, 10)}`;
const turnKeyOf = (sessionKey, seq, text) => `T${sha(`${sessionKey}|${seq}|${text}`).slice(0, 12)}`;

export function emptyLedger() {
  return { schema: LEDGER_SCHEMA, target: RESIDENT_TARGET, sessions: {}, turns: {}, skippedExports: [] };
}
export function emptyReadings() {
  return { schema: READINGS_SCHEMA, note: "SEALED: what the system read and did. Never show to a gold labeller before labels are complete.", readings: {} };
}

/** The clarification / mentor question that was open when the learner spoke, derived from the previous turn's recorded outcomes. */
function contextBefore(previous) {
  if (!previous) return { openClarification: null, openMentorQuestion: null };
  const asked = (previous.commandOutcomes ?? []).filter((o) => o.eventType === "CLARIFICATION_REQUESTED").at(-1);
  return {
    openClarification: asked ? { commandType: asked.commandType, params: asked.params ?? {}, missing: asked.missing ?? [] } : null,
    openMentorQuestion: previous.mentor?.openQuestion ?? null,
  };
}

/** One export -> resident turns (or a reason it was skipped). */
export function harvestExport(exported, { fileName = null, fileHash = null } = {}) {
  const purpose = exported?.session?.purpose ?? null;
  const sessionId = exported?.session?.id ?? null;
  if (!Array.isArray(exported?.learner_turns) || !sessionId) return { skipped: { fileName, reason: "not_a_session_export" } };
  if (!RESIDENT_PURPOSES.includes(purpose)) return { skipped: { fileName, sessionKey: sessionKeyOf(sessionId), reason: `not_a_resident_session:${purpose}` } };

  const sessionKey = sessionKeyOf(sessionId);
  const turns = [];
  const readings = {};
  exported.learner_turns.forEach((turn, index) => {
    const text = String(turn.rawText ?? "").trim();
    if (!text) return;
    const key = turnKeyOf(sessionKey, index, text);
    turns.push({
      turnKey: key, sessionKey, position: index, text, turnContext: contextBefore(exported.learner_turns[index - 1]),
      provenance: { kind: "real_resident", sessionPurpose: purpose, exportSchema: exported.export_schema_version ?? null, contextDerivedFrom: "previous_turn_outcomes" },
      collectedFrom: { file: fileName, sha256: fileHash },
      // "seen_by_developers" when the words were already visible to whoever tunes the interpreter; such a turn can never be evaluation data.
      exposure: "unseen",
      // A label is a separate act by a named person (goldReview.mjs); it is never filled in here.
      gold: null,
    });
    readings[key] = {
      intent: turn.intent ?? null, unmatchedFragments: turn.unmatchedFragments ?? [],
      interpretedCommands: (turn.interpretedCommands ?? []).map((c) => ({ type: c.type, params: c.params })),
      withheldCommands: turn.withheldCommands ?? [],
      outcomes: (turn.commandOutcomes ?? []).map((o) => ({ commandType: o.commandType, outcome: o.outcome, eventType: o.eventType })),
    };
  });
  return { sessionKey, sessionId, turns, readings };
}

/** Idempotent merge of harvested exports into the ledger. Returns new objects; inputs are not mutated. */
export function ingest({ ledger, readings }, harvested) {
  const nextLedger = structuredClone(ledger);
  const nextReadings = structuredClone(readings);
  const report = { newTurns: 0, duplicateTurns: 0, newSessions: 0, skipped: [] };
  for (const item of harvested) {
    if (item.skipped) {
      report.skipped.push(item.skipped);
      if (!nextLedger.skippedExports.some((s) => s.fileName === item.skipped.fileName && s.reason === item.skipped.reason)) nextLedger.skippedExports.push(item.skipped);
      continue;
    }
    if (!nextLedger.sessions[item.sessionKey]) { nextLedger.sessions[item.sessionKey] = { turns: 0, files: [] }; report.newSessions += 1; }
    const session = nextLedger.sessions[item.sessionKey];
    for (const turn of item.turns) {
      if (nextLedger.turns[turn.turnKey]) { report.duplicateTurns += 1; continue; }
      nextLedger.turns[turn.turnKey] = turn;
      nextReadings.readings[turn.turnKey] = item.readings[turn.turnKey];
      session.turns += 1;
      report.newTurns += 1;
    }
    for (const turn of item.turns) if (!session.files.includes(turn.collectedFrom.sha256)) session.files.push(turn.collectedFrom.sha256);
  }
  return { ledger: nextLedger, readings: nextReadings, report };
}

export function ledgerSummary(ledger) {
  const turns = Object.values(ledger.turns);
  const sessions = Object.keys(ledger.sessions).length;
  return {
    turns: turns.length, sessions, minimumReadinessTurns: ledger.target ?? RESIDENT_TARGET, belowMinimumBy: Math.max(0, (ledger.target ?? RESIDENT_TARGET) - turns.length), plannedTurns: COLLECTION_TARGETS.plannedTurns,
    unlabelled: turns.filter((t) => !t.gold).length,
    skippedExports: ledger.skippedExports.length,
  };
}

/** Marks every turn of the given sessions as already seen by the developers. Irreversible by design: nothing un-sees words. */
export function markExposure(ledger, sessionKeys, exposure = "seen_by_developers") {
  const next = structuredClone(ledger);
  for (const turn of Object.values(next.turns)) if (sessionKeys.includes(turn.sessionKey)) turn.exposure = exposure;
  return next;
}

/** Each turn with its participant, split and eligibility. `roster` and `plan` are private; the result carries no words. */
export function classifyLedger(ledger, { roster, plan }) {
  return Object.values(ledger.turns).map((turn) => {
    const participant = roster ? participantOfSession(roster, turn.sessionKey) : null;
    return { turnKey: turn.turnKey, sessionKey: turn.sessionKey, ...classifyTurn({ turn, participantKey: participant?.participantKey ?? null, plan }) };
  });
}

/**
 * The part of the collection that may live in Git: counts, keys and hashes. No
 * word a resident typed, no context, no system reading, no alias. Rebuilt from the
 * private ledger on every ingest; the words themselves stay under private/.
 */
export const MANIFEST_SCHEMA = "onqol-resident-turn-manifest-v2";
export function buildResidentManifest(ledger, { roster = null, plan = null } = {}) {
  const turns = Object.values(ledger.turns).sort((a, b) => a.turnKey.localeCompare(b.turnKey));
  const classified = new Map((plan ? classifyLedger(ledger, { roster, plan }) : []).map((entry) => [entry.turnKey, entry]));
  const count = (predicate) => turns.filter((turn) => predicate(classified.get(turn.turnKey) ?? {}, turn)).length;
  const participants = new Map();
  for (const turn of turns) {
    const c = classified.get(turn.turnKey);
    if (!c?.participantKey) continue;
    const entry = participants.get(c.participantKey) ?? { participantKey: c.participantKey, split: c.split, turns: 0, sessions: new Set() };
    entry.turns += 1; entry.sessions.add(turn.sessionKey); participants.set(c.participantKey, entry);
  }
  return {
    schema: MANIFEST_SCHEMA,
    note: "Hashes, keys and counts only. No resident words, no alias, no system reading. The words live in the private store (gitignored); see scripts/evidenceGovernance.mjs.",
    targets: { minimumReadinessTurns: COLLECTION_TARGETS.minimumReadinessTurns, plannedTurns: COLLECTION_TARGETS.plannedTurns, minimumEvaluationParticipants: COLLECTION_TARGETS.minimumEvaluationParticipants, minimumEvaluationTurns: COLLECTION_TARGETS.minimumEvaluationTurns },
    target: ledger.target ?? RESIDENT_TARGET,
    turnCount: turns.length,
    sessionCount: Object.keys(ledger.sessions).length,
    counts: {
      quarantinedNoParticipant: turns.length - count((c) => Boolean(c.participantKey)),
      development: count((c) => c.split === "RESIDENT_DEVELOPMENT"),
      evaluation: count((c) => c.split === "RESIDENT_EVALUATION"),
      evaluationEligible: count((c) => c.evaluationEligible === true),
      seenByDevelopers: count((_, turn) => (turn.exposure ?? "unseen") !== "unseen"),
    },
    participants: [...participants.values()].sort((a, b) => a.participantKey.localeCompare(b.participantKey)).map((e) => ({ participantKey: e.participantKey, split: e.split, turns: e.turns, sessions: e.sessions.size })),
    splitPlanChain: plan?.chain ?? null,
    sessions: Object.fromEntries(Object.entries(ledger.sessions).sort(([a], [b]) => a.localeCompare(b)).map(([key, session]) => [key, { turns: session.turns, exportSha256: [...(session.files ?? [])].sort() }])),
    turns: turns.map((turn) => ({
      turnKey: turn.turnKey, sessionKey: turn.sessionKey, position: turn.position, textSha256: sha(turn.text), sessionPurpose: turn.provenance?.sessionPurpose ?? null,
      participantKey: classified.get(turn.turnKey)?.participantKey ?? null, split: classified.get(turn.turnKey)?.split ?? null,
      exposure: turn.exposure ?? "unseen", evaluationEligible: classified.get(turn.turnKey)?.evaluationEligible ?? false,
    })),
    skippedExports: ledger.skippedExports.length,
  };
}

