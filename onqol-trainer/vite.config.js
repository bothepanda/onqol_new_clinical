import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createOpenAIGateway } from "./server/openaiGateway.mjs";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const gateway = createOpenAIGateway({
    apiKey: env.OPENAI_API_KEY || process.env.OPENAI_API_KEY,
    routerModel: env.OPENAI_ROUTER_MODEL || process.env.OPENAI_ROUTER_MODEL,
    simulatorModel: env.OPENAI_SIMULATOR_MODEL || process.env.OPENAI_SIMULATOR_MODEL,
    mentorModel: env.OPENAI_MENTOR_MODEL || process.env.OPENAI_MENTOR_MODEL,
    accessToken: env.ONQOL_MAIN_ACCESS_TOKEN || process.env.ONQOL_MAIN_ACCESS_TOKEN,
    allowedOrigin: env.ONQOL_MAIN_ALLOWED_ORIGIN || process.env.ONQOL_MAIN_ALLOWED_ORIGIN,
  });

  return {
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              {
                name: "clinical-runtime",
                test: /src[\\/]clinical[\\/]/,
              },
            ],
          },
        },
      },
    },
    plugins: [
      react(),
      {
        name: "onqol-openai-gateway",
        configureServer(server) {
          server.middlewares.use(gateway);
        },
      },
    ],
  };
});
