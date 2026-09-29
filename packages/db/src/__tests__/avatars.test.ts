import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countLiveAvatars,
  findAvatar,
  findAvatarPathname,
  insertAvatar,
  listAvatars,
  setAvatarArchived,
  setMemberAvatarImage,
} from "../avatars";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { listActiveMembers } from "../members";
import { listActiveReminders } from "../reminders";
import { members } from "../schema";
import { useTestDb } from "./_harness";

// The avatar gallery (issue #111): add, list, archive and restore, and the
// member's pick showing up in the rosters every screen reads.

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

async function add(name: string, at = NOW) {
  const id = randomUUID();
  const row = await insertAvatar(db(), {
    id,
    householdId: HOUSEHOLD_ID,
    name,
    pathname: `avatars/${id}/abcdefgh12345678.png`,
    width: 28,
    height: 56,
    createdBy: admin,
    createdAt: at,
  });
  return row!;
}

describe("insertAvatar and listAvatars", () => {
  it("adds sprites and lists them oldest first, with who wears them", async () => {
    const a = await add("Knight", new Date("2026-09-29T09:00:00Z"));
    const b = await add("Mage");
    expect(a).toEqual({
      id: a.id,
      pathname: `avatars/${a.id}/abcdefgh12345678.png`,
      width: 28,
      height: 56,
    });
    await setMemberAvatarImage(db(), admin, b.id);
    const listed = await listAvatars(db(), HOUSEHOLD_ID);
    expect(listed.map((r) => [r.name, r.wornBy])).toEqual([
      ["Knight", 0],
      ["Mage", 1],
    ]);
    expect(listed[0]).toMatchObject({ archivedAt: null, width: 28 });
    expect(await countLiveAvatars(db(), HOUSEHOLD_ID)).toBe(2);
  });

  it("writes nothing for a replayed id", async () => {
    const a = await add("Knight");
    const again = await insertAvatar(db(), {
      id: a.id,
      householdId: HOUSEHOLD_ID,
      name: "Other",
      pathname: "avatars/x/other.png",
      width: 1,
      height: 1,
      createdBy: admin,
      createdAt: NOW,
    });
    expect(again).toBeNull();
    expect((await listAvatars(db(), HOUSEHOLD_ID)).map((r) => r.name)).toEqual(
      ["Knight"],
    );
  });
});

describe("setAvatarArchived", () => {
  it("archives a live sprite and restores it, compare-and-set", async () => {
    const a = await add("Knight");
    const live = await add("Mage");

    expect(
      await setAvatarArchived(db(), {
        householdId: HOUSEHOLD_ID,
        avatarId: a.id,
        archived: true,
        now: NOW,
      }),
    ).toEqual({ ok: true, name: "Knight" });
    expect((await listAvatars(db(), HOUSEHOLD_ID, false)).map((r) => r.id)).toEqual([live.id]);
    expect((await listAvatars(db(), HOUSEHOLD_ID, true)).map((r) => r.id)).toEqual([a.id]);
    expect(await countLiveAvatars(db(), HOUSEHOLD_ID)).toBe(1);
    expect((await findAvatar(db(), HOUSEHOLD_ID, a.id))?.archivedAt).toEqual(
      NOW,
    );

    // Archiving it again lost the race.
    expect(
      await setAvatarArchived(db(), {
        householdId: HOUSEHOLD_ID,
        avatarId: a.id,
        archived: true,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "STALE" });

    expect(
      await setAvatarArchived(db(), {
        householdId: HOUSEHOLD_ID,
        avatarId: a.id,
        archived: false,
        now: NOW,
      }),
    ).toEqual({ ok: true, name: "Knight" });
    expect(
      await setAvatarArchived(db(), {
        householdId: HOUSEHOLD_ID,
        avatarId: a.id,
        archived: false,
        now: NOW,
      }),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await countLiveAvatars(db(), HOUSEHOLD_ID)).toBe(2);
  });

  it("is NOT_FOUND for a sprite that does not exist", async () => {
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
  it("shows in the rosters, and comes off again", async () => {
    const a = await add("Knight");
    const ref = { id: a.id, pathname: a.pathname, width: 28, height: 56 };
    expect((await listActiveMembers(db(), HOUSEHOLD_ID))[0]).toMatchObject({
      id: admin,
      avatarImage: null,
    });

    expect(await setMemberAvatarImage(db(), admin, a.id)).toBe(true);
    expect((await listActiveMembers(db(), HOUSEHOLD_ID))[0]).toMatchObject({
      id: admin,
      avatarImage: ref,
    });
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).members[0],
    ).toMatchObject({ id: admin, avatarImage: ref });

    // Archived, it stays on whoever wears it.
    await setAvatarArchived(db(), {
      householdId: HOUSEHOLD_ID,
      avatarId: a.id,
      archived: true,
      now: NOW,
    });
    expect(
      (await listActiveMembers(db(), HOUSEHOLD_ID))[0]?.avatarImage,
    ).toEqual(ref);

    expect(await setMemberAvatarImage(db(), admin, null)).toBe(true);
    const [row] = await t
      .db()
      .select({ id: members.avatarImageId })
      .from(members)
      .where(eq(members.id, admin));
    expect(row?.id).toBeNull();
    expect(
      (await listActiveReminders(db(), HOUSEHOLD_ID)).members[0]?.avatarImage,
    ).toBeNull();
  });

  it("is false for a member who does not exist", async () => {
    expect(await setMemberAvatarImage(db(), randomUUID(), null)).toBe(false);
  });

  it("finds a sprite's pathname for the proxy, in its household only", async () => {
    const a = await add("Knight");
    expect(await findAvatarPathname(db(), HOUSEHOLD_ID, a.id)).toBe(a.pathname);
    expect(await findAvatarPathname(db(), HOUSEHOLD_ID, randomUUID())).toBeNull();
    expect(await findAvatar(db(), HOUSEHOLD_ID, randomUUID())).toBeNull();
  });
});
