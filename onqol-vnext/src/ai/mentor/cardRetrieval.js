/**
 * Stateful Grounded Mentor Wave A - narrow card retrieval (ТЗ §16).
 *
 * Deliberately NOT a general retriever: the appendicitis library
 * (`content/mentor/app004-library.json`) has 7 approved cards, and this
 * module's only job is to bound the subset offered to the grounded renderer
 * to the ones plausibly relevant to the CURRENT issue, so the mentor cannot
 * reach for a card about an unrelated topic and stretch it to fit. If a
 * second disease bundle needs this, the map below is what grows - not a new
 * retrieval architecture (§25 explicitly excludes all-book RAG here).
 */

// issueId (from mentorEngine.js's openQuestion.issueId, or a rule id) -> card
// ids plausibly relevant to it. Hand-authored, reviewed alongside the library
// itself - adding a card id here does not change its `review_status`.
const ISSUE_CARD_MAP = {
  open_approach_rationale: ["K05"],
  preop_preparation: [],
};

// Fallback: when the issue isn't in the table above (an approved-rule
// challenge, or a free-form discussion issue), match cards by keyword against
// the learner's own words - still bounded to the approved library, never to
// "all cards regardless of relevance".
const KEYWORD_CARDS = [
  { pattern: /миграц|переход.*боли|около.*пуп/iu, cardId: "K01" },
  { pattern: /призна[кц]|симптом|осмотр/iu, cardId: "K02" },
  { pattern: /лейкоцит|crp|соэ|анализ\s+крови/iu, cardId: "K03" },
  { pattern: /моч[аи]|пиури/iu, cardId: "K04" },
  { pattern: /дифференциал|альтернатив/iu, cardId: "K05" },
  { pattern: /узи|ультразвук/iu, cardId: "K06" },
  { pattern: /зачем.*исследован|зачем.*анализ|какой смысл/iu, cardId: "K12" },
];

/**
 * @param {object} args
 * @param {string|null} args.issueId
 * @param {string} args.learnerText  the learner's current turn text, for the keyword fallback
 * @param {object} args.library      the approved card library (app004-library.json shape)
 * @returns {object[]} the bounded, still-approved-only card subset
 */
export function selectCardsForIssue({ issueId, learnerText, library }) {
  const approved = library.cards.filter((card) => card.review_status === "approved_for_training");
  const byMap = new Set(issueId ? ISSUE_CARD_MAP[issueId] ?? [] : []);
  const text = learnerText ?? "";
  for (const { pattern, cardId } of KEYWORD_CARDS) {
    if (pattern.test(text)) byMap.add(cardId);
  }
  const selected = approved.filter((card) => byMap.has(card.id));
  // No match: offer only the pedagogical card (K12), never the full library -
  // it can still ask a focused, grounded question with no clinical statement.
  if (!selected.length) return approved.filter((card) => card.kind === "pedagogical");
  return selected;
}
