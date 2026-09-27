// The one place the e2e harness reads its environment. Ported from afrikaburn
// (origin/main:e2e/lib/env.ts) and narrowed: this suite only ever runs against
// a local server backed by Docker Postgres (AGENTS.md "Tests are required").

type Env = Record<string, string | undefined>;

/** True in CI (GitHub Actions sets CI=true). */
export const IS_CI = process.env.CI === "true" || process.env.CI === "1";

/** The app under test. Defaults to the port scripts/e2e-local.sh serves on. */
export function baseUrl(env: Env = process.env): string {
  return (env.E2E_BASE_URL?.trim() || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
}

/** Loopback names only. `*.vercel.app` is deliberately absent. */
export function isLocalHost(hostname: string): boolean {
  const name = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "::1" ||
    name === "0.0.0.0" ||
    name.endsWith(".localhost")
  );
}

/**
 * Refuse any base URL that is not this machine.
 *
 * afrikaburn's `assertNotProductionUnlessAllowed` allows a non-production
 * remote host and has an override. This one allows neither, because the suite
 * only works against a server in E2E test mode (a movable clock, faked
 * integrations), and test mode refuses to boot on Vercel. A remote target is
 * therefore always a mistake, and it fails before any spec runs.
 */
export function assertLocalBaseUrl(env: Env = process.env): void {
  const url = baseUrl(env);
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`[e2e] E2E_BASE_URL is not a URL: ${url}`);
  }
  if (!isLocalHost(hostname)) {
    throw new Error(
      `[e2e] Refusing to run against ${hostname}. The suite writes to the ` +
        `database and needs E2E_TEST_MODE, so it only runs against localhost ` +
        `(scripts/e2e-local.sh). Unset E2E_BASE_URL or point it at localhost.`,
    );
  }
}

/** Timeouts in ms, overridable for a slow machine. */
export const TIMEOUTS = {
  test: Number(process.env.E2E_TEST_TIMEOUT ?? 60_000),
  expect: Number(process.env.E2E_EXPECT_TIMEOUT ?? 10_000),
  action: Number(process.env.E2E_ACTION_TIMEOUT ?? 15_000),
};
