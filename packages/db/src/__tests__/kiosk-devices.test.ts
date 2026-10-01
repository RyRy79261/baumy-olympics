import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import {
  KIOSK_SEEN_EVERY_MS,
  findPairedKioskDevice,
  hashKioskToken,
  kioskDeviceState,
  listKioskDevices,
  renameKioskDevice,
  revokeKioskDevice,
  touchKioskDevice,
} from "../kiosk-devices";
import {
  KIOSK_PAIRING_EXCHANGE_GRACE_MS,
  KIOSK_PAIRING_TTL_MS,
  approveKioskPairing,
  claimApprovedKioskPairing,
  insertKioskPairingRequest,
} from "../kiosk-pairing";
import { kioskDevices, members } from "../schema";
import { useTestDb } from "./_harness";

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-09-27T10:00:00Z");
const OTHER_HOUSEHOLD = "00000000-0000-4000-8000-000000000099";

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

/** An approved device, not yet picked up by its iPad (the secret `code`). */
async function approved(code = "ABC234", at = NOW) {
  const req = await insertKioskPairingRequest(db(), {
    householdId: HOUSEHOLD_ID,
    secret: `secret-${code}`,
    code,
    device: "Safari on iPad",
    now: at,
  });
  const row = await approveKioskPairing(db(), {
    requestId: req!.id,
    householdId: HOUSEHOLD_ID,
    name: "Kitchen iPad",
    approvedBy: await admin(),
    expiresAt: req!.expiresAt,
    now: at,
  });
  return { id: row!.deviceId, secret: `secret-${code}` };
}

/** A paired device whose token hashes to `tokenHash`. */
async function paired(code: string, tokenHash: string, at = NOW) {
  const { id, secret } = await approved(code, at);
  await claimApprovedKioskPairing(db(), { secret, tokenHash, now: at });
  return { id };
}

async function stored(id: string) {
  const [row] = await t
    .db()
    .select()
    .from(kioskDevices)
    .where(eq(kioskDevices.id, id));
  return row!;
}

describe("hashKioskToken", () => {
  it("hashes a token with sha256, case-sensitively", () => {
    expect(hashKioskToken("tok")).toBe(
      "1a7674eb4ee78df7e1ac439a93c3fa8e3c945784d4dec9fd8e3011738b2f1d62",
    );
    expect(hashKioskToken("Tok")).not.toBe(hashKioskToken("tok"));
  });
});

describe("findPairedKioskDevice", () => {
  it("finds a paired device by its token hash, never an unpaired or revoked one", async () => {
    const { id, secret } = await approved("ABC234");
    const tokenHash = hashKioskToken("token-1");
    await expect(findPairedKioskDevice(tokenHash)).resolves.toBeNull();
    await claimApprovedKioskPairing(db(), { secret, tokenHash, now: NOW });
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
    const { id } = await paired("ABC234", hashKioskToken("token-1"));
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
  it("revokes once, cancels an approval not picked up, and stays in its household", async () => {
    const { id, secret } = await approved("ABC234");
    await expect(
      revokeKioskDevice(db(), {
        householdId: OTHER_HOUSEHOLD,
        id,
        now: NOW,
      }),
    ).resolves.toBeNull();
    await expect(
      revokeKioskDevice(db(), { householdId: HOUSEHOLD_ID, id, now: NOW }),
    ).resolves.toEqual({ id, name: "Kitchen iPad", paired: false });
    expect((await stored(id)).revokedAt).toEqual(NOW);
    await expect(
      revokeKioskDevice(db(), { householdId: HOUSEHOLD_ID, id, now: NOW }),
    ).resolves.toBeNull();
    // The iPad's exchange then pairs nothing.
    await expect(
      claimApprovedKioskPairing(db(), {
        secret,
        tokenHash: hashKioskToken("late"),
        now: NOW,
      }),
    ).resolves.toBeNull();
    expect((await stored(id)).tokenHash).toBeNull();
  });
});

describe("renameKioskDevice", () => {
  it("renames a device of this household that is not revoked", async () => {
    const { id } = await paired("ABC234", hashKioskToken("t"));
    await expect(
      renameKioskDevice(db(), {
        householdId: OTHER_HOUSEHOLD,
        id,
        name: "Nope",
      }),
    ).resolves.toBeNull();
    await expect(
      renameKioskDevice(db(), {
        householdId: HOUSEHOLD_ID,
        id,
        name: "Fridge",
      }),
    ).resolves.toEqual({ id, name: "Fridge" });
    expect((await stored(id)).name).toBe("Fridge");
    await revokeKioskDevice(db(), { householdId: HOUSEHOLD_ID, id, now: NOW });
    await expect(
      renameKioskDevice(db(), { householdId: HOUSEHOLD_ID, id, name: "Late" }),
    ).resolves.toBeNull();
    expect((await stored(id)).name).toBe("Fridge");
  });
});

describe("kioskDeviceState and listKioskDevices", () => {
  it("says where each device stands, newest first, without hashes", async () => {
    const waiting = await approved("AAA234", NOW);
    const pairedRow = await paired(
      "BBB234",
      hashKioskToken("b"),
      new Date(NOW.getTime() + 1),
    );
    const revoked = await approved("CCC234", new Date(NOW.getTime() + 2));
    await revokeKioskDevice(db(), {
      householdId: HOUSEHOLD_ID,
      id: revoked.id,
      now: NOW,
    });

    const list = await listKioskDevices(db(), HOUSEHOLD_ID);
    expect(list.map((d) => d.id)).toEqual([
      revoked.id,
      pairedRow.id,
      waiting.id,
    ]);
    expect(JSON.stringify(list)).not.toMatch(/[0-9a-f]{64}/);
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    const state = (id: string, when: Date) =>
      kioskDeviceState(
        list.find((d) => d.id === id)!,
        when,
      );
    const pickUpBy = KIOSK_PAIRING_TTL_MS + KIOSK_PAIRING_EXCHANGE_GRACE_MS;
    expect(state(waiting.id, NOW)).toBe("waiting");
    expect(state(waiting.id, at(pickUpBy - 1))).toBe("waiting");
    expect(state(waiting.id, at(pickUpBy))).toBe("expired");
    expect(state(pairedRow.id, at(pickUpBy))).toBe("paired");
    expect(state(revoked.id, NOW)).toBe("revoked");
    expect(
      kioskDeviceState(
        { revokedAt: null, pairedAt: null, pairingExpiresAt: null },
        NOW,
      ),
    ).toBe("expired");
  });

  it("rejects a paired row without a token (the check constraint)", async () => {
    const { id } = await approved("ABC234");
    await expect(
      t
        .db()
        .update(kioskDevices)
        .set({ pairedAt: NOW })
        .where(eq(kioskDevices.id, id)),
    ).rejects.toThrow();
  });
});
