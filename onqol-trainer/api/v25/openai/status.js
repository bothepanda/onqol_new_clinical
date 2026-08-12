import process from "node:process";
import { createOpenAIGateway } from "../../../server/openaiGateway.mjs";

const gateway = createOpenAIGateway({
  apiKey: process.env.OPENAI_API_KEY,
  routerModel: process.env.OPENAI_ROUTER_MODEL,
  simulatorModel: process.env.OPENAI_SIMULATOR_MODEL,
  mentorModel: process.env.OPENAI_MENTOR_MODEL,
  accessToken: process.env.ONQOL_MAIN_ACCESS_TOKEN,
  allowedOrigin: process.env.ONQOL_MAIN_ALLOWED_ORIGIN,
  requireAccessControl: true,
});

export default async function handler(req, res) {
  return gateway(req, res);
}
