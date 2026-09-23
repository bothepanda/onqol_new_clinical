#!/usr/bin/env node
// Verifies (and with --write, records) that every card in a mentor library is a
// faithful extraction of its read-only source artifact. The artifact is only
// ever READ. Usage:
//   node scripts/verifyMentorCardFaithfulness.mjs src/content/mentor/fluids01-library.json <source.md> [--write]
import { readFileSync, writeFileSync } from "node:fs";
import { buildFaithfulnessEvidence } from "../src/ai/mentor/cardFaithfulness.js";

const [libraryPath, sourcePath, ...flags] = process.argv.slice(2);
const library = JSON.parse(readFileSync(libraryPath, "utf8"));
const source = readFileSync(sourcePath, "utf8");
const evidence = buildFaithfulnessEvidence(library, source);
const pinned = evidence.sourceSha256Pinned === evidence.sourceSha256Observed;
const failing = evidence.cards.filter((card) => !card.ok);
console.log(`source sha pinned==observed: ${pinned}; cards ${evidence.cards.length}, failing ${failing.length}`);
for (const card of failing) console.log(" FAIL", card.id, JSON.stringify({ quotesFound: card.quotesFound, newNumbers: card.newNumbers, unexplainedTerms: card.unexplainedTerms }));
if (flags.includes("--write")) {
  const out = { ...evidence, verifiedAt: new Date().toISOString().slice(0, 10), sourcePath: "onqol-trainer/onqol-trainer/cases/2026-09-25-fluids-01.md (read-only donor)" };
  writeFileSync(new URL("../docs/evidence/WAVE_B_FLUIDS_CARD_FAITHFULNESS.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
  console.log("evidence written");
}
process.exit(pinned && failing.length === 0 ? 0 : 1);
