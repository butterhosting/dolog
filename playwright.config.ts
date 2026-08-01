import { defineConfig, devices } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.test-results",
  timeout: 10_000,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [["html", { outputFolder: "./e2e/.playwright-report", open: "never" }]],
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 0 : 0,
  /* Opt out of parallel tests on CI. */
  workers: 1,
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: "http://localhost:3000",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Build and start the production image before running tests */
  webServer: {
    command: [
      "mkdir -p opt",
      "./dolog image create --stage e2e",
      process.env.CI
        ? `HOST_UID=${process.getuid!()} HOST_GID=${process.getgid!()} docker compose -f compose-e2e.yaml up`
        : "docker compose -f compose-e2e.yaml up",
    ].join(" && "),
    stdout: "pipe",
    url: "http://localhost:3000",
    /* A cold docker build (no layer cache) takes well over the 60s default */
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 3000,
    },
  },
});
