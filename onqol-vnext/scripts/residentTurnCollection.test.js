import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyLedger, emptyReadings, harvestExport, ingest, ledgerSummary, sessionKeyOf } from "./residentTurnCollection.mjs";

const exported = (purpose, turns, id = "session-1") => ({
  export_schema_version: "1.0.0", session: { id, purpose },
  learner_turns: turns.map((rawText, index) => ({ rawText, intent: "CLINICAL_ACTION", unmatchedFragments: [], interpretedCommands: [{ id: `c${index}`, type: "ORDER_TEST", params: { testId: "cbc" } }], commandOutcomes: [] })),
});
const start = () => ({ ledger: emptyLedger(), readings: emptyReadings() });

test("only learner-facing sessions count as resident turns; the rest are skipped and reported, never silently counted", () => {
  const result = ingest(start(), [
    harvestExport(exported("learner_pilot", ["ОАК", "КТ обп"]), { fileName: "a.json", fileHash: "h1" }),
    harvestExport(exported("internal_development", ["ОАК"], "dev-1"), { fileName: "b.json", fileHash: "h2" }),
    harvestExport(exported("faculty_preview", ["ОАК"], "fac-1"), { fileName: "c.json", fileHash: "h3" }),
    harvestExport({ nothing: true }, { fileName: "d.json", fileHash: "h4" }),
  ]);
  assert.equal(ledgerSummary(result.ledger).turns, 2);
  assert.deepEqual(result.report.skipped.map((s) => s.reason), ["not_a_resident_session:internal_development", "not_a_resident_session:faculty_preview", "not_a_session_export"]);
});

test("ingest is idempotent: the same export twice changes nothing", () => {
  const item = harvestExport(exported("learner_pilot", ["ОАК", "в/м"]), { fileName: "a.json", fileHash: "h1" });
  const once = ingest(start(), [item]);
  const twice = ingest(once, [item]);
  assert.equal(twice.report.newTurns, 0);
  assert.equal(twice.report.duplicateTurns, 2);
  assert.deepEqual(twice.ledger.turns, once.ledger.turns);
});

test("the ledger carries words and context but no label, and what the system did lives only in the sealed readings", () => {
  const item = harvestExport(exported("learner_pilot", ["ОАК"]), { fileName: "a.json", fileHash: "h1" });
  const { ledger, readings } = ingest(start(), [item]);
  const [turn] = Object.values(ledger.turns);
  assert.equal(turn.gold, null);
  assert.equal(turn.provenance.kind, "real_resident");
  assert.ok(!JSON.stringify(ledger).includes("interpretedCommands") && !JSON.stringify(ledger).includes("ORDER_TEST"), "no system reading in the ledger");
  assert.match(readings.note, /SEALED/);
  assert.equal(readings.readings[turn.turnKey].interpretedCommands[0].type, "ORDER_TEST");
});

test("the context that was open when the learner spoke comes from the previous turn's outcomes", () => {
  const session = exported("learner_pilot", ["кетопрофен 100 мг", "в/м"]);
  session.learner_turns[0].commandOutcomes = [{ eventType: "CLARIFICATION_REQUESTED", commandType: "ORDER_MEDICATION", params: { drugId: "ketoprofen", doseMg: 100 }, missing: ["route"] }];
  const { ledger } = ingest(start(), [harvestExport(session, { fileName: "a.json", fileHash: "h" })]);
  const second = Object.values(ledger.turns).find((t) => t.text === "в/м");
  assert.deepEqual(second.turnContext.openClarification, { commandType: "ORDER_MEDICATION", params: { drugId: "ketoprofen", doseMg: 100 }, missing: ["route"] });
  assert.equal(Object.values(ledger.turns).find((t) => t.text.startsWith("кетопрофен")).turnContext.openClarification, null);
});

test("the session key hides the session id and groups a session's turns; identity is never read", () => {
  const key = sessionKeyOf("session-42");
  assert.match(key, /^S[0-9a-f]{10}$/);
  const { ledger } = ingest(start(), [harvestExport(exported("learner_pilot", ["ОАК", "ОАМ"]), { fileName: "a.json", fileHash: "h" })]);
  assert.equal(new Set(Object.values(ledger.turns).map((t) => t.sessionKey)).size, 1);
  assert.ok(!JSON.stringify(ledger).includes("session-1"));
});

