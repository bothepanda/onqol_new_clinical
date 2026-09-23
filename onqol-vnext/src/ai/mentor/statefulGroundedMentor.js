/**
 * Stateful Grounded Mentor Wave A - the orchestrator that ties card
 * retrieval, the existing propose-then-verify pipeline, and the bounded
 * regeneration together (ТЗ §17-19). Provider-injected, like
 * `groundedDialogue.js` itself, so it is fully testable with a fake provider
 * and callable identically from a server gateway or from a test.
 */
import { runGroundedDialogue } from "./groundedDialogue.js";
import { selectCardsForIssue } from "./cardRetrieval.js";

/**
 * @param {object} args
 * @param {object} args.provider                  a ProviderClient (see providerClient.js)
 * @param {object} args.context                    `{casePresetId, sessionPurpose, locale, text, history, facts, historyTruncated}` - same shape `groundedDialogue.validateContext` expects
 * @param {string|null} args.issueId                the deterministic engine's current issue, for card scoping (cardRetrieval.js)
 * @param {object|null} [args.visibleState]         `buildRetrievalView(learnerVisible)` - what card conditions may read
 * @param {string[]} [args.concepts]                concepts of the active teaching issue
 * @param {object} args.library                     the full approved card library
 * @param {number} [args.timeoutMs]
 * @param {string|null} [args.deterministicFallbackText]  `mentorEngine.js`'s own reviewed text for this decision - the "verified safety fallback" ТЗ §5/§19 explicitly still allow deterministic authorship for
 */
export async function renderGroundedMentorText({ provider, context, issueId, library, visibleState = null, concepts = [], timeoutMs, deterministicFallbackText = null }) {
  const scopedLibrary = { ...library, cards: selectCardsForIssue({ issueId, learnerText: context.text, library, visibleState, concepts, casePresetId: context.casePresetId }) };
  const result = await runGroundedDialogue({ provider, context, library: scopedLibrary, timeoutMs, maxRegenerations: 1 });
  if (result.audit.status === "accepted") return result;
  // Bounded regeneration (inside runGroundedDialogue) already failed once and
  // fell back on its own; here the fallback text is swapped for the
  // deterministic engine's own reviewed sentence when one is available,
  // rather than the generic "unverifiable" string - a resident who committed
  // to a real operative plan should not see a shrug where a reviewed
  // teaching point already exists.
  return { text: deterministicFallbackText ?? result.text, question: null, audit: result.audit };
}
