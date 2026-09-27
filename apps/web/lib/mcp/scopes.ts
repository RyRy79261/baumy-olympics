import { MCP_SCOPE } from "@/lib/auth/gates";

// The two MCP scopes (SPEC §6.3). `baumy:read` lets a connection run the
// registry's read tools, `baumy:write` its (non-destructive) write tools; the
// check itself is `requireMember` in lib/auth/gates.ts.

export const MCP_SCOPES = [MCP_SCOPE.read, MCP_SCOPE.write] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export function isMcpScope(s: string): s is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(s);
}

/**
 * The scopes the consent screen offers for a request's `scope` parameter:
 * the ones asked for that we know, in our order. Nothing known (or no
 * parameter) offers both. Offering is not granting: only the boxes the member
 * ticks are granted (`grantedScopes`).
 */
export function offeredScopes(
  requested: string | null | undefined,
): McpScope[] {
  const asked = new Set((requested ?? "").split(/\s+/).filter(Boolean));
  const known = MCP_SCOPES.filter((s) => asked.has(s));
  return known.length > 0 ? known : [...MCP_SCOPES];
}

/** The ticked boxes that were offered, in our order. */
export function grantedScopes(
  offered: readonly McpScope[],
  ticked: readonly string[],
): McpScope[] {
  return offered.filter((s) => ticked.includes(s));
}

/** Which boxes start ticked: reading only. Writing is always opt-in. */
export function defaultTicked(offered: readonly McpScope[]): McpScope[] {
  return offered.filter((s) => s === MCP_SCOPE.read);
}

/** How a set of scopes reads on /settings/connections. */
export function describeScopes(scopes: readonly string[]): string {
  const read = scopes.includes(MCP_SCOPE.read);
  const write = scopes.includes(MCP_SCOPE.write);
  if (read && write) return "Read and write";
  if (write) return "Write only";
  if (read) return "Read only";
  return "Nothing";
}
