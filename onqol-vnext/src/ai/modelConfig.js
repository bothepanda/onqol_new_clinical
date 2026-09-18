export const INTERPRETER_BUDGET = Object.freeze({ hybridMs: 8000, providerMs: 7000, gatewayMs: 6000 });

// Source checked 2026-09-08: https://developers.openai.com/api/docs/models/gpt-5-mini
export const MODEL_CATALOG = Object.freeze({
  "gpt-5-mini": { inputPerMillionUsd: 0.25, outputPerMillionUsd: 2 },
  // Historical Wave 2.3 rates are retained only for reproducing its configuration.
  "gpt-5.6-luna": { inputPerMillionUsd: 0.20, outputPerMillionUsd: 1.20 },
  "gpt-5.6-terra": { inputPerMillionUsd: 2, outputPerMillionUsd: 12 },
  "gpt-5.6-sol": { inputPerMillionUsd: 4, outputPerMillionUsd: 20 },
});

export const WAVE23_HISTORICAL_MODELS = Object.freeze([
  { id: "MODEL_A", model: "gpt-5.6-luna", reasoningEffort: "low", endpointMode: "responses" },
  { id: "MODEL_B", model: "gpt-5.6-terra", reasoningEffort: "low", endpointMode: "responses" },
  { id: "MODEL_C", model: "gpt-5.6-sol", reasoningEffort: "low", endpointMode: "responses" },
]);

export function interpreterModelConfig(env = {}) {
  if (env.ONQOL_AI_PROVIDER === "anthropic") {
    const model = env.ONQOL_ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
    if (model !== "claude-haiku-4-5-20251001") throw new Error("model_pricing_not_configured");
    return Object.freeze({ provider: "anthropic", model, endpointMode: "messages",
      endpoint: "https://api.anthropic.com/v1/messages", reasoningEffort: null,
      pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 5 }, maxCompletionTokens: 2048,
      sessionMaxCalls: 40, sessionMaxUsd: 0.25, pilotMaxUsd: 5 });
  }
  if (env.ONQOL_AI_PROVIDER && env.ONQOL_AI_PROVIDER !== "openai") throw new Error("provider_not_configured");
  const model = env.ONQOL_AI_MODEL || "gpt-5-mini";
  const pricing = MODEL_CATALOG[model];
  if (!pricing) throw new Error("model_pricing_not_configured");
  return Object.freeze({ model, endpointMode: "chat_completions",
    endpoint: "https://api.openai.com/v1/chat/completions", reasoningEffort: "minimal",
    pricing, maxCompletionTokens: 2048,
    sessionMaxCalls: 40, sessionMaxUsd: 0.25, pilotMaxUsd: 5,
  });
}

export function completionCost(usage, pricing) {
  if (!Number.isFinite(usage?.prompt_tokens) || !Number.isFinite(usage?.completion_tokens)) return null;
  return (usage.prompt_tokens * pricing.inputPerMillionUsd + usage.completion_tokens * pricing.outputPerMillionUsd) / 1e6;
}
