// E2E test mode (SPEC §8, AGENTS.md "Tests are required").
//
// `E2E_TEST_MODE=1` switches on the test-only seams: the server clock offset
// (lib/clock.ts, POST /api/test/clock) and, later, the in-memory fakes for
// Google, Claude, Groq, brain and Blob. Those seams let a caller move time and
// skip real services, so they must never exist on a deployment.
//
// The guard runs at boot from two places: next.config.ts (so `next build`,
// `next start` and `next dev` all refuse) and instrumentation.ts (so a server
// started some other way refuses too). It reads `VERCEL_ENV` rather than
// `VERCEL`, because every Vercel environment (production, preview,
// development) sets it.
//
// No `server-only` import: next.config.ts imports this file, and that runs in
// plain Node outside the React server graph.

type Env = Record<string, string | undefined>;

/** True when the E2E test seams are on. Only the exact value "1" counts. */
export function isTestMode(env: Env = process.env): boolean {
  return env.E2E_TEST_MODE === "1";
}

/**
 * Throw if test mode is on inside a Vercel environment. Called at boot, so a
 * misconfigured deployment fails to build or start instead of serving a
 * movable clock to the internet.
 */
export function assertTestModeAllowed(env: Env = process.env): void {
  if (!isTestMode(env)) return;
  const vercelEnv = env.VERCEL_ENV?.trim();
  if (vercelEnv) {
    throw new Error(
      `E2E_TEST_MODE=1 is set on Vercel (VERCEL_ENV=${vercelEnv}). Test mode ` +
        `exposes a movable server clock and fake integrations, so the app ` +
        `refuses to boot. Remove E2E_TEST_MODE from this environment.`,
    );
  }
}
