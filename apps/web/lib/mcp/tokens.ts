import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Opaque secrets and PKCE for the MCP OAuth server (SPEC §6.3), ported from
// intake-tracker `apps/web/src/lib/mcp/tokens.ts`. Only their sha256 is ever
// stored (`hashMcpSecret` in @baumy/db/mcp-oauth).

export const TOKEN_PREFIX = {
  ACCESS: "baumy_at",
  REFRESH: "baumy_rt",
  AUTH_CODE: "baumy_ac",
  CLIENT_ID: "baumy_client",
  CLIENT_SECRET: "baumy_secret",
} as const;

/** `<prefix>_<base64url of n random bytes>`. */
export function generateOpaqueToken(prefix: string, bytes = 32): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

/** RFC 7636 §4.1: 43 to 128 characters from the unreserved set. */
export const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** The S256 challenge for a verifier: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Whether `verifier` answers the S256 `challenge`, compared in constant time.
 * S256 only: the metadata advertises nothing else, and `plain` would let an
 * intercepted code be redeemed by whoever read the challenge.
 */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!PKCE_PATTERN.test(verifier)) return false;
  const a = Buffer.from(pkceChallenge(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
