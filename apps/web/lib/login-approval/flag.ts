// "Sign in with Baumy" is off until the owner turns it on (issue #80): the
// brain side (baumy-brain's /api/kitchen/login-approval) must be deployed
// first, or members would wait for a DM that never comes. SETUP.md says when.
// Pure, so the sign-in page and the routes read the same switch.

export const SIGN_IN_WITH_BAUMY_ENV = "SIGN_IN_WITH_BAUMY";

type Env = Record<string, string | undefined>;

/** True only for `SIGN_IN_WITH_BAUMY=on`. */
export function signInWithBaumyEnabled(env: Env = process.env): boolean {
  return env[SIGN_IN_WITH_BAUMY_ENV]?.trim() === "on";
}
