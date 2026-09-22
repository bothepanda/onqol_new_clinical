import { normalizeText, tokenize } from "./textMatch.js";

/**
 * The ONE segmentation of a learner turn into clauses.
 *
 * Before this module the deterministic pass and the commitment gate each cut the turn
 * their own way (one kept «0.9%» whole, the other did not; one split at spaced dashes, the
 * other did not), so a command's «fragment» and the gate's «fragment» were not the same
 * thing and the gate had to re-locate every command by token range. A clause is now
 * defined once, here, and both read it:
 *
 *   - commas (never inside a number), «;», «+», a spaced dash, and the conjunctions
 *     «и» / «плюс» separate clauses inside a sentence;
 *   - `.`, `!`, `?`, `…` (only before whitespace, so «0.9%» and «т.е.» stay whole) and a
 *     newline end a sentence.
 *
 * Each clause records the two sentence notions the callers need: `sentence` (the scope of a
 * hedge / condition / deferral cue - it also ends at «;») and `group` (the unit inside which
 * duplicate investigation orders are merged - a sentence in the strict sense). `range` is the
 * clause's token range over `tokenize(rawText)`, so a clause and a model evidence span can be
 * compared without string search.
 *
 * Pure. No policy: commitment, channel and resolution are decided by the callers.
 */
export const CLAUSE_CHANNEL = Object.freeze({
  CLINICAL_ACTION: "clinical_action",
  PATIENT_QUESTION: "patient_question",
  CLINICAL_REASONING: "clinical_reasoning",
  MENTOR_ANSWER: "mentor_answer",
  CONVERSATION_MANAGEMENT: "conversation_management",
  UNRESOLVED: "unresolved",
});

const SEPARATOR = /(?<terminator>[.!?…]+(?=\s|$))|(?<newline>\n+)|(?<semicolon>;)|(?<comma>(?<!\d),|,(?!\d))|(?<plus>\+)|(?<dash>\s[-–—]\s)|(?<word>(?:^|\s)(?:и|плюс)(?=\s))/giu;

/** A bare list marker («1.», «2.») numbers an answer; it is not a clause. */
const LIST_MARKER = /^\d{1,2}$/;

/**
 * @param {string} rawText
 * @returns {{index: number, id: string, raw: string, text: string, terminator: string|null, sentence: number, group: number, range: [number, number]}[]}
 */
export function segmentClauses(rawText) {
  const source = String(rawText ?? "");
  const pieces = [];
  let last = 0;
  let sentence = 0;
  let group = 0;
  const push = (slice, terminator, gapTokens, kind) => {
    pieces.push({ slice, terminator, sentence, group, gapTokens });
    if (kind === "terminator" || kind === "newline") { sentence += 1; group += 1; }
    else if (kind === "semicolon") sentence += 1;
  };
  let match;
  SEPARATOR.lastIndex = 0;
  while ((match = SEPARATOR.exec(source)) !== null) {
    const kind = Object.entries(match.groups).find(([, value]) => value !== undefined)?.[0];
    const terminator = kind === "terminator" || kind === "semicolon" ? match[0].trim()[0] : kind === "newline" ? "\n" : null;
    push(source.slice(last, match.index), terminator, kind === "word" ? tokenize(match[0]).length : 0, kind);
    last = match.index + match[0].length;
  }
  push(source.slice(last), null, 0, "end");

  let cursor = 0;
  const clauses = [];
  for (const piece of pieces) {
    const count = tokenize(piece.slice).length;
    const text = normalizeText(piece.slice);
    const isMarker = LIST_MARKER.test(text) && piece.terminator === ".";
    if (count > 0 && /[\p{L}\p{N}]/u.test(text) && !isMarker) {
      const index = clauses.length;
      clauses.push({ index, id: `k${index}`, raw: piece.slice.trim(), text, terminator: piece.terminator, sentence: piece.sentence, group: piece.group, range: [cursor, cursor + count] });
    }
    cursor += count + piece.gapTokens;
  }
  return clauses;
}

/** Clauses grouped by strict sentence, in order: the unit inside which duplicate orders are merged. */
export function clausesByGroup(clauses) {
  const groups = new Map();
  for (const clause of clauses) groups.set(clause.group, [...(groups.get(clause.group) ?? []), clause]);
  return [...groups.keys()].sort((a, b) => a - b).map((key) => groups.get(key));
}
