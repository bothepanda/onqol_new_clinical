// When the read-only donor artifact is present on this machine, every card quote
// must be verbatim in it and the artifact must be the pinned version. The donor
// is only ever READ. (Kept under scripts/, not src/: src/ must not reference the
// legacy runtime - see core/architecture.test.js.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { sha256 } from "../src/ai/mentor/cardFaithfulness.js";

const DONOR = process.env.ONQOL_FLUIDS_SOURCE ?? "/Users/botagozkaukenova/onqol-trainer/onqol-trainer/cases/2026-09-25-fluids-01.md";
const library = JSON.parse(readFileSync(new URL("../src/content/mentor/fluids01-library.json", import.meta.url), "utf8"));

test("every fluids card quote is verbatim in the pinned read-only source", { skip: !existsSync(DONOR) && "donor artifact not present on this machine" }, () => {
  const source = readFileSync(DONOR, "utf8");
  assert.equal(sha256(source), library.sources.find((s) => s.source_id === "FLU-CASE-V1.2").sha256);
  for (const card of library.cards) for (const quote of card.source_quotes) assert.ok(source.includes(quote), `${card.id}: ${quote.slice(0, 50)}`);
});
