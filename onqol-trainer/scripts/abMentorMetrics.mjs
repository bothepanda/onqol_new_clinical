/** Pure text metrics used by the mentor A/B harness. */

function engineBlocks(turn) {
  const text = turn?.engineReply ?? turn?.reply ?? "";
  return String(text)
    .split(/\n\s*\n/gu)
    .map((block) => block.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

/**
 * Exact engine paragraphs repeated on a later turn (or twice on one turn).
 * Mentor text is excluded whenever the harness has already split it out.
 */
export function repeatedEngineBlocks(turns = []) {
  const seen = new Map();
  const repeats = [];
  for (const [index, turn] of turns.entries()) {
    for (const block of engineBlocks(turn)) {
      if (seen.has(block)) {
        repeats.push({ block, first: seen.get(block), again: index + 1 });
      } else {
        seen.set(block, index + 1);
      }
    }
  }
  return repeats;
}
