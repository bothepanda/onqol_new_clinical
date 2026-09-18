/**
 * Provider-neutral LLM seam.
 *
 * Every AI task (`ai/tasks/*.js`) calls a `ProviderClient`, never a specific
 * vendor SDK. Swapping OpenAI for another vendor, or for a self-hosted model,
 * is a new file that satisfies this interface - Core Runtime Spec §66:
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
import { INTERPRETER_BUDGET } from "./modelConfig.js";

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

export function createGatewayProviderClient({ fetchImpl = globalThis.fetch, endpoint = "/api/ai/interpreter", timeoutMs = INTERPRETER_BUDGET.providerMs, sessionId = "unscoped", onUnavailable = () => {} } = {}) {
  return {
    isConfigured: true,
    async complete(request) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: request.messages, responseFormat: request.responseFormat, sessionId }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          const allowed = new Set(["no_provider_configured", "rate_limited", "provider_auth", "provider_quota", "provider_timeout", "provider_error"]);
          const error = new Error(`gateway_${response.status}`);
          error.code = response.status === 404 ? "gateway_unavailable" : allowed.has(body.error) ? body.error : response.status === 501 ? "no_provider_configured" : "provider_error";
          throw error;
        }
        const data = await response.json();
        return {
          text: data.choices?.[0]?.message?.content,
          meta: { model: data.model ?? null, requestId: response.headers?.get?.("x-request-id") ?? null, usage: data.usage ?? null, costUsd: data.costUsd ?? null },
        };
      } catch (error) {
        const failure = error.name === "AbortError"
          ? Object.assign(new Error("provider_timeout"), { code: "provider_timeout" }) : error;
        onUnavailable({ code: failure.code ?? "gateway_unavailable" });
        throw failure;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
