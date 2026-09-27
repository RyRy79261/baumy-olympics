import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  KIOSK_PAIRING_TTL_MS,
  KIOSK_SEEN_EVERY_MS,
  claimKioskPairing,
  findPairedKioskDevice,
  hashKioskToken,
  hashPairingCode,
  insertKioskPairing,
  kioskDeviceState,
  listKioskDevices,
  normalizePairingCode,
  revokeKioskDevice,
  touchKioskDevice,
} from "../kiosk-devices";
import { kioskDevices, members } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-09-27T10:00:00Z");
const MIN = 60_000;

async function admin(): Promise<string> {
  const [row] = await t
    .db()
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      displayName: "Admin",
      avatarSprite: "cat",
      color: "#112233",
      role: "admin",
    })
    .returning({ id: members.id });
  return row!.id;
}

async function pairing(code = "ABCD2345", at = NOW) {
  const pairedBy = await admin();
  const row = await insertKioskPairing(db(), {
    householdId: HOUSEHOLD_ID,
    name: "Kitchen iPad",
    code,
    pairedBy,
    now: at,
  });
  return row!;
}

async function stored(id: string) {
  const [row] = await t
    .db()
    .select()
    .from(kioskDevices)
    .where(eq(kioskDevices.id, id));
  return row!;
}

describe("pairing codes and tokens", () => {
  it("normalises a code however it is typed", () => {
    expect(normalizePairingCode(" abcd-2345 ")).toBe("ABCD2345");
    expect(hashPairingCode("abcd 2345")).toBe(hashPairingCode("ABCD-2345"));
    expect(hashPairingCode("ABCD2345")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPairingCode("ABCD2346")).not.toBe(hashPairingCode("ABCD2345"));
  });

  it("hashes a token with sha256, case-sensitively", () => {
    expect(hashKioskToken("tok")).toBe(
      "1a7674eb4ee78df7e1ac439a93c3fa8e3c945784d4dec9fd8e3011738b2f1d62",
    );
    expect(hashKioskToken("Tok")).not.toBe(hashKioskToken("tok"));
  });
});

describe("insertKioskPairing", () => {
  it("stores only the code's hash, expiring in 10 minutes", async () => {
    const { id, expiresAt } = await pairing("ABCD2345");
    expect(expiresAt.getTime() - NOW.getTime()).toBe(KIOSK_PAIRING_TTL_MS);
    const row = await stored(id);
    expect(row).toMatchObject({
      name: "Kitchen iPad",
      pairingCodeHash: hashPairingCode("ABCD2345"),
      pairingExpiresAt: expiresAt,
      tokenHash: null,
      pairedAt: null,
      revokedAt: null,
    });
    expect(JSON.stringify(row)).not.toContain("ABCD2345");
  });

  it("returns null on a code collision, writing nothing", async () => {
    await pairing("ABCD2345");
    const again = await insertKioskPairing(db(), {
      householdId: HOUSEHOLD_ID,
      name: "Other",
      code: "abcd-2345",
      pairedBy: await admin(),
      now: NOW,
    });
    expect(again).toBeNull();
    expect(await t.db().select().from(kioskDevices)).toHaveLength(1);
  });
});

describe("claimKioskPairing", () => {
  it("pairs once: the code is cleared and a second use finds nothing", async () => {
    const { id } = await pairing("ABCD2345");
    const later = new Date(NOW.getTime() + 2 * MIN);
    const first = await claimKioskPairing(db(), {
      code: "abcd-2345",
      tokenHash: hashKioskToken("token-1"),
      now: later,
    });
    expect(first).toEqual({
      id,
      householdId: HOUSEHOLD_ID,
      name: "Kitchen iPad",
    });
    expect(await stored(id)).toMatchObject({
      tokenHash: hashKioskToken("token-1"),
      pairingCodeHash: null,
      pairedAt: later,
      lastSeenAt: later,
    });

    const second = await claimKioskPairing(db(), {
      code: "ABCD2345",
      tokenHash: hashKioskToken("token-2"),
      now: later,
    });
    expect(second).toBeNull();
    expect((await stored(id)).tokenHash).toBe(hashKioskToken("token-1"));
  });

  it("refuses an expired, revoked or unknown code", async () => {
    const { id } = await pairing("ABCD2345");
    const tokenHash = hashKioskToken("t");
    await expect(
      claimKioskPairing(db(), { code: "ZZZZ2345", tokenHash, now: NOW }),
    ).resolves.toBeNull();
    await expect(
      claimKioskPairing(db(), {
        code: "ABCD2345",
        tokenHash,
        now: new Date(NOW.getTime() + KIOSK_PAIRING_TTL_MS),
      }),
    ).resolves.toBeNull();
    await revokeKioskDevice(db(), { householdId: HOUSEHOLD_ID, id, now: NOW });
    await expect(
      claimKioskPairing(db(), { code: "ABCD2345", tokenHash, now: NOW }),
    ).resolves.toBeNull();
    // Just inside the window it would have worked.
    const { id: other } = await pairing("WXYZ2345");
    await expect(
      claimKioskPairing(db(), {
        code: "WXYZ2345",
        tokenHash,
        now: new Date(NOW.getTime() + KIOSK_PAIRING_TTL_MS - 1),
      }),
    ).resolves.toMatchObject({ id: other });
  });
});

describe("findPairedKioskDevice", () => {
  it("finds a paired device by its token hash, never an unpaired or revoked one", async () => {
    const { id } = await pairing("ABCD2345");
    const tokenHash = hashKioskToken("token-1");
    await expect(findPairedKioskDevice(tokenHash)).resolves.toBeNull();
    await claimKioskPairing(db(), { code: "ABCD2345", tokenHash, now: NOW });
    await expect(findPairedKioskDevice(tokenHash)).resolves.toEqual({
      id,
      householdId: HOUSEHOLD_ID,
      name: "Kitchen iPad",
      lastSeenAt: NOW,
    });
    await expect(
      findPairedKioskDevice(hashKioskToken("token-2")),
    ).resolves.toBeNull();

    await expect(
      revokeKioskDevice(db(), { householdId: HOUSEHOLD_ID, id, now: NOW }),
    ).resolves.toEqual({ id, name: "Kitchen iPad", paired: true });
    await expect(findPairedKioskDevice(tokenHash)).resolves.toBeNull();
  });
});

describe("touchKioskDevice", () => {
  it("writes last_seen_at at most every 5 minutes", async () => {
    const { id } = await pairing("ABCD2345");
    const tokenHash = hashKioskToken("token-1");
    await claimKioskPairing(db(), { code: "ABCD2345", tokenHash, now: NOW });
    const soon = new Date(NOW.getTime() + KIOSK_SEEN_EVERY_MS - 1);
    await touchKioskDevice({ id, lastSeenAt: NOW }, soon);
    expect((await stored(id)).lastSeenAt).toEqual(NOW);
    const later = new Date(NOW.getTime() + KIOSK_SEEN_EVERY_MS);
    await touchKioskDevice({ id, lastSeenAt: NOW }, later);
    expect((await stored(id)).lastSeenAt).toEqual(later);
    await touchKioskDevice({ id, lastSeenAt: null }, soon);
    expect((await stored(id)).lastSeenAt).toEqual(soon);
  });
});

describe("revokeKioskDevice", () => {
  it("revokes once, cancels an unused code, and stays in its household", async () => {
    const { id } = await pairing("ABCD2345");
    await expect(
      revokeKioskDevice(db(), {
        householdId: "00000000-0000-4000-8000-000000000099",
        id,
        now: NOW,
      }),
    ).resolves.toBeNull();
    await expect(
      revokeKioskDevice(db(), { householdId: HOUSEHOLD_ID, id, now: NOW }),
    ).resolves.toEqual({ id, name: "Kitchen iPad", paired: false });
    expect(await stored(id)).toMatchObject({
      revokedAt: NOW,
      pairingCodeHash: null,
    });
    await expect(
      revokeKioskDevice(db(), { householdId: HOUSEHOLD_ID, id, now: NOW }),
    ).resolves.toBeNull();
  });
});

describe("kioskDeviceState and listKioskDevices", () => {
  it("says where each device stands, newest first, without hashes", async () => {
    const waiting = await pairing("AAAA2345", NOW);
    const paired = await pairing("BBBB2345", new Date(NOW.getTime() + 1));
    await claimKioskPairing(db(), {
      code: "BBBB2345",
      tokenHash: hashKioskToken("b"),
      now: NOW,
    });
    const revoked = await pairing("CCCC2345", new Date(NOW.getTime() + 2));
    await revokeKioskDevice(db(), {
      householdId: HOUSEHOLD_ID,
      id: revoked.id,
      now: NOW,
    });

    const list = await listKioskDevices(db(), HOUSEHOLD_ID);
    expect(list.map((d) => d.id)).toEqual([revoked.id, paired.id, waiting.id]);
    expect(JSON.stringify(list)).not.toMatch(/[0-9a-f]{64}/);
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    const state = (id: string, when: Date) =>
      kioskDeviceState(
        list.find((d) => d.id === id)!,
        when,
      );
    expect(state(waiting.id, NOW)).toBe("waiting");
    expect(state(waiting.id, at(KIOSK_PAIRING_TTL_MS))).toBe("expired");
    expect(state(paired.id, at(KIOSK_PAIRING_TTL_MS))).toBe("paired");
    expect(state(revoked.id, NOW)).toBe("revoked");
    expect(
      kioskDeviceState(
        { revokedAt: null, pairedAt: null, pairingExpiresAt: null },
        NOW,
      ),
    ).toBe("expired");
  });

  it("rejects a paired row without a token (the check constraint)", async () => {
    const { id } = await pairing("ABCD2345");
    await expect(
      t
        .db()
        .update(kioskDevices)
        .set({ pairedAt: NOW })
        .where(eq(kioskDevices.id, id)),
    ).rejects.toThrow();
  });
});
