import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRIVATE_PARTICIPANT_DIR, PRIVATE_RESIDENT_DIR, RESIDENT_MANIFEST, assertPrivateOutput } from "./evidenceGovernance.mjs";
import { emptyRoster } from "./residentParticipants.mjs";
import { SPLIT, assignParticipants, emptyPlan, planOnlyAppends } from "./residentSplits.mjs";
import { buildResidentManifest, classifyLedger, emptyLedger, emptyReadings } from "./residentTurnCollection.mjs";

/**
 * Where the resident collection lives on disk, in one place. Everything that
 * carries words, participant links or the split plan is under private/ and is
 * written through `assertPrivateOutput`; the only file written into the tracked
 * tree is the text-free manifest.
 */
export const root = fileURLToPath(new URL("../", import.meta.url));
export const FILES = Object.freeze({
  ledger: path.join(PRIVATE_RESIDENT_DIR, "RESIDENT_TURN_LEDGER.json"),
  readings: path.join(PRIVATE_RESIDENT_DIR, "RESIDENT_TURN_SYSTEM_READINGS.json"),
  roster: path.join(PRIVATE_PARTICIPANT_DIR, "PARTICIPANT_ROSTER.json"),
  plan: path.join(PRIVATE_PARTICIPANT_DIR, "RESIDENT_SPLIT_PLAN.json"),
  manifest: RESIDENT_MANIFEST,
});

const abs = (rel) => path.join(root, rel);
const readJson = (rel, fallback) => (existsSync(abs(rel)) ? JSON.parse(readFileSync(abs(rel), "utf8")) : fallback());

export function loadStore() {
  return { ledger: readJson(FILES.ledger, emptyLedger), readings: readJson(FILES.readings, emptyReadings), roster: readJson(FILES.roster, emptyRoster), plan: readJson(FILES.plan, () => emptyPlan()) };
}

function writePrivate(rel, value) {
  assertPrivateOutput(abs(rel), root, rel);
  mkdirSync(path.dirname(abs(rel)), { recursive: true });
  writeFileSync(abs(rel), JSON.stringify(value, null, 2) + "\n");
}

/**
 * Assigns any newly linked participant to a split (never moving an existing one),
 * then writes everything: private files under private/, the text-free manifest into docs/.
 */
export function saveStore(store) {
  const candidates = new Map();
  for (const entry of classifyLedger(store.ledger, { roster: store.roster, plan: store.plan })) {
    if (!entry.participantKey) continue;
    const exposed = Object.values(store.ledger.turns).some((turn) => turn.sessionKey === entry.sessionKey && (turn.exposure ?? "unseen") !== "unseen");
    const known = candidates.get(entry.participantKey);
    candidates.set(entry.participantKey, { participantKey: entry.participantKey, forcedSplit: known?.forcedSplit ?? (exposed ? SPLIT.DEVELOPMENT : undefined) });
    if (exposed) candidates.get(entry.participantKey).forcedSplit = SPLIT.DEVELOPMENT;
  }
  const before = store.plan;
  const plan = assignParticipants(before, [...candidates.values()]);
  if (!planOnlyAppends(before, plan)) throw new Error("split_plan_changed_an_existing_assignment");
  const next = { ...store, plan };
  writePrivate(FILES.ledger, next.ledger);
  writePrivate(FILES.readings, next.readings);
  writePrivate(FILES.roster, next.roster);
  writePrivate(FILES.plan, next.plan);
  mkdirSync(path.dirname(abs(FILES.manifest)), { recursive: true });
  writeFileSync(abs(FILES.manifest), JSON.stringify(buildResidentManifest(next.ledger, { roster: next.roster, plan: next.plan }), null, 2) + "\n");
  return next;
}
