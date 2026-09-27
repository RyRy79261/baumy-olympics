import "server-only";

import { createHttpDb, type Queryable } from "@baumy/db";
import {
  findLiveMcpAccessToken,
  hashMcpSecret,
  touchMcpAccessToken,
} from "@baumy/db/mcp-oauth";
import type { McpActor } from "@/lib/auth";
import { now } from "@/lib/clock";

// Checking an MCP access token (SPEC §6.3). Issue #24's MCP endpoint calls
// `verifyToken` on EVERY request (mcp-handler's `withMcpAuth`), so a revoked
// token, an expired one and a deactivated member's token stop working at
// once, with no cache in between.

export interface McpTokenInfo {
  memberId: string;
  scopes: string[];
  clientId: string;
}

/** Longer than anything we mint; refused before any hashing or query. */
const MAX_TOKEN_LENGTH = 256;

export async function verifyToken(
  token: string | null | undefined,
  db: Queryable = createHttpDb() as unknown as Queryable,
): Promise<McpTokenInfo | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const at = now();
  const live = await findLiveMcpAccessToken(db, hashMcpSecret(token), at);
  if (!live) return null;
  try {
    await touchMcpAccessToken(db, live, at);
  } catch (err) {
    console.error("[mcp] could not record last_used_at", err);
  }
  return {
    memberId: live.memberId,
    scopes: live.scopes,
    clientId: live.clientId,
  };
}

/** The bearer token of an `Authorization` header, or null. */
export function bearerToken(header: string | null): string | null {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return m?.[1] ?? null;
}

/** The actor a verified token acts as, for runAction (issue #24). */
export function mcpActor(info: McpTokenInfo): McpActor {
  return { kind: "mcp", memberId: info.memberId, scopes: info.scopes };
}
