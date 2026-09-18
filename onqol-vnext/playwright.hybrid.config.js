import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-hybrid", workers: 1, retries: 0, reporter: "line",
  use: { baseURL: "http://127.0.0.1:4175", headless: true },
  projects: [{ name: "desktop", use: { viewport: { width: 1280, height: 800 } } }, { name: "mobile", use: { viewport: { width: 390, height: 844 } } }],
  webServer: { command: "VITE_ONQOL_INTERPRETER=hybrid VITE_ONQOL_PILOT=true npm run dev -- --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175", reuseExistingServer: false, timeout: 120000 },
});
