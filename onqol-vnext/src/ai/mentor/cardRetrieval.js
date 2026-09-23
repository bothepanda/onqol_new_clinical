/**
 * Card retrieval for the stateful grounded mentor - content-driven.
 *
 * Nothing here knows a disease. A card declares, in its own metadata, when it
 * is relevant:
 *
 *   retrieval.issue_ids            teaching issue / rule ids it serves
 *   retrieval.learner_text_patterns  regex sources matched against the learner's words
 *   concepts                        concept ids (matched against the active issue's concepts)
 *   applies_when                    content conditions over the LEARNER-VISIBLE state
 *   exceptions_when                 content conditions that exclude the card
 *   case_scope                      optional narrowing to specific case presets
 *   allowed_uses.mentor_teaching    must not be false
 *
 * The retrieval question is: active case + current teaching issue +
 * learner-visible state + what the learner just said -> the small subset of
 * APPROVED cards the grounded renderer may draw on. It is deliberately not a
 * search engine: a card matching nothing is not offered, and the fallback is
 * only the pedagogical cards (no clinical statement at all).
 *
 * Governance: only `approved_for_training` cards with a recorded reviewer are
 * ever candidates. A draft / pending_review / deprecated card can match every
 * signal above and is still never returned.
 */
import { evaluateContentCondition } from "../../core/rules/contentConditions.js";

const DEFAULT_LIMIT = 4;
const SCORE = Object.freeze({ issue: 4, concept: 3, text: 1 });

export function isRetrievable(card, { casePresetId = null } = {}) {
  if (card.review_status !== "approved_for_training" || !card.reviewed_by?.length) return false;
  if (card.allowed_uses && card.allowed_uses.mentor_teaching === false) return false;
  if (Array.isArray(card.case_scope) && casePresetId && !card.case_scope.includes(casePresetId)) return false;
  return true;
}

const conditionsHold = (conditions, view) =>
  !Array.isArray(conditions) || conditions.length === 0 || (view != null && conditions.every((c) => evaluateContentCondition(c, view) === true));

/**
 * @param {object} args
 * @param {string|null} args.issueId         the deterministic engine's current issue (or rule) id
 * @param {string} args.learnerText          the learner's current turn
 * @param {object} args.library              an approved card library
 * @param {object|null} [args.visibleState]  `buildLearnerVisibleState(...)` - never `state.truth`
 * @param {string[]} [args.concepts]         concepts of the active teaching issue
 * @param {string|null} [args.casePresetId]
 * @returns {object[]} the bounded, approved-only card subset
 */
export function selectCardsForIssue({ issueId, learnerText, library, visibleState = null, concepts = [], casePresetId = null }) {
  const approved = library.cards.filter((card) => isRetrievable(card, { casePresetId }));
  const text = learnerText ?? "";
  const scored = [];
  for (const card of approved) {
    if (card.kind === "pedagogical") continue;
    let score = 0;
    if (issueId && card.retrieval?.issue_ids?.includes(issueId)) score += SCORE.issue;
    if (concepts.length && card.concepts?.some((concept) => concepts.includes(concept))) score += SCORE.concept;
    if (card.retrieval?.learner_text_patterns?.some((source) => new RegExp(source, "iu").test(text))) score += SCORE.text;
    if (score === 0) continue;
    if (!conditionsHold(card.applies_when, visibleState)) continue;
    if (Array.isArray(card.exceptions_when) && card.exceptions_when.length && conditionsHold(card.exceptions_when, visibleState)) continue;
    scored.push({ card, score });
  }
  scored.sort((a, b) => b.score - a.score || String(a.card.id).localeCompare(String(b.card.id)));
  const limit = library.retrieval_limit ?? DEFAULT_LIMIT;
  const selected = scored.slice(0, limit).map((entry) => entry.card);
  // Nothing matched: offer only the pedagogical cards (no clinical statement),
  // never the full library.
  if (!selected.length) return approved.filter((card) => card.kind === "pedagogical");
  return selected;
}

/**
 * The small, learner-visible slice of state a card's `applies_when` /
 * `exceptions_when` conditions may read. Built from
 * `buildLearnerVisibleState` only, so it can be sent to the server-side
 * mentor without carrying anything the learner has not been shown.
 */
export function buildRetrievalView(learnerVisible) {
  return {
    physiologyKnownAt: learnerVisible?.physiologyKnownAt ?? null,
    clock: { elapsedMinutes: learnerVisible?.clock?.elapsedMinutes ?? null },
    mentor: {
      scaffolding: learnerVisible?.mentor?.scaffolding ?? 0,
      probingStreak: learnerVisible?.mentor?.probingStreak ?? 0,
    },
  };
}
