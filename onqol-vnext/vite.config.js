import process from "node:process";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createAiGateway } from "./server/aiGateway.mjs";

// The gateway is mounted as dev middleware so a developer running `npm run dev`
// gets the same server-side key boundary the deployed app has: the browser
// bundle never receives a provider key, and every model call leaves from node.
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };
  const gateway = createAiGateway({ env });

  return {
    plugins: [
      react(),
      {
        name: "onqol-ai-gateway",
        configureServer(server) {
          server.middlewares.use(gateway);
        },
      },
    ],
    build: {
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              // Clinical content and the rules that read it are the audit
              // surface; keeping them in their own chunk means a content
              // release is visible as a changed chunk.
              { name: "clinical-content", test: /src[\\/]content[\\/]/ },
              { name: "clinical-core", test: /src[\\/]core[\\/]/ },
            ],
          },
        },
      },
    },
  };
});
