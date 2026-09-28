import { createHash } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { loginRequests, members, user } from "./schema";

// "Sign in with Baumy" (issue #80, ADR 0006). A browser asks to sign in as an
// address; brain DMs the member's linked Telegram account, and the tap
// approves or denies it (`approve_login`, `deny_login`). The browser holds the
// only copy of a random secret and trades it once for a session.
//
// Every step is ONE statement whose WHERE is the whole test, so a replayed or
// concurrent step finds no row. These functions take the caller's handle and
// write neither `audit_events` nor `action_requests`.

/** A request can be answered for this long. */
export const LOGIN_REQUEST_TTL_MS = 2 * 60_000;

/**
 * An approved request can still be traded for a session this long after it
 * expired, so a tap at 1:59 does not lose to the browser's next poll.
 */
export const LOGIN_EXCHANGE_GRACE_MS = 30_000;

/**
 * A denial (Deny, or a decoy number) switches the method off for that member
 * this long: someone may be pushing sign-ins at them (push fatigue).
 */
export const LOGIN_DENIAL_LOCK_MS = 15 * 60_000;

/** How long rows are kept, for the audit trail and the lock above. */
export const LOGIN_REQUEST_RETENTION_MS = 24 * 60 * 60_000;

export type LoginRequestState =
  "pending" | "approved" | "denied" | "expired" | "used";

export type LoginDenyReason = "denied" | "wrong_code";

/**
 * The stored form of a browser secret: sha256 hex. The secret is 32 random
 * bytes and lives two minutes, so a plain hash is enough.
 */
export function hashLoginSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** What a row reads as at `now`: `expired` is derived, never stored. */
export function loginRequestState(
  row: { status: typeof loginRequests.$inferSelect.status; expiresAt: Date },
  now: Date,
): LoginRequestState {
  const t = now.getTime();
  const expires = row.expiresAt.getTime();
  switch (row.status) {
    case "pending":
      return t < expires ? "pending" : "expired";
    case "approved":
      return t < expires + LOGIN_EXCHANGE_GRACE_MS ? "approved" : "expired";
    default:
      return row.status;
  }
}

/**
 * Who may be asked, for an address typed on the sign-in page: an active
 * member of this household with an account at that address and a linked
 * Telegram id. Null for anything else; the caller answers the same either
 * way. Better Auth stores addresses lowercased; so does this lookup.
 */
export async function findLoginCandidate(
  db: Queryable,
  householdId: string,
  email: string,
): Promise<{
  memberId: string;
  authUserId: string;
  telegramUserId: number;
} | null> {
  const [row] = await db
    .select({
      memberId: members.id,
      authUserId: user.id,
      telegramUserId: members.telegramUserId,
    })
    .from(user)
    .innerJoin(members, eq(members.authUserId, user.id))
    .where(
      and(
        eq(sql`lower(${user.email})`, email.trim().toLowerCase()),
        eq(members.householdId, householdId),
        isNull(members.deactivatedAt),
        isNotNull(members.telegramUserId),
      ),
    )
    .limit(1);
  if (!row || row.telegramUserId === null) return null;
  return {
    memberId: row.memberId,
    authUserId: row.authUserId,
    telegramUserId: row.telegramUserId,
  };
}

/**
 * Whether the member denied a request (Deny or a decoy number) in the last
 * `LOGIN_DENIAL_LOCK_MS`: someone may be pushing sign-ins at them, so the
 * method stays off for a while (the password still works).
 */
export async function isLoginLocked(
  db: Queryable,
  memberId: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - LOGIN_DENIAL_LOCK_MS);
  const [row] = await db
    .select({ id: loginRequests.id })
    .from(loginRequests)
    .where(
      and(
        eq(loginRequests.memberId, memberId),
        eq(loginRequests.status, "denied"),
        gt(loginRequests.decidedAt, since),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export interface NewLoginRequest {
  /** Null when nobody may be asked (the row keeps the answer uniform). */
  memberId: string | null;
  secret: string;
  code: number;
  choices: number[];
  device: string;
  now: Date;
}

/** Store a request, pending for `LOGIN_REQUEST_TTL_MS`. */
export async function insertLoginRequest(
  db: Queryable,
  input: NewLoginRequest,
): Promise<{ id: string; expiresAt: Date }> {
  const expiresAt = new Date(input.now.getTime() + LOGIN_REQUEST_TTL_MS);
  const [row] = await db
    .insert(loginRequests)
    .values({
      memberId: input.memberId,
      secretHash: hashLoginSecret(input.secret),
      code: input.code,
      choices: input.choices,
      device: input.device,
      createdAt: input.now,
      expiresAt,
    })
    .returning({ id: loginRequests.id });
  return { id: row!.id, expiresAt };
}

/** Where the request this browser holds the secret of stands, or null. */
export async function findLoginRequestBySecret(
  db: Queryable,
  secret: string,
  now: Date,
): Promise<{ id: string; state: LoginRequestState } | null> {
  const [row] = await db
    .select({
      id: loginRequests.id,
      status: loginRequests.status,
      expiresAt: loginRequests.expiresAt,
    })
    .from(loginRequests)
    .where(eq(loginRequests.secretHash, hashLoginSecret(secret)))
    .limit(1);
  return row ? { id: row.id, state: loginRequestState(row, now) } : null;
}

export interface LockedLoginRequest {
  id: string;
  code: number;
  device: string;
  state: LoginRequestState;
}

/**
 * The request `id` made for `memberId`, locked (`FOR UPDATE`) until the
 * transaction ends, or null when there is none (another member's request
 * reads as none at all).
 */
export async function lockLoginRequest(
  db: Queryable,
  id: string,
  memberId: string,
  now: Date,
): Promise<LockedLoginRequest | null> {
  const [row] = await db
    .select({
      id: loginRequests.id,
      code: loginRequests.code,
      device: loginRequests.device,
      status: loginRequests.status,
      expiresAt: loginRequests.expiresAt,
    })
    .from(loginRequests)
    .where(and(eq(loginRequests.id, id), eq(loginRequests.memberId, memberId)))
    .for("update");
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    device: row.device,
    state: loginRequestState(row, now),
  };
}

/**
 * Approve or deny a pending, unexpired request: a compare-and-set on the
 * status. False when it was no longer pending (answered, or expired).
 */
export async function decideLoginRequest(
  db: Queryable,
  id: string,
  decision:
    | { status: "approved"; now: Date }
    | { status: "denied"; reason: LoginDenyReason; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(loginRequests)
    .set({
      status: decision.status,
      denyReason: decision.status === "denied" ? decision.reason : null,
      decidedAt: decision.now,
    })
    .where(
      and(
        eq(loginRequests.id, id),
        eq(loginRequests.status, "pending"),
        gt(loginRequests.expiresAt, decision.now),
      ),
    )
    .returning({ id: loginRequests.id });
  return rows.length > 0;
}

/**
 * Trade an approved request for its member, once: ONE `UPDATE … RETURNING`
 * whose WHERE is the whole test (this secret, approved, for a member, not
 * past its time plus the grace). A replay, a second tab or a race finds no
 * row. The member must still be active with an account.
 */
export async function claimApprovedLoginRequest(
  db: Queryable,
  secret: string,
  now: Date,
): Promise<{ requestId: string; memberId: string; authUserId: string } | null> {
  const [claimed] = await db
    .update(loginRequests)
    .set({ status: "used", usedAt: now })
    .where(
      and(
        eq(loginRequests.secretHash, hashLoginSecret(secret)),
        eq(loginRequests.status, "approved"),
        isNotNull(loginRequests.memberId),
        gt(
          loginRequests.expiresAt,
          new Date(now.getTime() - LOGIN_EXCHANGE_GRACE_MS),
        ),
      ),
    )
    .returning({ id: loginRequests.id, memberId: loginRequests.memberId });
  if (!claimed?.memberId) return null;
  const [member] = await db
    .select({ authUserId: members.authUserId })
    .from(members)
    .where(and(eq(members.id, claimed.memberId), isNull(members.deactivatedAt)))
    .limit(1);
  if (!member?.authUserId) return null;
  return {
    requestId: claimed.id,
    memberId: claimed.memberId,
    authUserId: member.authUserId,
  };
}

/** Delete requests created before `before` (the daily sweep). */
export async function pruneLoginRequests(
  db: Queryable,
  before: Date,
): Promise<number> {
  const rows = await db
    .delete(loginRequests)
    .where(lt(loginRequests.createdAt, before))
    .returning({ id: loginRequests.id });
  return rows.length;
}
