import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: { baseURL: "http://127.0.0.1:4174", headless: true },
  webServer: {
    // Existing contract suite exercises the explicit offline rollback. The
    // default semantic-first UI has its own provider-fixture integration suite.
    command: "VITE_ONQOL_INTERPRETER=deterministic npm run dev -- --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
