/**
 * Text helpers shared by the interpreter layer.
 *
 * Cyrillic note: `\w` and `\b` never match Cyrillic in a non-unicode JS regex,
 * so word boundaries here are computed with the Unicode property classes
 * `\p{L}` / `\p{N}` under the `u` flag, never with `\b`.
 */
export function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\u00a0/g, " ").replace(/\s+/g, " ");
}

export function containsAny(text, anchors) {
  return anchors.some((anchor) => text.includes(normalizeText(anchor)));
}

/**
 * Conservative tolerance for a one-character typo in a single clinical-workflow
 * word. It is used only to establish the KIND of action, never to choose a
 * drug, test, dose, route, destination, or other clinical parameter.
 */
export function containsNearToken(text, anchors) {
  const tokens = tokenize(text);
  return anchors.some((rawAnchor) => {
    const anchor = normalizeText(rawAnchor);
    if (anchor.length < 6 || anchor.includes(" ")) return false;
    return tokens.some((token) => token.length >= 6 && token.slice(0, 3) === anchor.slice(0, 3)
      && Math.abs(token.length - anchor.length) <= 1 && editDistanceAtMostOne(token, anchor));
  });
}

function editDistanceAtMostOne(left, right) {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) i += 1;
    else if (right.length > left.length) j += 1;
    else { i += 1; j += 1; }
  }
  if (i < left.length || j < right.length) edits += 1;
  return edits <= 1;
}

/**
 * Is `span` the learner's own words? A verbatim substring, or the same words in
 * the same order differing only in punctuation or spacing (a model that drops a
 * comma has not changed what the learner said).
 */
export function containsNormalized(text, span) {
  const normalized = normalizeText(span);
  if (!normalized) return false;
  if (normalizeText(text).includes(normalized)) return true;
  return locateSpan(tokenize(text), span) !== null;
}

// Literal parameters, units, prepositions of time/route, courtesy and address:
// words that carry no clinical content of their own.
export const NEUTRAL_TOKEN = /^(?:\d+(?:[.,]\d+)?|мг|мкг|г|мл|ml|mg|iv|im|po|в|м|к|п|на|по|за|через|каждые|час|часа|часов|ч|мин|минут|минуты|минуту|и|плюс|пожалуйста|коллеги|уважаемые|дорогие|доктор|сестра|медсестра|прошу|будьте|добры|спасибо|итак|так)$/;

/** Words of `text` that are not neutral: what is left when address, courtesy and literal parameters are removed. */
export function substantiveTokens(text) {
  return tokenize(text).filter((token) => !NEUTRAL_TOKEN.test(token));
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const CYRILLIC_LETTER = /[а-яё]/;
/** Phrases this long are treated as stems that may carry a Russian inflectional ending. */
export const STEM_MATCH_MIN_LENGTH = 5;

/**
 * Whole-word phrase match on normalized text. Short entries (abbreviations such
 * as "кт") must match a whole word - "кт" must never be found inside
 * "аппендэктомию" - while entries of five characters or more may carry an ending.
 */
export function containsWholePhrase(text, phrase) {
  const needle = normalizeText(phrase);
  if (!needle) return false;
  const inflects = needle.length >= STEM_MATCH_MIN_LENGTH;
  let index = text.indexOf(needle);
  while (index !== -1) {
    const before = index === 0 ? "" : text[index - 1];
    const after = text[index + needle.length] ?? "";
    const boundedLeft = before === "" || !WORD_CHAR.test(before);
    const boundedRight = after === "" || !WORD_CHAR.test(after) || (inflects && CYRILLIC_LETTER.test(after));
    if (boundedLeft && boundedRight) return true;
    index = text.indexOf(needle, index + 1);
  }
  return false;
}

/** Word tokens (letters/digits) of the normalized text, in order. */
export function tokenize(text) {
  return [...normalizeText(text).matchAll(/[\p{L}\p{N}]+/gu)].map((match) => match[0]);
}

/**
 * Token range [start, end) of the first verbatim occurrence of `span` in
 * `rawTokens`, or null when the span is empty or not present.
 */
export function locateSpan(rawTokens, span) {
  const wanted = tokenize(span);
  if (wanted.length === 0 || wanted.length > rawTokens.length) return null;
  for (let start = 0; start + wanted.length <= rawTokens.length; start += 1) {
    if (wanted.every((token, offset) => rawTokens[start + offset] === token)) return [start, start + wanted.length];
  }
  return null;
}

/**
 * Ranges covered by a list of span strings. A span that is not found verbatim
 * is retried piecewise on ", " (merged deterministic commands join fragments
 * with that separator). Returns null when nothing can be located, which callers
 * treat as "unknown extent", never as "no overlap".
 */
export function locateRanges(rawTokens, spans) {
  const ranges = [];
  for (const span of spans) {
    const whole = locateSpan(rawTokens, span);
    if (whole) { ranges.push(whole); continue; }
    for (const piece of String(span ?? "").split(", ")) {
      const found = piece ? locateSpan(rawTokens, piece) : null;
      if (found) ranges.push(found);
    }
  }
  return ranges.length ? ranges : null;
}

export function rangesOverlap(a, b) {
  return a.some(([aStart, aEnd]) => b.some(([bStart, bEnd]) => aStart < bEnd && bStart < aEnd));
}

export function coversAll(ranges, tokenCount) {
  const covered = new Set();
  for (const [start, end] of ranges) for (let i = start; i < end; i += 1) covered.add(i);
  return tokenCount > 0 && covered.size >= tokenCount;
}
