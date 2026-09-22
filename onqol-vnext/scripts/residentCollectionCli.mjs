import process from "node:process";
import { assignSession, registerParticipant } from "./residentParticipants.mjs";
import { COLLECTION_TARGETS, assertParticipantDisjoint } from "./residentSplits.mjs";
import { buildResidentManifest, classifyLedger, ledgerSummary, markExposure } from "./residentTurnCollection.mjs";
import { loadStore, saveStore } from "./residentStore.mjs";

/**
 * Participants, sessions and splits for the resident collection. Nothing here
 * reads or stores an identity: a participant is an alias the coordinator chose.
 *
 *   register <P01>                       add a participant alias
 *   assign <sessionKey> <P01>            link a collected session to a participant (once, forever)
 *   mark-seen <sessionKey> [...]         these turns were already visible to the developers: never evaluation data
 *   status                               counts by split and eligibility (no words)
 *
 * Splits are assigned per PARTICIPANT, append-only, when a participant first has a
 * linked session (residentSplits.mjs). Ingesting exports is collectResidentTurns.mjs.
 */
const [command, ...args] = process.argv.slice(2);
let store = loadStore();

if (command === "register") {
  store = saveStore({ ...store, roster: registerParticipant(store.roster, args[0]) });
  console.log(JSON.stringify({ registered: args[0], participants: Object.keys(store.roster.participants).length }, null, 1));
} else if (command === "assign") {
  if (!store.ledger.sessions[args[0]]) { console.error(`unknown_session:${args[0]} (ingest it first)`); process.exit(1); }
  store = saveStore({ ...store, roster: assignSession(store.roster, args[0], args[1]) });
  const key = store.roster.participants[args[1]].key;
  console.log(JSON.stringify({ session: args[0], participantKey: key, split: store.plan.assignments[key]?.split ?? null }, null, 1));
} else if (command === "mark-seen") {
  store = saveStore({ ...store, ledger: markExposure(store.ledger, args) });
  console.log(JSON.stringify({ markedSessions: args, note: "these turns can only ever be development data" }, null, 1));
} else if (command === "status") {
  const classified = classifyLedger(store.ledger, store);
  assertParticipantDisjoint(classified);
  const manifest = buildResidentManifest(store.ledger, store);
  const eligible = manifest.counts.evaluationEligible;
  console.log(JSON.stringify({
    summary: ledgerSummary(store.ledger), counts: manifest.counts,
    participants: { registered: Object.keys(store.roster.participants).length, withSessions: manifest.participants.length, evaluation: manifest.participants.filter((p) => p.split === "RESIDENT_EVALUATION").length, development: manifest.participants.filter((p) => p.split === "RESIDENT_DEVELOPMENT").length },
    gates: {
      minimumReadiness: { need: COLLECTION_TARGETS.minimumReadinessTurns, have: manifest.turnCount, met: manifest.turnCount >= COLLECTION_TARGETS.minimumReadinessTurns },
      plannedCollection: COLLECTION_TARGETS.plannedTurns,
      evaluation: { participantsNeeded: COLLECTION_TARGETS.minimumEvaluationParticipants, turnsNeeded: COLLECTION_TARGETS.minimumEvaluationTurns, eligibleTurns: eligible },
    },
    note: "60 is a readiness floor, not a validation target.",
  }, null, 1));
} else { console.error("usage: residentCollectionCli.mjs register|assign|mark-seen|status ..."); process.exit(2); }
