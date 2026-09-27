// Playwright for apps/web. Adapted from afrikaburn
// (origin/main:e2e/playwright.config.ts). It never starts a server itself:
// scripts/e2e-local.sh brings up Docker Postgres, migrates, serves the app on
// :3000 in E2E test mode and then runs `playwright test`.

import { defineConfig, devices } from "@playwright/test";
import { IS_CI, TIMEOUTS, assertLocalBaseUrl, baseUrl } from "./e2e/lib/env";

// Fail before any spec runs if the target is not this machine.
assertLocalBaseUrl();

const SHARED_CLOCK_SPECS = [
  "**/clock.spec.ts",
  "**/claims.spec.ts",
  "**/weights.spec.ts",
];

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: "./test-results",
  fullyParallel: true,
  // A stray test.only must fail CI, never silently narrow the run.
  forbidOnly: IS_CI,
  // One retry in CI absorbs a cold-start flake; Playwright still reports a
  // retry-then-pass as flaky. None locally.
  retries: IS_CI ? Number(process.env.E2E_RETRIES ?? 1) : 0,
  workers: IS_CI ? Number(process.env.E2E_WORKERS ?? 2) : undefined,
  timeout: TIMEOUTS.test,
  expect: { timeout: TIMEOUTS.expect },
  reporter: IS_CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: baseUrl(),
    actionTimeout: TIMEOUTS.action,
    navigationTimeout: TIMEOUTS.action,
    // Kept only when a test fails, so green runs stay cheap.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  // All three run on Chromium, the only browser CI installs. Specs that move
  // the shared server clock run in desktop-chromium only.
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // The kitchen kiosk.
      name: "ipad-landscape",
      testIgnore: SHARED_CLOCK_SPECS,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1180, height: 820 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-360",
      testIgnore: SHARED_CLOCK_SPECS,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
