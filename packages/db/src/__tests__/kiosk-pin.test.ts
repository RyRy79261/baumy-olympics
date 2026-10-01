import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  clearKioskPinAttempts,
  findKioskPinState,
  kioskPinKeys,
  lockKioskPin,
  refundKioskPinAttempt,
} from "../kiosk-pin";
import {
  findActiveMember,
  findKioskPinLockedAt,
  listActiveMembers,
} from "../members";
import { consumeRateLimit } from "../rate-limit";
import { actionRateLimit, members } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-09-27T10:00:00Z");
const OTHER_HOUSEHOLD = "00000000-0000-4000-8000-000000000099";

async function member(
  overrides: Partial<typeof members.$inferInsert> = {},
): Promise<string> {
  const [row] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      displayName: "Ryan",
      avatarSprite: "cat",
      color: "#112233",
      ...overrides,
    })
    .returning({ id: members.id });
  return row!.id;
}

async function counters() {
  const rows = await t.db().select().from(actionRateLimit);
  return Object.fromEntries(rows.map((r) => [r.key, r.count]));
}

describe("kioskPinKeys", () => {
  it("names the per-device and the per-day counter", () => {
    expect(kioskPinKeys("d1", "m1")).toEqual({
      short: "pin:d1:m1",
      day: "pin24:m1",
    });
  });
});

describe("findKioskPinState", () => {
  it("reads the hash and lock of an active member of the household only", async () => {
    const id = await member({ kioskPinHash: "scrypt$x" });
    await expect(findKioskPinState(HOUSEHOLD_ID, id)).resolves.toEqual({
      pinHash: "scrypt$x",
      lockedAt: null,
    });
    await expect(findKioskPinState(OTHER_HOUSEHOLD, id)).resolves.toBeNull();
    const gone = await member({ deactivatedAt: NOW });
    await expect(findKioskPinState(HOUSEHOLD_ID, gone)).resolves.toBeNull();
  });
});

describe("lockKioskPin", () => {
  it("locks once: only the first call reports it", async () => {
    const id = await member();
    await expect(findKioskPinLockedAt(db(), id)).resolves.toBeNull();
    await expect(lockKioskPin(db(), id, NOW)).resolves.toBe(true);
    await expect(
      lockKioskPin(db(), id, new Date(NOW.getTime() + 1)),
    ).resolves.toBe(false);
    await expect(findKioskPinLockedAt(db(), id)).resolves.toEqual(NOW);
  });
});

describe("refundKioskPinAttempt and clearKioskPinAttempts", () => {
  it("gives an attempt back, never below zero", async () => {
    const key = "pin24:m";
    await consumeRateLimit({ key, limit: 10, windowMs: 60_000, now: NOW });
    await consumeRateLimit({ key, limit: 10, windowMs: 60_000, now: NOW });
    await refundKioskPinAttempt(key);
    expect(await counters()).toEqual({ [key]: 1 });
    await refundKioskPinAttempt(key);
    await refundKioskPinAttempt(key);
    expect(await counters()).toEqual({ [key]: 0 });
    // A key that was never counted is a no-op.
    await refundKioskPinAttempt("pin24:nobody");
    expect(await counters()).toEqual({ [key]: 0 });
  });

  it("clears one member's counters on every device, and nobody else's", async () => {
    const opts = { limit: 10, windowMs: 60_000, now: NOW };
    for (const key of [
      "pin:d1:m1",
      "pin:d2:m1",
      "pin24:m1",
      "pin:d1:m2",
      "pin24:m2",
      "action:x:member:m1",
    ]) {
      await consumeRateLimit({ key, ...opts });
    }
    await clearKioskPinAttempts(db(), "m1");
    expect(Object.keys(await counters()).sort()).toEqual([
      "action:x:member:m1",
      "pin24:m2",
      "pin:d1:m2",
    ]);
  });
});

describe("listActiveMembers and findActiveMember", () => {
  it("lists active members in join order, and finds one in the household", async () => {
    const a = await member({
      displayName: "A",
      createdAt: new Date(NOW.getTime() + 1),
    });
    const b = await member({ displayName: "B", createdAt: NOW });
    const gone = await member({ displayName: "Gone", deactivatedAt: NOW });
    const list = await listActiveMembers(db(), HOUSEHOLD_ID);
    expect(list.map((m) => m.id)).toEqual([b, a]);
    expect(list[0]).toEqual({
      id: b,
      displayName: "B",
      avatarSprite: "cat",
      color: "#112233",
      avatarImage: null,
    });
    await expect(findActiveMember(db(), HOUSEHOLD_ID, a)).resolves.toEqual({
      id: a,
      displayName: "A",
      avatarSprite: "cat",
      color: "#112233",
    });
    await expect(
      findActiveMember(db(), HOUSEHOLD_ID, gone),
    ).resolves.toBeNull();
    await expect(
      findActiveMember(db(), OTHER_HOUSEHOLD, a),
    ).resolves.toBeNull();
    const [row] = await t.db().select().from(members).where(eq(members.id, a));
    expect(row?.displayName).toBe("A");
  });
});
