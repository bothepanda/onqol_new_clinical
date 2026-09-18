import process from "node:process";
import { MODEL_CATALOG, WAVE23_HISTORICAL_MODELS } from "../src/ai/modelConfig.js";

const OFFICIAL_STANDARD_PRICING_2026_08_29 = MODEL_CATALOG;

export function wave23ModelConfigurations(env = process.env) {
  if (env.ONQOL_WAVE23_CONFIG_JSON) {
    const parsed = JSON.parse(env.ONQOL_WAVE23_CONFIG_JSON);
    if (!Array.isArray(parsed) || parsed.length < 3) throw new Error("ONQOL_WAVE23_CONFIG_JSON must contain at least three model configurations");
    return parsed.map(validateConfiguration);
  }
  return WAVE23_HISTORICAL_MODELS.map((config) => defaultConfig(config.id,
    env[`ONQOL_WAVE23_${config.id}`] ?? config.model,
    env[`ONQOL_WAVE23_EFFORT_${config.id.at(-1)}`] ?? config.reasoningEffort,
    { ...env, ONQOL_WAVE23_ENDPOINT_MODE: env.ONQOL_WAVE23_ENDPOINT_MODE ?? config.endpointMode }));
}

function defaultConfig(id, model, reasoningEffort, env) {
  return validateConfiguration({
    id,
    provider: "openai",
    endpointMode: env.ONQOL_WAVE23_ENDPOINT_MODE,
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
