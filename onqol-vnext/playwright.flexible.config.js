import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-flexible", workers: 1, retries: 0, reporter: "line",
  use: { baseURL: "http://127.0.0.1:4192", headless: true },
  webServer: { command: "VITE_ONQOL_INTERPRETER=deterministic npm run dev:flexible -- --port 4192", url: "http://127.0.0.1:4192", reuseExistingServer: false, timeout: 120000 },
});
