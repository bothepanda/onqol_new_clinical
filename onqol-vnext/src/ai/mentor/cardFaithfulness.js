/**
 * Proving a clinical card is a faithful extraction of its approved source.
 *
 * A card is authored as: verbatim `source_quotes` from the approved artifact
 * plus a `statement` that may only rearrange them. Three things are machine-
 * checked, so a decomposition cannot quietly introduce a new threshold, dose,
 * timing, indication or interpretation:
 *
 *   1. quote_in_source     every quote is a verbatim substring of the artifact
 *                          (when the artifact is available; its sha256 is pinned)
 *   2. numbers_from_quotes every number in the statement appears in a quote
 *   3. terms_accounted_for every content stem in the statement that is NOT in a
 *                          quote must be declared in the card's `glue_terms` -
 *                          so any word the author added is visible in review,
 *                          and a paraphrase that drifts adds an undeclared term
 *
 * (3) is a review aid, not a semantic proof: a declared glue term is a claim
 * the reviewer accepts. Semantic equivalence stays a human judgement; this
 * makes every place it could differ explicit and reproducible.
 */
import { createHash } from "node:crypto";

const NUMBER = /\d+(?:[.,]\d+)?/g;
export const numbersIn = (text) => (String(text).match(NUMBER) ?? []).map((n) => n.replace(",", "."));
export const stemsOf = (text) => new Set((String(text).toLowerCase().match(/[а-яёa-z]{4,}/g) ?? []).map((w) => w.slice(0, 5)));
export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function checkCardFaithfulness(card, sourceText = null) {
  const quotes = card.source_quotes ?? [];
  const quoteNumbers = new Set(quotes.flatMap(numbersIn));
  const quoteStems = new Set(quotes.flatMap((q) => [...stemsOf(q)]));
  const glueStems = new Set((card.glue_terms ?? []).flatMap((term) => [...stemsOf(term)]));
  const newNumbers = numbersIn(card.statement).filter((n) => !quoteNumbers.has(n));
  const unexplainedTerms = [...stemsOf(card.statement)].filter((stem) => !quoteStems.has(stem) && !glueStems.has(stem));
  const quotesFound = sourceText == null ? null : quotes.every((q) => sourceText.includes(q));
  return {
    id: card.id,
    hasQuotes: quotes.length > 0,
    quotesFound,
    newNumbers,
    unexplainedTerms,
    ok: quotes.length > 0 && newNumbers.length === 0 && unexplainedTerms.length === 0 && quotesFound !== false,
    statementSha256: sha256(card.statement),
    quotesSha256: sha256(quotes.join("\n")),
  };
}

export function buildFaithfulnessEvidence(library, sourceText) {
  const source = library.sources.find((s) => s.source_id === "FLU-CASE-V1.2") ?? library.sources[0];
  return {
    libraryId: library.id,
    sourceId: source.source_id,
    sourceSha256Pinned: source.sha256,
    sourceSha256Observed: sourceText == null ? null : sha256(sourceText),
    cards: library.cards.map((card) => checkCardFaithfulness(card, sourceText)),
  };
}
