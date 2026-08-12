import { createV1Gateway } from "../server/v1Gateway.mjs";

const gateway = createV1Gateway({
  apiKey: process.env.ANTHROPIC_API_KEY,
  accessToken: process.env.ONQOL_V1_ACCESS_TOKEN,
  model: process.env.ANTHROPIC_V1_MODEL,
  allowedOrigin: process.env.ONQOL_V1_ALLOWED_ORIGIN,
});

export default async function handler(req, res) {
  return gateway(req, res);
}
