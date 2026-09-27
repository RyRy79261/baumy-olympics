import { createHash, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Queryable } from "./index";
import {
  mcpAccessTokens,
  mcpAuthCodes,
  mcpOauthClients,
  members,
} from "./schema";

// The MCP OAuth authorization server's storage (SPEC §6.3, issue #23), ported
// from intake-tracker `apps/web/src/lib/mcp/oauth.ts` and keyed on members.
//
// Every secret (client secret, code, access token, refresh token) is stored
// as sha256 hex, and every lookup is by that hash. The secrets are 24 to 32
// random bytes, so nothing slower than sha256 is needed.
//
// Every "is it still usable" test lives in the WHERE of one statement:
// consuming a code, rotating a refresh token and revoking are all
// compare-and-set (`UPDATE … WHERE … RETURNING`), so two racing requests
// cannot both win. Each one also requires the member to be active, so a
// deactivated member's code, refresh token and access token all stop working
// at once. Every function takes the caller's handle and the caller's clock.

/** Authorization codes live this long (RFC 6749 §4.1.2 suggests 10 min). */
export const MCP_AUTH_CODE_TTL_MS = 10 * 60_000;
/** Access tokens live this long; claude.ai refreshes them silently. */
export const MCP_ACCESS_TOKEN_TTL_MS = 24 * 60 * 60_000;
/** A grant must be refreshed at least this often or it lapses. */
export const MCP_REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;
/** `last_used_at` is written at most this often per token. */
export const MCP_TOUCH_EVERY_MS = 5 * 60_000;

export type McpAuthMethod =
  "none" | "client_secret_basic" | "client_secret_post";

/** The stored form of any MCP secret: sha256 hex. */
export function hashMcpSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Compare two sha256 hex digests in constant time. */
export function mcpHashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** The member is active: every usable code or token requires it. */
const memberActive = (memberId: AnyPgColumn) =>
  sql`exists (select 1 from ${members} where ${members.id} = ${memberId} and ${members.deactivatedAt} is null)`;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export type McpClientRow = typeof mcpOauthClients.$inferSelect;

export async function insertMcpClient(
  db: Queryable,
  input: {
    clientId: string;
    clientSecretHash: string | null;
    clientName: string;
    redirectUris: string[];
    tokenEndpointAuthMethod: McpAuthMethod;
    now: Date;
  },
): Promise<McpClientRow> {
  const [row] = await db
    .insert(mcpOauthClients)
    .values({
      clientId: input.clientId,
      clientSecretHash: input.clientSecretHash,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
      createdAt: input.now,
    })
    .returning();
  return row!;
}

export async function findMcpClient(
  db: Queryable,
  clientId: string,
): Promise<McpClientRow | null> {
  const [row] = await db
    .select()
    .from(mcpOauthClients)
    .where(eq(mcpOauthClients.clientId, clientId))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

/** Store a new code's hash for the member who approved it. */
export async function insertMcpAuthCode(
  db: Queryable,
  input: {
    codeHash: string;
    clientId: string;
    memberId: string;
    redirectUri: string;
    codeChallenge: string;
    scopes: string[];
    now: Date;
  },
): Promise<{ expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + MCP_AUTH_CODE_TTL_MS);
  await db.insert(mcpAuthCodes).values({
    codeHash: input.codeHash,
    clientId: input.clientId,
    memberId: input.memberId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scopes: input.scopes,
    expiresAt,
    createdAt: input.now,
  });
  return { expiresAt };
}

export interface ConsumedMcpCode {
  memberId: string;
  scopes: string[];
  codeChallenge: string;
}

/**
 * Use a code, once. ONE `UPDATE … RETURNING` whose WHERE is the whole test:
 * this code, not used, not expired, the same client and redirect URI, and an
 * active member. A request with the wrong client does NOT burn the code; the
 * PKCE check comes after, and a mismatch there leaves it burned (a wrong
 * verifier means the code may have been intercepted).
 */
export async function consumeMcpAuthCode(
  db: Queryable,
  input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    now: Date;
  },
): Promise<ConsumedMcpCode | null> {
  const [row] = await db
    .update(mcpAuthCodes)
    .set({ consumedAt: input.now })
    .where(
      and(
        eq(mcpAuthCodes.codeHash, input.codeHash),
        isNull(mcpAuthCodes.consumedAt),
        eq(mcpAuthCodes.clientId, input.clientId),
        eq(mcpAuthCodes.redirectUri, input.redirectUri),
        gt(mcpAuthCodes.expiresAt, input.now),
        memberActive(mcpAuthCodes.memberId),
      ),
    )
    .returning({
      memberId: mcpAuthCodes.memberId,
      scopes: mcpAuthCodes.scopes,
      codeChallenge: mcpAuthCodes.codeChallenge,
    });
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Access and refresh tokens
// ---------------------------------------------------------------------------

export interface NewMcpTokens {
  grantId: string;
  tokenHash: string;
  refreshTokenHash: string;
  clientId: string;
  memberId: string;
  scopes: string[];
  grantedAt: Date;
  now: Date;
}

/** Store a token pair. Returns when the access token expires. */
export async function insertMcpTokens(
  db: Queryable,
  input: NewMcpTokens,
): Promise<{ expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + MCP_ACCESS_TOKEN_TTL_MS);
  await db.insert(mcpAccessTokens).values({
    grantId: input.grantId,
    tokenHash: input.tokenHash,
    refreshTokenHash: input.refreshTokenHash,
    clientId: input.clientId,
    memberId: input.memberId,
    scopes: input.scopes,
    expiresAt,
    refreshExpiresAt: new Date(input.now.getTime() + MCP_REFRESH_TOKEN_TTL_MS),
    grantedAt: input.grantedAt,
    createdAt: input.now,
  });
  return { expiresAt };
}

/**
 * Refresh-token rotation (OAuth 2.1 §4.3.1). Revokes the row holding
 * `refreshHash` with a compare-and-set (this client, not revoked, not lapsed,
 * member active), then inserts the new pair under the same grant. The caller
 * runs it in ONE transaction, so a failed insert leaves the old pair usable
 * and two racing refreshes cannot both succeed. Returns the grant's member
 * and scopes, or null.
 */
export async function rotateMcpRefreshToken(
  tx: Queryable,
  input: {
    refreshHash: string;
    clientId: string;
    tokenHash: string;
    refreshTokenHash: string;
    now: Date;
  },
): Promise<{
  memberId: string;
  scopes: string[];
  grantId: string;
  expiresAt: Date;
} | null> {
  const [old] = await tx
    .update(mcpAccessTokens)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(mcpAccessTokens.refreshTokenHash, input.refreshHash),
        eq(mcpAccessTokens.clientId, input.clientId),
        isNull(mcpAccessTokens.revokedAt),
        gt(mcpAccessTokens.refreshExpiresAt, input.now),
        memberActive(mcpAccessTokens.memberId),
      ),
    )
    .returning({
      grantId: mcpAccessTokens.grantId,
      memberId: mcpAccessTokens.memberId,
      scopes: mcpAccessTokens.scopes,
      grantedAt: mcpAccessTokens.grantedAt,
    });
  if (!old) return null;
  const { expiresAt } = await insertMcpTokens(tx, {
    grantId: old.grantId,
    tokenHash: input.tokenHash,
    refreshTokenHash: input.refreshTokenHash,
    clientId: input.clientId,
    memberId: old.memberId,
    scopes: old.scopes,
    grantedAt: old.grantedAt,
    now: input.now,
  });
  return {
    memberId: old.memberId,
    scopes: old.scopes,
    grantId: old.grantId,
    expiresAt,
  };
}

export interface LiveMcpAccessToken {
  id: string;
  clientId: string;
  memberId: string;
  scopes: string[];
  lastUsedAt: Date | null;
}

/**
 * The live access token whose hash is `tokenHash`: not revoked, not expired,
 * and its member not deactivated. The stored hash is compared again in
 * constant time.
 */
export async function findLiveMcpAccessToken(
  db: Queryable,
  tokenHash: string,
  now: Date,
): Promise<LiveMcpAccessToken | null> {
  const [row] = await db
    .select({
      id: mcpAccessTokens.id,
      tokenHash: mcpAccessTokens.tokenHash,
      clientId: mcpAccessTokens.clientId,
      memberId: mcpAccessTokens.memberId,
      scopes: mcpAccessTokens.scopes,
      lastUsedAt: mcpAccessTokens.lastUsedAt,
    })
    .from(mcpAccessTokens)
    .innerJoin(members, eq(members.id, mcpAccessTokens.memberId))
    .where(
      and(
        eq(mcpAccessTokens.tokenHash, tokenHash),
        isNull(mcpAccessTokens.revokedAt),
        gt(mcpAccessTokens.expiresAt, now),
        isNull(members.deactivatedAt),
      ),
    )
    .limit(1);
  if (!row || !mcpHashesEqual(row.tokenHash, tokenHash)) return null;
  const { tokenHash: _stored, ...token } = row;
  return token;
}

/** Record a use, at most every MCP_TOUCH_EVERY_MS. */
export async function touchMcpAccessToken(
  db: Queryable,
  token: Pick<LiveMcpAccessToken, "id" | "lastUsedAt">,
  now: Date,
): Promise<void> {
  const last = token.lastUsedAt?.getTime() ?? 0;
  if (now.getTime() - last < MCP_TOUCH_EVERY_MS) return;
  await db
    .update(mcpAccessTokens)
    .set({ lastUsedAt: now })
    .where(eq(mcpAccessTokens.id, token.id));
}

/**
 * RFC 7009: revoke the pair holding `tokenHash` as its access OR refresh
 * token, but only the presenting client's. Returns how many rows it revoked
 * (0 for an unknown, foreign or already revoked token).
 */
export async function revokeMcpToken(
  db: Queryable,
  input: { tokenHash: string; clientId: string; now: Date },
): Promise<number> {
  const rows = await db
    .update(mcpAccessTokens)
    .set({ revokedAt: input.now })
    .where(
      and(
        or(
          eq(mcpAccessTokens.tokenHash, input.tokenHash),
          eq(mcpAccessTokens.refreshTokenHash, input.tokenHash),
        ),
        eq(mcpAccessTokens.clientId, input.clientId),
        isNull(mcpAccessTokens.revokedAt),
      ),
    )
    .returning({ id: mcpAccessTokens.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Connections (/settings/connections)
// ---------------------------------------------------------------------------

export interface McpConnection {
  grantId: string;
  clientId: string;
  clientName: string;
  scopes: string[];
  grantedAt: Date;
  lastUsedAt: Date | null;
}

/**
 * The member's live grants, oldest first: one row per grant that is not
 * revoked and can still be used or refreshed.
 */
export async function listMcpConnections(
  db: Queryable,
  memberId: string,
  now: Date,
): Promise<McpConnection[]> {
  return db
    .select({
      grantId: mcpAccessTokens.grantId,
      clientId: mcpAccessTokens.clientId,
      clientName: mcpOauthClients.clientName,
      scopes: mcpAccessTokens.scopes,
      grantedAt: mcpAccessTokens.grantedAt,
      lastUsedAt: mcpAccessTokens.lastUsedAt,
    })
    .from(mcpAccessTokens)
    .innerJoin(
      mcpOauthClients,
      eq(mcpOauthClients.clientId, mcpAccessTokens.clientId),
    )
    .where(
      and(
        eq(mcpAccessTokens.memberId, memberId),
        isNull(mcpAccessTokens.revokedAt),
        gt(mcpAccessTokens.refreshExpiresAt, now),
      ),
    )
    .orderBy(asc(mcpAccessTokens.grantedAt), asc(mcpAccessTokens.grantId));
}

/**
 * Disconnect one of the member's grants: revoke its live pair. Compare-and-
 * set on the member, so nobody revokes someone else's. Returns the client's
 * name, or null when there was nothing live to revoke.
 */
export async function revokeMcpGrant(
  db: Queryable,
  input: { memberId: string; grantId: string; now: Date },
): Promise<{ clientId: string; clientName: string } | null> {
  const rows = await db
    .update(mcpAccessTokens)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(mcpAccessTokens.grantId, input.grantId),
        eq(mcpAccessTokens.memberId, input.memberId),
        isNull(mcpAccessTokens.revokedAt),
      ),
    )
    .returning({ clientId: mcpAccessTokens.clientId });
  const clientId = rows[0]?.clientId;
  if (!clientId) return null;
  const client = await findMcpClient(db, clientId);
  return { clientId, clientName: client?.clientName ?? clientId };
}
