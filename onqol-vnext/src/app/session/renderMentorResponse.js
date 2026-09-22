/**
 * Stateful Grounded Mentor Wave A - the thin async step `useSession.js` runs
 * AFTER `submitLearnerTurn` when STATEFUL_GROUNDED_MENTOR_V1 is on, to swap
 * the deterministic mentor's fixed wording for grounded, learner-anchored
 * wording. Mirrors `requestMentorDialogue`'s fetch/timeout shape, and reuses
 * its `buildDialogueContext` rather than re-deriving a context shape.
 *
 * `submitLearnerTurn` already recorded `mentor.textRu` in the domain event
 * log (MENTOR_INTERVENED) before this ever runs - this function only decides
 * what to SHOW the learner; it never mutates `session.state`.
 */
import { buildDialogueContext } from "./mentorDialogue.js";

const TIMEOUT_MS = 35000;

/**
 * @param {object} args
 * @param {object} args.session   the session AFTER `submitLearnerTurn` ran this turn (`turn.session`)
 * @param {object} args.mentor    `turn.mentor` - the enriched deterministic decision for this turn
 * @param {Array}  args.messages  prior rendered chat messages, most recent last
 * @param {string} args.text      the learner's raw text this turn
 * @param {Function} [args.fetchImpl]
 * @returns {Promise<null|{text: string, question: object|null, audit: object}>}
 *   null means "nothing to render" - the caller should show the deterministic
 *   `mentor.textRu` (or nothing, if it was null) exactly as it does today.
 */
export async function renderMentorResponse({ session, mentor, messages, text, fetchImpl = globalThis.fetch }) {
  // Safety text and turns with nothing to say are never handed to the LLM
  // renderer (ТЗ §5's exception) - the deterministic string stands as-is.
  if (!mentor?.textRu || mentor.mode === "SAFETY_STOP") return null;

  const context = buildDialogueContext({ session, messages, text });
  const issueId = mentor.openQuestion?.issueId ?? mentor.ruleId ?? null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl("/api/mentor/stateful-response", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: session.sessionId, context, issueId, deterministicFallbackText: mentor.textRu }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`mentor_http_${response.status}`);
    const result = await response.json();
    if (typeof result.text !== "string" || !result.audit || !["accepted", "fallback"].includes(result.audit.status)) throw new Error("invalid_response");
    return result;
  } catch {
    // The gateway itself (network, timeout, malformed response) is
    // unavailable - fall back to the same deterministic sentence
    // `mentorEngine.js` already produced, not the generic "unverifiable"
    // string (that one is reserved for a grounding rejection, which DID
    // reach the verifier and DID get a considered answer).
    return { text: mentor.textRu, question: null, audit: { status: "fallback", errorCode: "gateway_unavailable", calls: [] } };
  } finally {
    clearTimeout(timer);
  }
}
