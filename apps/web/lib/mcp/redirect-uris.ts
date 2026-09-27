// Which redirect URIs Dynamic Client Registration accepts (SPEC §6.3),
// ported from intake-tracker `apps/web/src/lib/mcp/oauth.ts`
// (`isAllowedRedirectUri`). DCR is open by design (RFC 7591), so this list is
// what stops a stranger registering their own site to harvest codes: a code
// can only ever be sent back to Claude, or to a program on the member's own
// machine (Claude Desktop and Claude Code listen on loopback).

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const TRUSTED = ["claude.ai", "claude.com", "anthropic.com"];

export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  // A fragment is not allowed in a redirect URI (RFC 6749 §3.1.2), and
  // credentials in one are never legitimate.
  if (u.hash || u.username || u.password) return false;
  if (LOOPBACK.has(u.hostname)) {
    return u.protocol === "http:" || u.protocol === "https:";
  }
  if (u.protocol !== "https:") return false;
  return TRUSTED.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`));
}
