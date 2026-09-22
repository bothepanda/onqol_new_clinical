import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { PRIVATE_REVIEW_DIR, assertPrivateOutput } from "./evidenceGovernance.mjs";
import { labelVocabulary } from "./goldReview.mjs";
import { applyResidentAdjudication, buildReleasedRows, buildResidentPacket, checkResidentReview, compareReviews, emptyAdjudication, reviewRecord } from "./residentGold.mjs";
import { assertParticipantDisjoint } from "./residentSplits.mjs";
import { classifyLedger } from "./residentTurnCollection.mjs";
import { loadStore, root } from "./residentStore.mjs";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

/**
 * Blind gold review of real resident turns. Three records, three places:
 *
 *   private/gold-review/packets/       what a reviewer is handed (words + context only)
 *   private/gold-review/reviews/       each independent reviewer's decisions (alias-attributed)
 *   private/gold-review/adjudication/  the adjudicator's decisions (alias-attributed, working file)
 *   docs/evidence/resident-gold/       the RELEASED, de-identified, adjudicated rows (tracked)
 *
 *   packet     [--split development|evaluation|all] [--out file]
 *   check      --packet file --review file --reviewer R01
 *   compare    --packet-id ID --a R01 --b R02
 *   adjudicate --packet-id ID --a R01 --b R02 --decisions file
 *   release
 *   status
 *
 * Quarantined turns (session not linked to a participant) are never packeted. Nothing
 * here reads the sealed system readings.
 */
const arg = (name, fallback = null) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const abs = (rel) => path.join(root, rel);
const dirs = { packets: `${PRIVATE_REVIEW_DIR}/packets`, reviews: `${PRIVATE_REVIEW_DIR}/reviews`, adjudication: `${PRIVATE_REVIEW_DIR}/adjudication` };
const RELEASE_FILE = "docs/evidence/resident-gold/ADJUDICATED_RESIDENT_ROWS.json";
const STATE_FILE = "docs/evidence/resident-gold/RESIDENT_EVALUATION_STATE.json";
const readJson = (file) => JSON.parse(readFileSync(path.isAbsolute(file) ? file : path.resolve(file), "utf8"));
const writePrivate = (rel, value) => { assertPrivateOutput(abs(rel), root, rel); mkdirSync(path.dirname(abs(rel)), { recursive: true }); writeFileSync(abs(rel), JSON.stringify(value, null, 2) + "\n"); };
const vocabulary = labelVocabulary(withShared(disease, shared));
const command = process.argv[2];
const store = loadStore();
const classified = classifyLedger(store.ledger, store);
assertParticipantDisjoint(classified);
const textOf = Object.fromEntries(Object.values(store.ledger.turns).map((turn) => [turn.turnKey, turn.text]));
const listDir = (rel) => (existsSync(abs(rel)) ? readdirSync(abs(rel)).filter((n) => n.endsWith(".json")) : []);

if (command === "packet") {
  const split = (arg("--split", "development")).toUpperCase();
  const wanted = split === "ALL" ? ["RESIDENT_DEVELOPMENT", "RESIDENT_EVALUATION"] : [`RESIDENT_${split}`];
  const keys = new Set(classified.filter((entry) => entry.split && wanted.includes(entry.split)).map((entry) => entry.turnKey));
  const items = Object.values(store.ledger.turns).filter((turn) => keys.has(turn.turnKey)).map((turn) => ({ id: turn.turnKey, text: turn.text, turnContext: turn.turnContext }));
  const packetId = `RP-${new Date().toISOString().slice(0, 10)}-${createHash("sha256").update(items.map((i) => i.id).sort().join("|")).digest("hex").slice(0, 8)}`;
  const packet = buildResidentPacket({ items, vocabulary, packetId });
  const out = arg("--out", `${dirs.packets}/RESIDENT_PACKET_${packetId}.json`);
  writePrivate(path.isAbsolute(out) ? path.relative(root, out) : out, packet);
  console.log(JSON.stringify({ wrote: out, packetId, items: packet.items.length, splits: wanted, quarantinedExcluded: classified.filter((e) => !e.split).length, containsSystemReading: false }, null, 1));
} else if (command === "check") {
  const packet = readJson(arg("--packet"));
  const result = checkResidentReview({ packet, review: readJson(arg("--review")), reviewer: arg("--reviewer"), vocabulary });
  if (result.ok) writePrivate(`${dirs.reviews}/RESIDENT_REVIEW_${packet.packetId}_${result.reviewer}.json`, reviewRecord({ packet, check: result, completedAt: new Date().toISOString() }));
  console.log(JSON.stringify({ ok: result.ok, reviewer: result.reviewer, labelled: result.labelled, total: result.total, errors: result.errors.slice(0, 15) }, null, 1));
  if (!result.ok) process.exit(1);
} else if (command === "compare") {
  const load = (alias) => readJson(abs(`${dirs.reviews}/RESIDENT_REVIEW_${arg("--packet-id")}_${alias}.json`));
  const comparison = compareReviews(load(arg("--a")), load(arg("--b")));
  writePrivate(`${dirs.adjudication}/COMPARISON_${comparison.packetId}.json`, comparison);
  console.log(JSON.stringify({ packetId: comparison.packetId, reviewers: comparison.reviewers, compared: comparison.compared, agree: comparison.agree, agreementRate: comparison.agreementRate, commitmentStateOnlyDisagreements: comparison.commitmentStateOnlyDisagreements, needAdjudication: comparison.disagreements.length }, null, 1));
} else if (command === "adjudicate") {
  const id = arg("--packet-id");
  const load = (alias) => readJson(abs(`${dirs.reviews}/RESIDENT_REVIEW_${id}_${alias}.json`));
  const file = `${dirs.adjudication}/RESIDENT_ADJUDICATION_WORKING_${id}.json`;
  const result = applyResidentAdjudication({ adjudication: existsSync(abs(file)) ? readJson(abs(file)) : emptyAdjudication(), decisions: readJson(arg("--decisions")), reviewA: load(arg("--a")), reviewB: load(arg("--b")), vocabulary, texts: textOf });
  if (result.errors.length) { console.error(JSON.stringify({ applied: false, errors: result.errors.slice(0, 20) }, null, 1)); process.exit(1); }
  writePrivate(file, result.adjudication);
  console.log(JSON.stringify({ applied: true, adjudicated: result.adjudicated }, null, 1));
} else if (command === "release") {
  const state = existsSync(abs(STATE_FILE)) ? readJson(abs(STATE_FILE)) : { evaluationCompleted: false };
  const merged = emptyAdjudication();
  for (const name of listDir(dirs.adjudication).filter((n) => n.startsWith("RESIDENT_ADJUDICATION_WORKING_"))) Object.assign(merged.items, readJson(abs(`${dirs.adjudication}/${name}`)).items);
  const released = buildReleasedRows({ adjudication: merged, texts: textOf, classified, evaluationCompleted: state.evaluationCompleted === true });
  mkdirSync(path.dirname(abs(RELEASE_FILE)), { recursive: true });
  writeFileSync(abs(RELEASE_FILE), JSON.stringify(released, null, 2) + "\n");
  console.log(JSON.stringify({ wrote: RELEASE_FILE, rows: released.rows.length, sealedEvaluationRows: released.rows.filter((r) => r.sealed).length, evaluationCompleted: released.evaluationCompleted }, null, 1));
} else if (command === "status") {
  console.log(JSON.stringify({ packets: listDir(dirs.packets).length, reviews: listDir(dirs.reviews).length, adjudicationFiles: listDir(dirs.adjudication).length, note: "counts only" }, null, 1));
} else { console.error("usage: residentGoldCli.mjs packet|check|compare|adjudicate|release|status ..."); process.exit(2); }
