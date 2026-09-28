import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { createHttpDb, type Queryable } from "./index";
import { members } from "./schema";

// Member reads and writes. `findActiveMemberByAuthUserId` runs on the request
// path before any action (apps/web/lib/auth). The rest take the caller's
// handle, the action's transaction, as AGENTS.md asks of domain functions.

export interface ActiveMember {
  id: string;
  householdId: string;
  role: "admin" | "member";
  displayName: string;
}

/**
 * The active (not deactivated) member whose `auth_user_id` is this Better Auth
 * user, or null. A signed-in user without one is an account, not a housemate.
 */
export async function findActiveMemberByAuthUserId(
  authUserId: string,
): Promise<ActiveMember | null> {
  const [row] = await createHttpDb()
    .select({
      id: members.id,
      householdId: members.householdId,
      role: members.role,
      displayName: members.displayName,
    })
    .from(members)
    .where(
      and(eq(members.authUserId, authUserId), isNull(members.deactivatedAt)),
    )
    .limit(1);
  return row ?? null;
}

/**
 * The member row linked to an auth user, active or not. `/join` uses it to
 * tell a switched-off member why a code will not let them back in.
 */
export async function findMemberByAuthUserId(
  db: Queryable,
  authUserId: string,
): Promise<{ id: string; deactivatedAt: Date | null } | null> {
  const [row] = await db
    .select({ id: members.id, deactivatedAt: members.deactivatedAt })
    .from(members)
    .where(eq(members.authUserId, authUserId))
    .limit(1);
  return row ?? null;
}

export interface NewMember {
  householdId: string;
  authUserId: string;
  displayName: string;
  avatarSprite: string;
  color: string;
  role: "admin" | "member";
  createdAt: Date;
}

/**
 * Create the member for an auth user. Returns null, writing nothing, when that
 * user already has a member row (`auth_user_id` is unique): a concurrent join
 * by the same account waits on the unique index and lands here.
 */
export async function insertMember(
  db: Queryable,
  input: NewMember,
): Promise<{ id: string; role: "admin" | "member" } | null> {
  const [row] = await db
    .insert(members)
    .values(input)
    .onConflictDoNothing({ target: members.authUserId })
    .returning({ id: members.id, role: members.role });
  return row ?? null;
}

export type MemberListing = Pick<
  typeof members.$inferSelect,
  | "id"
  | "displayName"
  | "avatarSprite"
  | "color"
  | "role"
  | "deactivatedAt"
  | "createdAt"
> & {
  hasAccount: boolean;
  hasKioskPin: boolean;
  telegramLinked: boolean;
  /** For the admin members page, which may set or clear it (issue #27). */
  telegramUserId: number | null;
};

/** Everyone in the household, active first, then by when they joined. */
export async function listMembers(
  db: Queryable,
  householdId: string,
): Promise<MemberListing[]> {
  const rows = await db
    .select({
      id: members.id,
      displayName: members.displayName,
      avatarSprite: members.avatarSprite,
      color: members.color,
      role: members.role,
      deactivatedAt: members.deactivatedAt,
      createdAt: members.createdAt,
      authUserId: members.authUserId,
      kioskPinHash: members.kioskPinHash,
      telegramUserId: members.telegramUserId,
    })
    .from(members)
    .where(eq(members.householdId, householdId))
    .orderBy(
      sql`${members.deactivatedAt} IS NOT NULL`,
      asc(members.createdAt),
      asc(members.id),
    );
  return rows.map(({ authUserId, kioskPinHash, telegramUserId, ...rest }) => ({
    ...rest,
    hasAccount: authUserId !== null,
    hasKioskPin: kioskPinHash !== null,
    telegramLinked: telegramUserId !== null,
    telegramUserId,
  }));
}

/**
 * Every active admin's id, row-locked in id order until the transaction ends.
 * Demoting or deactivating a member takes these locks first, so two admins
 * demoting each other at once cannot leave the household with none: the
 * second waits for the first, then counts one admin fewer. Locking in one
 * fixed order means the two cannot deadlock over these rows.
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: runAction's ledger insert has
 * already taken a `KEY SHARE` lock on the ACTING member's row (the foreign
 * key check), and `FOR UPDATE` conflicts with that. Two admins demoting each
 * other would each hold a key-share on themselves and wait for the other's:
 * a deadlock (seen on Docker Postgres). Only non-key columns change here, so
 * the weaker lock is enough and still serialises these writers.
 */
export async function lockActiveAdmins(
  db: Queryable,
  householdId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: members.id })
    .from(members)
    .where(
      and(
        eq(members.householdId, householdId),
        eq(members.role, "admin"),
        isNull(members.deactivatedAt),
      ),
    )
    .orderBy(asc(members.id))
    .for("no key update");
  return rows.map((r) => r.id);
}

/**
 * A member row in the household, row-locked (`FOR NO KEY UPDATE`, see
 * lockActiveAdmins) for the change about to follow.
 */
export async function lockMember(
  db: Queryable,
  householdId: string,
  memberId: string,
): Promise<typeof members.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(members)
    .where(and(eq(members.id, memberId), eq(members.householdId, householdId)))
    .for("no key update");
  return row ?? null;
}

export type MemberPatch = Partial<
  Pick<
    typeof members.$inferInsert,
    | "displayName"
    | "avatarSprite"
    | "avatar"
    | "color"
    | "role"
    | "deactivatedAt"
    | "telegramUserId"
  >
>;

/** Apply `patch` to one member and return the new row, or null if missing. */
export async function updateMember(
  db: Queryable,
  memberId: string,
  patch: MemberPatch,
): Promise<typeof members.$inferSelect | null> {
  const [row] = await db
    .update(members)
    .set(patch)
    .where(eq(members.id, memberId))
    .returning();
  return row ?? null;
}

/** Whether the member has a kiosk PIN set. */
export async function hasKioskPin(
  db: Queryable,
  memberId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ hash: members.kioskPinHash })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  return Boolean(row?.hash);
}

/**
 * Store a new kiosk PIN hash and lift any lock from failed PIN attempts
 * (SPEC §6.2: the member resets the PIN from their own session). Returns
 * false when the member does not exist.
 */
export async function setKioskPinHash(
  db: Queryable,
  memberId: string,
  pinHash: string,
): Promise<boolean> {
  const rows = await db
    .update(members)
    .set({ kioskPinHash: pinHash, kioskPinLockedAt: null })
    .where(eq(members.id, memberId))
    .returning({ id: members.id });
  return rows.length > 0;
}

export interface KioskMember {
  id: string;
  displayName: string;
  avatarSprite: string;
  color: string;
}

/** An active member with their 16-bit character (`members.avatar`). */
export interface KioskMemberWithAvatar extends KioskMember {
  /** As stored: `avatarFor` (packages/types) reads it; null is the default. */
  avatar: unknown;
}

/** The active members, in the order they joined: the kiosk's avatar bar. */
export async function listActiveMembers(
  db: Queryable,
  householdId: string,
): Promise<KioskMemberWithAvatar[]> {
  return db
    .select({
      id: members.id,
      displayName: members.displayName,
      avatarSprite: members.avatarSprite,
      color: members.color,
      avatar: members.avatar,
    })
    .from(members)
    .where(
      and(eq(members.householdId, householdId), isNull(members.deactivatedAt)),
    )
    .orderBy(asc(members.createdAt), asc(members.id));
}

/** One active member of the household, or null. */
export async function findActiveMember(
  db: Queryable,
  householdId: string,
  memberId: string,
): Promise<KioskMember | null> {
  const [row] = await db
    .select({
      id: members.id,
      displayName: members.displayName,
      avatarSprite: members.avatarSprite,
      color: members.color,
    })
    .from(members)
    .where(
      and(
        eq(members.id, memberId),
        eq(members.householdId, householdId),
        isNull(members.deactivatedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** When the member's kiosk PIN was locked by failed attempts, or null. */
export async function findKioskPinLockedAt(
  db: Queryable,
  memberId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ lockedAt: members.kioskPinLockedAt })
    .from(members)
    .where(eq(members.id, memberId))
    .limit(1);
  return row?.lockedAt ?? null;
}

/**
 * The active member linked to this Telegram user id, or null (issue #27).
 * The brain endpoint maps `X-Baumy-Actor: tg:<id>` through it on every
 * request, so unlinking or deactivating takes effect at once.
 */
export async function findActiveMemberByTelegramUserId(
  db: Queryable,
  householdId: string,
  telegramUserId: number,
): Promise<{ id: string; displayName: string } | null> {
  const [row] = await db
    .select({ id: members.id, displayName: members.displayName })
    .from(members)
    .where(
      and(
        eq(members.telegramUserId, telegramUserId),
        eq(members.householdId, householdId),
        isNull(members.deactivatedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Who holds this Telegram user id, active or not, or null. The column is
 * unique, so a deactivated member's link still blocks anyone else's.
 */
export async function findMemberIdByTelegramUserId(
  db: Queryable,
  telegramUserId: number,
): Promise<string | null> {
  const [row] = await db
    .select({ id: members.id })
    .from(members)
    .where(eq(members.telegramUserId, telegramUserId))
    .limit(1);
  return row?.id ?? null;
}
