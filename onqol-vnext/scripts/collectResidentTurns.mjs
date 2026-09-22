import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { harvestExport, ingest, ledgerSummary } from "./residentTurnCollection.mjs";
import { assignSession, registerParticipant } from "./residentParticipants.mjs";
import { loadStore, saveStore } from "./residentStore.mjs";

/**
 * Ingest learner-downloaded session exports into the resident-turn ledger.
 *
 *   node scripts/collectResidentTurns.mjs <export.json | directory> [...]
 *
 * Writes private/resident-turns/RESIDENT_TURN_LEDGER.json (words + context, no
 * labels) and RESIDENT_TURN_SYSTEM_READINGS.json (SEALED: what the system did;
 * never shown to a gold labeller). Both are GITIGNORED: raw resident data and
 * sealed system output never enter Git (owner ruling 2026-09-20). The only file
 * written under docs/ is the text-free manifest (counts, keys, hashes). Sessions
 * are linked to a participant alias (`--participant P07`, or later with
 * residentCollectionCli.mjs assign); an unlinked session is quarantined out of
 * every split. The ledger has no cap: 60 is a readiness floor, 150-250 the plan. Idempotent.
 * Reads no identity and calls nothing. See
 * docs/RESIDENT_TURN_COLLECTION_AND_GOLD_REVIEW_PROTOCOL.md.
 */
const args = process.argv.slice(2);
const participantAt = args.indexOf("--participant");
const participant = participantAt >= 0 ? args[participantAt + 1] : null;
const inputs = args.filter((arg, index) => !arg.startsWith("--") && index !== participantAt + 1);
if (!inputs.length) { console.error("usage: node scripts/collectResidentTurns.mjs <export.json | directory> [...] [--participant P07]"); process.exit(2); }

const files = inputs.flatMap((input) => {
  const resolved = path.resolve(input);
  return statSync(resolved).isDirectory() ? readdirSync(resolved).filter((n) => n.endsWith(".json")).sort().map((n) => path.join(resolved, n)) : [resolved];
});
const harvested = files.map((file) => {
  const buffer = readFileSync(file);
  let parsed = null;
  try { parsed = JSON.parse(buffer.toString("utf8")); } catch { return { skipped: { fileName: path.basename(file), reason: "not_json" } }; }
  return harvestExport(parsed, { fileName: path.basename(file), fileHash: createHash("sha256").update(buffer).digest("hex") });
});

const store = loadStore();
const result = ingest(store, harvested);
let roster = store.roster;
// One participant per invocation: every session in this batch belongs to them. Without --participant the sessions are QUARANTINED until linked.
if (participant) {
  roster = registerParticipant(roster, participant);
  for (const item of harvested) if (item.sessionKey && !item.skipped) roster = assignSession(roster, item.sessionKey, participant);
}
const saved = saveStore({ ...store, ledger: result.ledger, readings: result.readings, roster });
console.log(JSON.stringify({ filesRead: files.length, ...result.report, ledger: ledgerSummary(saved.ledger), quarantinedUntilLinked: participant ? 0 : result.report.newSessions }, null, 1));
