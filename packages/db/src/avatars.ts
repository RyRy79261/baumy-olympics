import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import type { Queryable } from "./index";
import { avatarPoses, avatars, members } from "./schema";

// The avatar gallery (issue #111): character SETS, each with an idle pose
// and, maybe, walk and emote. Every function takes the caller's handle (the
// action's transaction for writes), and none writes an audit row: runAction
// does that (AGENTS.md). Rows are never deleted: archiving hides a set from
// the gallery, and whoever already wears it keeps it.

export type AvatarPose = (typeof avatarPoses.$inferSelect)["pose"];

/** One stored pose: where its PNG is, and its own size in pixels. */
export interface PoseRef {
  pathname: string;
  width: number;
  height: number;
}

/** A set's poses: idle always, walk and emote when the owner made them. */
export type PoseRefs = { idle: PoseRef } & Partial<Record<AvatarPose, PoseRef>>;

/** What a screen needs to draw a member's character from the gallery. */
export interface AvatarImageRef {
  id: string;
  poses: PoseRefs;
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

/** The poses of each of `avatarIds` that has an idle one. */
export async function posesFor(
  db: Queryable,
  avatarIds: readonly string[],
): Promise<Map<string, PoseRefs>> {
  const out = new Map<string, PoseRefs>();
  const ids = [...new Set(avatarIds)];
  if (ids.length === 0) return out;
  const rows = await db
    .select()
    .from(avatarPoses)
    .where(inArray(avatarPoses.avatarId, ids));
  const partial = new Map<string, Partial<Record<AvatarPose, PoseRef>>>();
  for (const r of rows) {
    const p = partial.get(r.avatarId) ?? {};
    p[r.pose] = { pathname: r.pathname, width: r.width, height: r.height };
    partial.set(r.avatarId, p);
  }
  for (const [id, p] of partial) if (p.idle) out.set(id, p as PoseRefs);
  return out;
}

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
  const rows = await db
    .select({
      id: avatars.id,
      name: avatars.name,
      createdAt: avatars.createdAt,
      archivedAt: avatars.archivedAt,
      wornBy,
    })
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
  const poses = await posesFor(
    db,
    rows.map((r) => r.id),
  );
  return rows.flatMap((r) => {
    const p = poses.get(r.id);
    return p ? [{ ...r, poses: p }] : [];
  });
}

/** One set of the household, archived or not, or null. */
export async function findAvatar(
  db: Queryable,
  householdId: string,
  avatarId: string,
): Promise<AvatarRow | null> {
  const rows = await listAvatars(db, householdId);
  return rows.find((r) => r.id === avatarId) ?? null;
}

/** How many sets the gallery offers now (not archived). */
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
  createdBy: string;
  createdAt: Date;
  poses: PoseRefs;
}

/**
 * Add a set with its poses. Null, writing nothing, when that id is already
 * taken: the upload route picks a fresh id per set, so only a replay lands
 * here.
 */
export async function insertAvatar(
  db: Queryable,
  input: NewAvatar,
): Promise<AvatarImageRef | null> {
  const { poses, ...set } = input;
  const [row] = await db
    .insert(avatars)
    .values(set)
    .onConflictDoNothing()
    .returning({ id: avatars.id });
  if (!row) return null;
  await db.insert(avatarPoses).values(
    Object.entries(poses).map(([pose, p]) => ({
      avatarId: row.id,
      pose: pose as AvatarPose,
      ...p,
    })),
  );
  return { id: row.id, poses };
}

export type ArchiveResult =
  { ok: true; name: string } | { ok: false; code: "NOT_FOUND" | "STALE" };

/**
 * Archive (`archived: true`) or restore a set, compare-and-set on its state:
 * archiving an archived one, or restoring a live one, is `STALE` (another
 * admin got there first).
 */
export async function setAvatarArchived(
  db: Queryable,
  input: {
    householdId: string;
    avatarId: string;
    archived: boolean;
    now: Date;
  },
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
  const [exists] = await db
    .select({ id: avatars.id })
    .from(avatars)
    .where(
      and(
        eq(avatars.id, input.avatarId),
        eq(avatars.householdId, input.householdId),
      ),
    );
  return { ok: false, code: exists ? "STALE" : "NOT_FOUND" };
}

/**
 * Whether `pathname` is one of the poses of that set of the household, for
 * the /api/blob proxy: the pathname when it is, else null.
 */
export async function findAvatarPathname(
  db: Queryable,
  householdId: string,
  avatarId: string,
  pathname: string,
): Promise<string | null> {
  const [row] = await db
    .select({ pathname: avatarPoses.pathname })
    .from(avatarPoses)
    .innerJoin(avatars, eq(avatars.id, avatarPoses.avatarId))
    .where(
      and(
        eq(avatarPoses.avatarId, avatarId),
        eq(avatarPoses.pathname, pathname),
        eq(avatars.householdId, householdId),
      ),
    )
    .limit(1);
  return row?.pathname ?? null;
}

/**
 * Put a set on a member, or take theirs off (`avatarImageId: null`). False
 * when the member does not exist.
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
 * Member rows with their `avatarImageId`, given their gallery character
 * (`avatarImage`, null for none) from one more read.
 */
export async function withAvatarImages<
  T extends { avatarImageId: string | null },
>(
  db: Queryable,
  rows: T[],
): Promise<
  (Omit<T, "avatarImageId"> & { avatarImage: AvatarImageRef | null })[]
> {
  const poses = await posesFor(
    db,
    rows.flatMap((r) => (r.avatarImageId ? [r.avatarImageId] : [])),
  );
  return rows.map(({ avatarImageId, ...rest }) => {
    const p = avatarImageId ? poses.get(avatarImageId) : undefined;
    return {
      ...rest,
      avatarImage: p ? { id: avatarImageId!, poses: p } : null,
    };
  });
}
