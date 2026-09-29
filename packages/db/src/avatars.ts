import { and, asc, count, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { avatars, members } from "./schema";

// The avatar gallery (issue #111). Every function takes the caller's handle
// (the action's transaction for writes), and none writes an audit row:
// runAction does that (AGENTS.md). Rows are never deleted: archiving hides
// a sprite from the gallery, and whoever already wears it keeps it.

/** What a screen needs to draw a member's sprite. */
export interface AvatarImageRef {
  id: string;
  pathname: string;
  width: number;
  height: number;
}

export interface AvatarRow extends AvatarImageRef {
  name: string;
  createdAt: Date;
  archivedAt: Date | null;
  /** How many active members wear it now. */
  wornBy: number;
}

// Spelled out with its table names: drizzle leaves a column in a one-table
// select unqualified, and here "id" would be the member's.
const wornBy = sql<number>`(
  select count(*)::int from "members" m
  where m."avatar_image_id" = "avatars"."id" and m."deactivated_at" is null
)`.mapWith(Number);

const avatarColumns = {
  id: avatars.id,
  pathname: avatars.pathname,
  width: avatars.width,
  height: avatars.height,
  name: avatars.name,
  createdAt: avatars.createdAt,
  archivedAt: avatars.archivedAt,
  wornBy,
};

/**
 * The household's gallery, oldest first. `archived` picks which part: the
 * live gallery members choose from (false), the archived ones (true), or
 * both (undefined, the admin page).
 */
export async function listAvatars(
  db: Queryable,
  householdId: string,
  archived?: boolean,
): Promise<AvatarRow[]> {
  return db
    .select(avatarColumns)
    .from(avatars)
    .where(
      and(
        eq(avatars.householdId, householdId),
        archived === undefined
          ? undefined
          : archived
            ? isNotNull(avatars.archivedAt)
            : isNull(avatars.archivedAt),
      ),
    )
    .orderBy(asc(avatars.createdAt), asc(avatars.id));
}

/** One sprite of the household, archived or not, or null. */
export async function findAvatar(
  db: Queryable,
  householdId: string,
  avatarId: string,
): Promise<AvatarRow | null> {
  const [row] = await db
    .select(avatarColumns)
    .from(avatars)
    .where(and(eq(avatars.id, avatarId), eq(avatars.householdId, householdId)))
    .limit(1);
  return row ?? null;
}

/** How many sprites the gallery offers now (not archived). */
export async function countLiveAvatars(
  db: Queryable,
  householdId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(avatars)
    .where(
      and(eq(avatars.householdId, householdId), isNull(avatars.archivedAt)),
    );
  return row?.n ?? 0;
}

export interface NewAvatar {
  id: string;
  householdId: string;
  name: string;
  pathname: string;
  width: number;
  height: number;
  createdBy: string;
  createdAt: Date;
}

/**
 * Add a sprite. Null, writing nothing, when that id (or pathname) is already
 * taken: the upload route picks a fresh id per file, so only a replay lands
 * here.
 */
export async function insertAvatar(
  db: Queryable,
  input: NewAvatar,
): Promise<AvatarImageRef | null> {
  const [row] = await db
    .insert(avatars)
    .values(input)
    .onConflictDoNothing()
    .returning({
      id: avatars.id,
      pathname: avatars.pathname,
      width: avatars.width,
      height: avatars.height,
    });
  return row ?? null;
}

export type ArchiveResult =
  | { ok: true; name: string }
  | { ok: false; code: "NOT_FOUND" | "STALE" };

/**
 * Archive (`archived: true`) or restore a sprite, compare-and-set on its
 * state: archiving an archived one, or restoring a live one, is `STALE`
 * (another admin got there first).
 */
export async function setAvatarArchived(
  db: Queryable,
  input: { householdId: string; avatarId: string; archived: boolean; now: Date },
): Promise<ArchiveResult> {
  const [row] = await db
    .update(avatars)
    .set({ archivedAt: input.archived ? input.now : null })
    .where(
      and(
        eq(avatars.id, input.avatarId),
        eq(avatars.householdId, input.householdId),
        input.archived
          ? isNull(avatars.archivedAt)
          : isNotNull(avatars.archivedAt),
      ),
    )
    .returning({ name: avatars.name });
  if (row) return { ok: true, name: row.name };
  const exists = await findAvatar(db, input.householdId, input.avatarId);
  return { ok: false, code: exists ? "STALE" : "NOT_FOUND" };
}

/** Where a sprite's image is stored, for the /api/blob proxy, or null. */
export async function findAvatarPathname(
  db: Queryable,
  householdId: string,
  avatarId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ pathname: avatars.pathname })
    .from(avatars)
    .where(and(eq(avatars.id, avatarId), eq(avatars.householdId, householdId)))
    .limit(1);
  return row?.pathname ?? null;
}

/**
 * Put a sprite on a member, or take theirs off (`avatarImageId: null`).
 * False when the member does not exist.
 */
export async function setMemberAvatarImage(
  db: Queryable,
  memberId: string,
  avatarImageId: string | null,
): Promise<boolean> {
  const rows = await db
    .update(members)
    .set({ avatarImageId })
    .where(eq(members.id, memberId))
    .returning({ id: members.id });
  return rows.length > 0;
}

/**
 * The columns that give a member row its sprite, for a query that has
 * `LEFT JOIN avatars ON avatars.id = members.avatar_image_id`.
 */
export const avatarImageColumns = {
  imageId: avatars.id,
  imagePathname: avatars.pathname,
  imageWidth: avatars.width,
  imageHeight: avatars.height,
};

/** `avatarImageColumns` of one row, folded into a ref (null for none). */
export function avatarImageOf(row: {
  imageId: string | null;
  imagePathname: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}): AvatarImageRef | null {
  return row.imageId === null
    ? null
    : {
        id: row.imageId,
        pathname: row.imagePathname!,
        width: row.imageWidth!,
        height: row.imageHeight!,
      };
}
