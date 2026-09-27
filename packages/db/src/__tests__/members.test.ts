import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  findActiveMemberByAuthUserId,
  findMemberByAuthUserId,
  hasKioskPin,
  insertMember,
  listMembers,
  lockMember,
  lockOtherActiveAdmins,
  setKioskPinHash,
  updateMember,
} from "../members";
import { members } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();

async function seed(authUserId: string, deactivatedAt: Date | null = null) {
  const [row] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      authUserId,
      displayName: "Ryan",
      avatarSprite: "cat",
      color: "#ff8800",
      role: "admin",
      deactivatedAt,
    })
    .returning();
  return row!;
}

describe("findActiveMemberByAuthUserId", () => {
  it("returns the member linked to the auth user", async () => {
    const row = await seed("u_1");
    await expect(findActiveMemberByAuthUserId("u_1")).resolves.toEqual({
      id: row.id,
      householdId: HOUSEHOLD_ID,
      role: "admin",
      displayName: "Ryan",
    });
  });

  it("returns null for an unknown user and for a deactivated member", async () => {
    await seed("u_gone", new Date("2026-01-01T00:00:00Z"));
    await expect(findActiveMemberByAuthUserId("u_gone")).resolves.toBeNull();
    await expect(findActiveMemberByAuthUserId("u_none")).resolves.toBeNull();
  });
});

describe("member writes and listings", () => {
  const db = () => t.db() as unknown as Queryable;
  const NOW = new Date("2026-09-27T10:00:00Z");
  const base = {
    householdId: HOUSEHOLD_ID,
    avatarSprite: "fox",
    color: "#aabbcc",
    createdAt: NOW,
  };

  it("insertMember creates one row per auth user and refuses a second", async () => {
    const first = await insertMember(db(), {
      ...base,
      authUserId: "u_join",
      displayName: "First",
      role: "admin",
    });
    expect(first).toMatchObject({ role: "admin" });
    await expect(
      insertMember(db(), {
        ...base,
        authUserId: "u_join",
        displayName: "Second",
        role: "member",
      }),
    ).resolves.toBeNull();
    await expect(findMemberByAuthUserId(db(), "u_join")).resolves.toEqual({
      id: first!.id,
      deactivatedAt: null,
    });
    await expect(findMemberByAuthUserId(db(), "u_none")).resolves.toBeNull();
  });

  it("listMembers puts active members first, oldest first, with flags", async () => {
    const gone = await seed("u_gone", new Date("2026-01-01T00:00:00Z"));
    const a = await seed("u_a");
    await updateMember(db(), a.id, { displayName: "Alpha" });
    await setKioskPinHash(db(), a.id, "scrypt$hash");
    const list = await listMembers(db(), HOUSEHOLD_ID);
    expect(list.map((m) => m.id)).toEqual([a.id, gone.id]);
    expect(list[0]).toMatchObject({
      displayName: "Alpha",
      hasAccount: true,
      hasKioskPin: true,
      telegramLinked: false,
    });
    expect(list[1]).toMatchObject({ hasKioskPin: false });
    expect(list[0]).not.toHaveProperty("kioskPinHash");
  });

  it("lockOtherActiveAdmins lists the other active admins only", async () => {
    const me = await seed("u_me");
    const other = await seed("u_other");
    await seed("u_old_admin", new Date("2026-01-01T00:00:00Z"));
    const plain = await seed("u_plain");
    await updateMember(db(), plain.id, { role: "member" });
    const ids = await t
      .db()
      .transaction((tx) =>
        lockOtherActiveAdmins(tx as unknown as Queryable, HOUSEHOLD_ID, me.id),
      );
    expect(ids).toEqual([other.id]);
  });

  it("lockMember finds a household member, or null", async () => {
    const m = await seed("u_lock");
    await expect(lockMember(db(), HOUSEHOLD_ID, m.id)).resolves.toMatchObject({
      id: m.id,
    });
    await expect(
      lockMember(db(), HOUSEHOLD_ID, "00000000-0000-4000-8000-00000000dead"),
    ).resolves.toBeNull();
  });

  it("updateMember returns null for a missing member", async () => {
    await expect(
      updateMember(db(), "00000000-0000-4000-8000-00000000dead", {
        displayName: "X",
      }),
    ).resolves.toBeNull();
  });

  it("setKioskPinHash stores the hash and lifts the lock", async () => {
    const m = await seed("u_pin");
    await expect(hasKioskPin(db(), m.id)).resolves.toBe(false);
    await t
      .db()
      .update(members)
      .set({ kioskPinLockedAt: NOW })
      .where(eq(members.id, m.id));
    await expect(setKioskPinHash(db(), m.id, "scrypt$x")).resolves.toBe(true);
    await expect(hasKioskPin(db(), m.id)).resolves.toBe(true);
    const [row] = await t
      .db()
      .select()
      .from(members)
      .where(eq(members.id, m.id));
    expect(row).toMatchObject({
      kioskPinHash: "scrypt$x",
      kioskPinLockedAt: null,
    });
    await expect(
      setKioskPinHash(db(), "00000000-0000-4000-8000-00000000dead", "x"),
    ).resolves.toBe(false);
  });
});
