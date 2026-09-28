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
  "**/kiosk-night.spec.ts",
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

  // All run on Chromium, the only browser CI installs. Specs that move the
  // shared server clock run in their own project, `server-clock`, one test
  // at a time (`workers: 1`), so two of them never move the clock under each
  // other. The other projects depend on it, so they start only once it has
  // finished and the clock is back on real time: every page they load reads
  // that one clock, and a chore logged while it stood 25h ahead (claims) or
  // at 23:10 (kiosk-night) would land on the wrong day. A dependency ignores
  // file filters, so a slice run runs the clock specs first too (skip them
  // with --no-deps when the slice moves no clock and the founders exist).
  projects: [
    {
      // Every project's founder, bootstrapped once before anything else
      // (e2e/founders.setup.ts), so no two specs race to create one.
      name: "founders",
      testMatch: "**/founders.setup.ts",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "desktop-chromium",
      testIgnore: SHARED_CLOCK_SPECS,
      dependencies: ["server-clock"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // A desktop browser, like desktop-chromium; kiosk specs here open an
      // iPad-sized context of their own.
      name: "server-clock",
      testMatch: SHARED_CLOCK_SPECS,
      workers: 1,
      dependencies: ["founders"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      // The kitchen kiosk: an iPad in portrait (ADR 0005).
      name: "ipad-portrait",
      testIgnore: SHARED_CLOCK_SPECS,
      dependencies: ["server-clock"],
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 820, height: 1180 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-360",
      testIgnore: SHARED_CLOCK_SPECS,
      dependencies: ["server-clock"],
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
