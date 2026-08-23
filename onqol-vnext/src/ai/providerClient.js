/**
 * Provider-neutral LLM seam.
 *
 * Every AI task (`ai/tasks/*.js`) calls a `ProviderClient`, never a specific
 * vendor SDK. Swapping OpenAI for another vendor, or for a self-hosted model,
 * is a new file that satisfies this interface - Core Foundation Spec §66:
 * "the model is an interpreter and renderer, not the clinical engine", so
 * nothing about patient logic, rules, or replay may ever import from here.
 *
 * @typedef {object} ProviderClient
 * @property {(request: CompletionRequest) => Promise<CompletionResult>} complete
 */

/**
 * A client that never calls out to a network. It exists so the domain and UI
 * can run, and the full behavioral test suite can pass, with no API key
 * configured - and so `ai/tasks/*` have one deterministic backend to be
 * tested against. `server/aiGateway.mjs` selects a real provider when a key
 * is present; this is the default otherwise, not a placeholder to delete
 * later. See docs/KNOWN_GAPS.md for what a real provider adds on top of it.
 */
export function createNullProviderClient() {
  return {
    async complete() {
      throw new Error(
        "createNullProviderClient() cannot serve a completion; this task must be handled by its deterministic fallback path.",
      );
    },
    isConfigured: false,
  };
}
