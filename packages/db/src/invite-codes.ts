import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Queryable } from "./index";
import { inviteCodes, members } from "./schema";

// Invite codes (SPEC §5, §6.2): the only way an account becomes a household
// member, apart from FOUNDER_EMAILS. Ported from camp-404
// `packages/db/src/invite-codes.ts`, cut down to one household and one role
// per code, and reshaped so every function takes the caller's handle (the
// action's transaction) and the caller's clock (apps/web/lib/clock.ts).

export type InviteCodeRow = typeof inviteCodes.$inferSelect;

/**
 * The one spelling of a code: trimmed and lowercase. Codes are minted
 * lowercase, but a phone keyboard capitalises the first letter of a field, so
 * every lookup and every write goes through this.
 */
export function normalizeInviteCode(raw: string): string {
  return raw.trim().toLowerCase();
}

export type InviteCodeState = "active" | "revoked" | "expired" | "used_up";

/**
 * Whether a code can still let someone in, and if not, why. The same order
 * the claim's WHERE clause uses: revoked, then expired, then out of uses.
 */
export function inviteCodeState(
  code: Pick<InviteCodeRow, "revokedAt" | "expiresAt" | "maxUses" | "useCount">,
  now: Date,
): InviteCodeState {
  if (code.revokedAt) return "revoked";
  if (code.expiresAt.getTime() <= now.getTime()) return "expired";
  if (code.useCount >= code.maxUses) return "used_up";
  return "active";
}

/**
 * Take one use of `code`, atomically: ONE `UPDATE … RETURNING` whose WHERE is
 * the whole "still usable" test, so a concurrent claim of the last use waits
 * on the row lock, re-checks the WHERE against the committed count and gets
 * nothing. Returns the claimed row, or null when the code is unknown or not
 * usable at `now` (ask `findInviteCode` and `inviteCodeState` why).
 *
 * Run it in the transaction that creates the member, so a failure there
 * gives the use back.
 */
export async function claimInviteCode(
  db: Queryable,
  code: string,
  now: Date,
): Promise<InviteCodeRow | null> {
  const [row] = await db
    .update(inviteCodes)
    .set({ useCount: sql`${inviteCodes.useCount} + 1` })
    .where(
      and(
        eq(inviteCodes.code, normalizeInviteCode(code)),
        isNull(inviteCodes.revokedAt),
        gt(inviteCodes.expiresAt, now),
        lt(inviteCodes.useCount, inviteCodes.maxUses),
      ),
    )
    .returning();
  return row ?? null;
}

/** The code whatever its state, or null when there is no such code. */
export async function findInviteCode(
  db: Queryable,
  code: string,
): Promise<InviteCodeRow | null> {
  const [row] = await db
    .select()
    .from(inviteCodes)
    .where(eq(inviteCodes.code, normalizeInviteCode(code)))
    .limit(1);
  return row ?? null;
}

export interface NewInviteCode {
  code: string;
  householdId: string;
  role: "admin" | "member";
  maxUses: number;
  expiresAt: Date;
  createdBy: string;
  createdAt: Date;
}

/**
 * Store a freshly minted code. Returns null when the code is already taken
 * (the caller generates another), never overwriting an existing code.
 */
export async function insertInviteCode(
  db: Queryable,
  input: NewInviteCode,
): Promise<InviteCodeRow | null> {
  const [row] = await db
    .insert(inviteCodes)
    .values({ ...input, code: normalizeInviteCode(input.code) })
    .onConflictDoNothing({ target: inviteCodes.code })
    .returning();
  return row ?? null;
}

/**
 * Revoke a code, compare-and-set: only a code not already revoked. Members
 * who joined with it stay. Returns the revoked row, or null when there is no
 * such code or it was already revoked.
 */
export async function revokeInviteCode(
  db: Queryable,
  code: string,
  now: Date,
): Promise<InviteCodeRow | null> {
  const [row] = await db
    .update(inviteCodes)
    .set({ revokedAt: now })
    .where(
      and(
        eq(inviteCodes.code, normalizeInviteCode(code)),
        isNull(inviteCodes.revokedAt),
      ),
    )
    .returning();
  return row ?? null;
}

export interface ListedInviteCode extends InviteCodeRow {
  createdByName: string | null;
}

/** Codes for the admin members page, newest first. */
export async function listInviteCodes(
  db: Queryable,
  householdId: string,
  limit = 50,
): Promise<ListedInviteCode[]> {
  const creator = alias(members, "creator");
  const rows = await db
    .select({ code: inviteCodes, createdByName: creator.displayName })
    .from(inviteCodes)
    .leftJoin(creator, eq(creator.id, inviteCodes.createdBy))
    .where(eq(inviteCodes.householdId, householdId))
    .orderBy(desc(inviteCodes.createdAt), desc(inviteCodes.code))
    .limit(limit);
  return rows.map((r) => ({ ...r.code, createdByName: r.createdByName }));
}
