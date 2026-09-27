import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Queryable } from "./index";
import { serviceTokens } from "./schema";

// Service tokens (SPEC §6.3, §6.6, issue #27): what baumy-brain sends as
// `Authorization: Bearer` to `/api/v1/actions`. The mint script
// (scripts/service-token.ts) prints a token once and stores only its sha256;
// the plaintext goes into brain's env, never Olympics'. Every request looks
// the token up by hash, and a revoked token is never found.

/** Every token starts with this, so a leaked one is easy to recognise. */
export const SERVICE_TOKEN_PREFIX = "baumy_st_";

/** The scope a token needs to call the brain surface of `/api/v1/actions`. */
export const BRAIN_SCOPE = "brain";

/** Longer than anything we mint; refused before any hashing or query. */
export const SERVICE_TOKEN_MAX_LENGTH = 128;

/** A service name: lowercase words joined by dashes, e.g. `baumy-brain`. */
export const SERVICE_TOKEN_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** A fresh token: the prefix and 32 random bytes, base64url. */
export function generateServiceToken(): string {
  return SERVICE_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/**
 * The stored form of a token: sha256 hex. The token carries 256 random bits,
 * so nothing slower than a plain hash is needed.
 */
export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface LiveServiceToken {
  id: string;
  name: string;
  scopes: string[];
}

/**
 * Store a new token for `name`. Returns null, writing nothing, when a live
 * token already has that name (revoke it first, or use `rotateServiceToken`).
 */
export async function insertServiceToken(
  db: Queryable,
  input: { name: string; token: string; scopes: string[]; now: Date },
): Promise<LiveServiceToken | null> {
  const [row] = await db
    .insert(serviceTokens)
    .values({
      name: input.name,
      tokenHash: hashServiceToken(input.token),
      scopes: input.scopes,
      createdAt: input.now,
    })
    .onConflictDoNothing({
      target: serviceTokens.name,
      where: isNull(serviceTokens.revokedAt),
    })
    .returning({
      id: serviceTokens.id,
      name: serviceTokens.name,
      scopes: serviceTokens.scopes,
    });
  return row ?? null;
}

/**
 * Revoke the live token called `name`. Compare-and-set: returns false when
 * there is none (never minted, or already revoked).
 */
export async function revokeServiceToken(
  db: Queryable,
  input: { name: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(serviceTokens)
    .set({ revokedAt: input.now })
    .where(
      and(eq(serviceTokens.name, input.name), isNull(serviceTokens.revokedAt)),
    )
    .returning({ id: serviceTokens.id });
  return rows.length > 0;
}

/**
 * The live token whose plaintext is `token`, or null. The lookup is by the
 * unique hash, and the stored hash is compared again in constant time
 * (AGENTS.md "Security").
 */
export async function findLiveServiceToken(
  db: Queryable,
  token: string,
): Promise<LiveServiceToken | null> {
  if (!token || token.length > SERVICE_TOKEN_MAX_LENGTH) return null;
  const hash = hashServiceToken(token);
  const [row] = await db
    .select({
      id: serviceTokens.id,
      name: serviceTokens.name,
      scopes: serviceTokens.scopes,
      tokenHash: serviceTokens.tokenHash,
    })
    .from(serviceTokens)
    .where(
      and(eq(serviceTokens.tokenHash, hash), isNull(serviceTokens.revokedAt)),
    )
    .limit(1);
  if (!row) return null;
  const a = Buffer.from(row.tokenHash);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: row.id, name: row.name, scopes: row.scopes };
}

export interface ServiceTokenListing {
  name: string;
  scopes: string[];
  createdAt: Date;
  revokedAt: Date | null;
}

/** Every token ever minted, oldest first. Never the hashes. */
export async function listServiceTokens(
  db: Queryable,
): Promise<ServiceTokenListing[]> {
  return db
    .select({
      name: serviceTokens.name,
      scopes: serviceTokens.scopes,
      createdAt: serviceTokens.createdAt,
      revokedAt: serviceTokens.revokedAt,
    })
    .from(serviceTokens)
    .orderBy(asc(serviceTokens.createdAt), asc(serviceTokens.id));
}
