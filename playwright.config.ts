import { defineConfig, devices } from "@playwright/test";

// Browser UI tests for RoadSalt. Run with `npm run test:ui`.
// They hit the real public services (Photon, Open-Meteo, NWS, IEM, TomTom),
// so they run one at a time to stay polite.
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e/report", open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Reuse a dev server you already started; Next 16 allows only one per project.
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
