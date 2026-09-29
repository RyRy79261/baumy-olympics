import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countLiveAvatars,
  findAvatar,
  findAvatarPathname,
  insertAvatar,
  listAvatars,
  posesFor,
  setAvatarArchived,
  setMemberAvatarImage,
  type PoseRefs,
} from "../avatars";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { listActiveMembers } from "../members";
import { listActiveReminders } from "../reminders";
import { avatarPoses, members } from "../schema";
import { useTestDb } from "./_harness";

// The avatar gallery (issue #111): sets of poses; add, list, archive and
// restore, and the member's pick showing up in the rosters every screen
// reads.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-09-29T10:00:00Z");

let admin: string;
beforeEach(async () => {
  const [row] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      authUserId: `u_${randomUUID()}`,
      displayName: "Ryan",
      avatarSprite: "cat",
      color: "#ff8800",
      role: "admin",
      createdAt: NOW,
    })
    .returning({ id: members.id });
  admin = row!.id;
});

const pose = (id: string, name: string, height = 64) => ({
  pathname: `avatars/${id}/${name}000000000000.png`,
  width: 30,
  height,
});

async function add(name: string, at = NOW, full = false) {
  const id = randomUUID();
  const poses: PoseRefs = full
    ? {
        idle: pose(id, "idle"),
        walk: pose(id, "walk", 63),
        emote: pose(id, "emot", 62),
      }
    : { idle: pose(id, "idle") };
  const row = await insertAvatar(db(), {
    id,
    householdId: HOUSEHOLD_ID,
    name,
    createdBy: admin,
    createdAt: at,
    poses,
  });
  return row!;
}

describe("insertAvatar and listAvatars", () => {
  it("adds sets with their poses and lists them oldest first, with who wears them", async () => {
    const a = await add("Knight", new Date("2026-09-29T09:00:00Z"));
    const b = await add("Harper", NOW, true);
    expect(a.poses).toEqual({ idle: pose(a.id, "idle") });
    await setMemberAvatarImage(db(), admin, b.id);
    const listed = await listAvatars(db(), HOUSEHOLD_ID);
    expect(listed.map((r) => [r.name, r.wornBy])).toEqual([
      ["Knight", 0],
      ["Harper", 1],
    ]);
    expect(listed[1]!.poses).toEqual(b.poses);
    expect(Object.keys(listed[1]!.poses).sort()).toEqual([
      "emote",
      "idle",
      "walk",
    ]);
    expect(listed[0]).toMatchObject({ archivedAt: null });
    expect(await countLiveAvatars(db(), HOUSEHOLD_ID)).toBe(2);
  });

  it("writes nothing for a replayed id", async () => {
    const a = await add("Knight");
    const again = await insertAvatar(db(), {
      id: a.id,
      householdId: HOUSEHOLD_ID,
      name: "Other",
      createdBy: admin,
      createdAt: NOW,
      poses: { idle: pose(a.id, "othr") },
    });
    expect(again).toBeNull();
    expect((await listAvatars(db(), HOUSEHOLD_ID)).map((r) => r.name)).toEqual([
      "Knight",
    ]);
  });

  it("posesFor skips a set with no idle pose, and nothing asked is nothing", async () => {
    const a = await add("Knight");
    await t.db().delete(avatarPoses).where(eq(avatarPoses.avatarId, a.id));
    expect((await posesFor(db(), [a.id])).size).toBe(0);
    expect((await posesFor(db(), [])).size).toBe(0);
    expect(await listAvatars(db(), HOUSEHOLD_ID)).toEqual([]);
  });
});

describe("setAvatarArchived", () => {
  it("archives a live set and restores it, compare-and-set", async () => {
    const a = await add("Knight");
    const live = await add("Mage");
    const set = (archived: boolean) =>
      setAvatarArchived(db(), {
        householdId: HOUSEHOLD_ID,
        avatarId: a.id,
        archived,
        now: NOW,
      });

    expect(await set(true)).toEqual({ ok: true, name: "Knight" });
    expect(
      (await listAvatars(db(), HOUSEHOLD_ID, false)).map((r) => r.id),
    ).toEqual([live.id]);
    expect(
      (await listAvatars(db(), HOUSEHOLD_ID, true)).map((r) => r.id),
    ).toEqual([a.id]);
    expect(await countLiveAvatars(db(), HOUSEHOLD_ID)).toBe(1);
    expect((await findAvatar(db(), HOUSEHOLD_ID, a.id))?.archivedAt).toEqual(
      NOW,
    );
    // Archiving it again lost the race.
    expect(await set(true)).toEqual({ ok: false, code: "STALE" });
    expect(await set(false)).toEqual({ ok: true, name: "Knight" });
    expect(await set(false)).toEqual({ ok: false, code: "STALE" });
    expect(await countLiveAvatars(db(), HOUSEHOLD_ID)).toBe(2);
  });

  it("is NOT_FOUND for a set that does not exist", async () => {
    expect(
      await setAvatarArchived(db(), {
        householdId: HOUSEHOLD_ID,
        avatarId: randomUUID(),
        archived: true,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("a member's pick", () => {
  it("shows in the rosters with every pose, and comes off again", async () => {
    const a = await add("Harper", NOW, true);
    expect((await listActiveMembers(db(), HOUSEHOLD_ID))[0]).toMatchObject({
      id: admin,
      avatarImage: null,
    });

    expect(await setMemberAvatarImage(db(), admin, a.id)).toBe(true);
    expect((await listActiveMembers(db(), HOUSEHOLD_ID))[0]).toMatchObject({
      id: admin,
      avatarImage: a,
    });
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).members[0],
    ).toMatchObject({ id: admin, avatarImage: a });

    // Archived, it stays on whoever wears it.
    await setAvatarArchived(db(), {
      householdId: HOUSEHOLD_ID,
      avatarId: a.id,
      archived: true,
      now: NOW,
    });
    expect(
      (await listActiveMembers(db(), HOUSEHOLD_ID))[0]?.avatarImage,
    ).toEqual(a);

    expect(await setMemberAvatarImage(db(), admin, null)).toBe(true);
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).members[0]?.avatarImage,
    ).toBeNull();
  });

  it("is false for a member who does not exist", async () => {
    expect(await setMemberAvatarImage(db(), randomUUID(), null)).toBe(false);
  });

  it("finds a pose's pathname for the proxy, in its set and household only", async () => {
    const a = await add("Harper", NOW, true);
    const b = await add("Knight");
    const walk = a.poses.walk!.pathname;
    expect(await findAvatarPathname(db(), HOUSEHOLD_ID, a.id, walk)).toBe(walk);
    expect(await findAvatarPathname(db(), HOUSEHOLD_ID, b.id, walk)).toBeNull();
    expect(await findAvatarPathname(db(), randomUUID(), a.id, walk)).toBeNull();
    expect(await findAvatar(db(), HOUSEHOLD_ID, randomUUID())).toBeNull();
  });
});
