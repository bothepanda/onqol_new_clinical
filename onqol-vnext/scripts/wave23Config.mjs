import process from "node:process";

const OFFICIAL_STANDARD_PRICING_2026_08_29 = Object.freeze({
  "gpt-5.6-luna": Object.freeze({ inputPerMillionUsd: 0.20, outputPerMillionUsd: 1.20 }),
  "gpt-5.6-terra": Object.freeze({ inputPerMillionUsd: 2.00, outputPerMillionUsd: 12.00 }),
  "gpt-5.6-sol": Object.freeze({ inputPerMillionUsd: 4.00, outputPerMillionUsd: 20.00 }),
});

export function wave23ModelConfigurations(env = process.env) {
  if (env.ONQOL_WAVE23_CONFIG_JSON) {
    const parsed = JSON.parse(env.ONQOL_WAVE23_CONFIG_JSON);
    if (!Array.isArray(parsed) || parsed.length < 3) throw new Error("ONQOL_WAVE23_CONFIG_JSON must contain at least three model configurations");
    return parsed.map(validateConfiguration);
  }
  return [
    defaultConfig("MODEL_A", env.ONQOL_WAVE23_MODEL_A ?? "gpt-5.6-luna", env.ONQOL_WAVE23_EFFORT_A ?? "low", env),
    defaultConfig("MODEL_B", env.ONQOL_WAVE23_MODEL_B ?? "gpt-5.6-terra", env.ONQOL_WAVE23_EFFORT_B ?? "low", env),
    defaultConfig("MODEL_C", env.ONQOL_WAVE23_MODEL_C ?? "gpt-5.6-sol", env.ONQOL_WAVE23_EFFORT_C ?? "low", env),
  ];
}

function defaultConfig(id, model, reasoningEffort, env) {
  return validateConfiguration({
    id,
    provider: "openai",
    endpointMode: env.ONQOL_WAVE23_ENDPOINT_MODE ?? "responses",
    model,
    reasoningEffort,
    temperature: null,
    serviceTier: env.ONQOL_WAVE23_SERVICE_TIER ?? "default",
    pricing: OFFICIAL_STANDARD_PRICING_2026_08_29[model] ?? {
      inputPerMillionUsd: Number(env[`ONQOL_WAVE23_${id}_INPUT_PER_MILLION_USD`] ?? 0),
      outputPerMillionUsd: Number(env[`ONQOL_WAVE23_${id}_OUTPUT_PER_MILLION_USD`] ?? 0),
    },
  });
}

function validateConfiguration(config) {
  for (const key of ["id", "provider", "endpointMode", "model"]) if (!config?.[key]) throw new Error(`wave23_config_${key}_required`);
  if (!new Set(["responses", "chat_completions"]).has(config.endpointMode)) throw new Error(`wave23_config_endpoint_invalid:${config.endpointMode}`);
  if (!config.pricing || !Number.isFinite(Number(config.pricing.inputPerMillionUsd)) || !Number.isFinite(Number(config.pricing.outputPerMillionUsd))) {
    throw new Error(`wave23_config_pricing_invalid:${config.id}`);
  }
  return Object.freeze({
    id: String(config.id), provider: String(config.provider), endpointMode: String(config.endpointMode), model: String(config.model),
    reasoningEffort: config.reasoningEffort == null ? null : String(config.reasoningEffort),
    temperature: config.temperature == null ? null : Number(config.temperature),
    serviceTier: config.serviceTier == null ? "default" : String(config.serviceTier),
    pricing: Object.freeze({
      inputPerMillionUsd: Number(config.pricing.inputPerMillionUsd),
      outputPerMillionUsd: Number(config.pricing.outputPerMillionUsd),
    }),
  });
}
