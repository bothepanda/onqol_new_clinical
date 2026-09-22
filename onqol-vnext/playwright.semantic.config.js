import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e-semantic", workers: 1, retries: 0, reporter: "line",
  use: { baseURL: "http://127.0.0.1:4177", headless: true },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 850 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "VITE_ONQOL_INTERPRETER=semantic_first VITE_ONQOL_PILOT=false npm run dev:mentor -- --port 4177 --strictPort",
    url: "http://127.0.0.1:4177", reuseExistingServer: false, timeout: 120000,
  },
});
