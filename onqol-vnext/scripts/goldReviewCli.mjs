import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { applyDecisions, buildBlindPacket, checkBlindReview, labelVocabulary, syncResidentRows } from "./goldReview.mjs";
import { suiteRows, v3Corpus } from "./v3Corpus.mjs";
import { PRIVATE_RESIDENT_DIR, PRIVATE_REVIEW_DIR, assertPrivateOutput } from "./evidenceGovernance.mjs";
import { withShared } from "../src/core/content/loadBundle.js";
import disease from "../src/content/generated/appendicitis.json" with { type: "json" };
import shared from "../src/content/generated/shared.json" with { type: "json" };

/**
 * Independent gold labelling and adjudication, as three explicit steps.
 *
 *   packet  [--suite development|holdout|all] [--resident] [--out file]
 *   check   --packet file --review file --reviewer "Name" [--out file]
 *   sync-resident                       (an undecided adjudication entry for every collected resident turn)
 *   apply   --decisions file            (named adjudication decisions -> adjudication artifact)
 *
 * `packet` copies ONLY id + words + conversational context: no draft gold, no
 * system reading, no split. Labelling the holdout rows feeds the gold and nothing
 * else: no code, prompt, registry or metric may change as a result of what a
 * labeller or adjudicator says about them (the holdout is run once, frozen).
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(root, "docs/evidence/gold-review");
const arg = (name, fallback = null) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const flag = (name) => process.argv.includes(name);
const bundle = withShared(disease, shared);
const vocabulary = labelVocabulary(bundle);
const read = (file) => JSON.parse(readFileSync(path.resolve(file), "utf8"));
const command = process.argv[2];
mkdirSync(dir, { recursive: true });

const corpus = () => {
  const suite = (arg("--suite", "all")).toUpperCase();
  const rows = v3Corpus();
  return suite === "ALL" ? rows : suiteRows(rows, suite);
};
const residentTurns = () => {
  const file = path.join(root, PRIVATE_RESIDENT_DIR, "RESIDENT_TURN_LEDGER.json");
  return existsSync(file) ? Object.values(read(file).turns) : [];
};

if (command === "packet") {
  const items = [
    ...corpus().map((row) => ({ id: row.id, text: row.text, turnContext: row.turnContext })),
    ...(flag("--resident") ? residentTurns().map((turn) => ({ id: turn.turnKey, text: turn.text, turnContext: turn.turnContext })) : []),
  ];
  const packet = buildBlindPacket({ items, vocabulary });
  // A packet is a working file handed to a reviewer and may carry resident words:
  // it is written under private/ (gitignored), never into the tracked evidence tree.
  const out = arg("--out", path.join(root, PRIVATE_REVIEW_DIR, `BLIND_PACKET_${new Date().toISOString().slice(0, 10)}.json`));
  assertPrivateOutput(out, root, "a blind packet");
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(packet, null, 2) + "\n");
  console.log(JSON.stringify({ wrote: path.relative(root, out), items: packet.items.length, containsGold: false }, null, 1));
} else if (command === "check") {
  const packet = read(arg("--packet"));
  const review = read(arg("--review"));
  const draftById = Object.fromEntries(v3Corpus().map((row) => [row.id, row.gold]));
  const result = checkBlindReview({ packet, review, reviewer: arg("--reviewer"), draftById, vocabulary });
  // Tracked output: aggregate agreement, attributed to the reviewer ALIAS only.
  const out = arg("--out", path.join(dir, `BLIND_REVIEW_CHECK_${(arg("--reviewer") ?? "unknown").replace(/\W+/g, "_")}_${new Date().toISOString().slice(0, 10)}.json`));
  writeFileSync(out, JSON.stringify({ ...result, itemIds: result.labels.map((l) => l.itemId), labels: undefined, checkedAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(JSON.stringify({ wrote: path.relative(root, out), ok: result.ok, errors: result.errors.slice(0, 10), labelled: result.labelled, total: result.total, agreement: result.agreement, disagreements: result.disagreements.length }, null, 1));
  if (!result.ok) process.exit(1);
} else if (command === "sync-resident") {
  const file = path.join(root, "docs/evidence/INTERPRETER_V3_GOLD_ADJUDICATION.json");
  const result = syncResidentRows({ adjudication: read(file), turns: residentTurns() });
  writeFileSync(file, JSON.stringify(result.adjudication, null, 2) + "\n");
  console.log(JSON.stringify({ added: result.added, total: Object.keys(result.adjudication.rows).length }, null, 1));
} else if (command === "apply") {
  const file = path.join(root, "docs/evidence/INTERPRETER_V3_GOLD_ADJUDICATION.json");
  const decisions = read(arg("--decisions"));
  const draftById = Object.fromEntries(v3Corpus().map((row) => [row.id, row.gold]));
  const result = applyDecisions({ adjudication: read(file), decisions, draftById, vocabulary, allowRevision: flag("--allow-revision") });
  if (result.errors.length) { console.error(JSON.stringify({ applied: false, errors: result.errors }, null, 1)); process.exit(1); }
  writeFileSync(file, JSON.stringify(result.adjudication, null, 2) + "\n");
  console.log(JSON.stringify({ applied: true, decided: result.decided, total: result.total, status: result.adjudication.status }, null, 1));
} else {
  console.error("usage: goldReviewCli.mjs packet|check|sync-resident|apply ...");
  process.exit(2);
}
