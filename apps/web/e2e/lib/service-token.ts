// The service-token script (packages/db/scripts/service-token.ts) as the
// owner runs it, against the same Docker Postgres the app serves from:
// scripts/e2e-local.sh exports DATABASE_URL_UNPOOLED and NEON_LOCAL_PROXY,
// and Playwright inherits them. The token comes back on stdout only.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function serviceToken(args: string[]): string {
  return execFileSync(
    "pnpm",
    [
      "--filter",
      "@baumy/db",
      "exec",
      "tsx",
      "scripts/service-token.ts",
      ...args,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

/** Mint a token with the brain scope; returns its plaintext. */
export function mintServiceToken(name: string): string {
  const token = serviceToken(["mint", name])
    .split("\n")
    .find((l) => l.startsWith("baumy_st_"));
  if (!token) throw new Error(`service-token mint ${name} printed no token`);
  return token;
}

export function revokeServiceToken(name: string): void {
  serviceToken(["revoke", name]);
}
