import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createV1Gateway } from "./server/v1Gateway.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const gateway = createV1Gateway({
    apiKey: env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    accessToken: env.ONQOL_V1_ACCESS_TOKEN || process.env.ONQOL_V1_ACCESS_TOKEN,
    model: env.ANTHROPIC_V1_MODEL || process.env.ANTHROPIC_V1_MODEL,
    allowedOrigin: env.ONQOL_V1_ALLOWED_ORIGIN || process.env.ONQOL_V1_ALLOWED_ORIGIN,
  });

  return {
    plugins: [
      react(),
      {
        name: "onqol-v1-anthropic-gateway",
        configureServer(server) {
          server.middlewares.use(gateway);
        },
      },
    ],
  };
});
