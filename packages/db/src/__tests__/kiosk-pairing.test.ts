import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { hashKioskToken } from "../kiosk-devices";
import {
  KIOSK_PAIRING_EXCHANGE_GRACE_MS,
  KIOSK_PAIRING_RETENTION_MS,
  KIOSK_PAIRING_TTL_MS,
  approveKioskPairing,
  claimApprovedKioskPairing,
  findKioskPairingByCode,
  findKioskPairingBySecret,
  hashKioskPairingCode,
  hashKioskPairingSecret,
  insertKioskPairingRequest,
  kioskPairingState,
  lockKioskPairingByCode,
  normalizeKioskPairingCode,
  pruneKioskPairingRequests,
} from "../kiosk-pairing";
import { kioskDevices, kioskPairingRequests, members } from "../schema";
import { useTestDb } from "./_harness";

// Pairing the kitchen iPad by QR code (issue #126): a request with hashed
// secret and code, an admin's approval that creates the device, and a
// one-time exchange for the device token.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-10-01T10:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
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

async function request(code = "ABC234", secret = "secret-1", now = NOW) {
  const row = await insertKioskPairingRequest(db(), {
    householdId: HOUSEHOLD_ID,
    secret,
    code,
    device: "Safari on iPad",
    now,
  });
  return row!;
}

async function approve(id: string, expiresAt: Date, now = NOW) {
  return approveKioskPairing(db(), {
    requestId: id,
    householdId: HOUSEHOLD_ID,
    name: "Kitchen",
    approvedBy: await admin(),
    expiresAt,
    now,
  });
}

async function row(id: string) {
  const [r] = await t
    .db()
    .select()
    .from(kioskPairingRequests)
    .where(eq(kioskPairingRequests.id, id));
  return r!;
}

describe("codes and secrets", () => {
  it("normalises a code however it is typed, and hashes code and secret", () => {
    expect(normalizeKioskPairingCode(" abc-234 ")).toBe("ABC234");
    expect(hashKioskPairingCode("abc 234")).toBe(
      hashKioskPairingCode("ABC-234"),
    );
    expect(hashKioskPairingCode("ABC234")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKioskPairingCode("ABC235")).not.toBe(
      hashKioskPairingCode("ABC234"),
    );
    expect(hashKioskPairingSecret("s")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKioskPairingSecret("S")).not.toBe(hashKioskPairingSecret("s"));
  });
});

describe("kioskPairingState", () => {
  it("derives expired from the time, with a grace for an approval", () => {
    const expiresAt = at(KIOSK_PAIRING_TTL_MS);
    const s = (status: "pending" | "approved" | "used", ms: number) =>
      kioskPairingState({ status, expiresAt }, at(ms));
    expect(s("pending", KIOSK_PAIRING_TTL_MS - 1)).toBe("pending");
    expect(s("pending", KIOSK_PAIRING_TTL_MS)).toBe("expired");
    const graceEnd = KIOSK_PAIRING_TTL_MS + KIOSK_PAIRING_EXCHANGE_GRACE_MS;
    expect(s("approved", graceEnd - 1)).toBe("approved");
    expect(s("approved", graceEnd)).toBe("expired");
    expect(s("used", 0)).toBe("used");
  });
});

describe("insertKioskPairingRequest", () => {
  it("stores only hashes, pending for 10 minutes", async () => {
    const { id, expiresAt } = await request("ABC234", "the-secret");
    expect(expiresAt).toEqual(at(KIOSK_PAIRING_TTL_MS));
    const r = await row(id);
    expect(r).toMatchObject({
      householdId: HOUSEHOLD_ID,
      secretHash: hashKioskPairingSecret("the-secret"),
      codeHash: hashKioskPairingCode("ABC234"),
      device: "Safari on iPad",
      status: "pending",
      deviceId: null,
      createdAt: NOW,
      expiresAt,
    });
    const text = JSON.stringify(r);
    expect(text).not.toContain("ABC234");
    expect(text).not.toContain("the-secret");
  });

  it("returns null on a code or secret collision, writing nothing", async () => {
    await request("ABC234", "s1");
    await expect(
      insertKioskPairingRequest(db(), {
        householdId: HOUSEHOLD_ID,
        secret: "s2",
        code: "abc-234",
        device: "x",
        now: NOW,
      }),
    ).resolves.toBeNull();
    await expect(
      insertKioskPairingRequest(db(), {
        householdId: HOUSEHOLD_ID,
        secret: "s1",
        code: "XYZ234",
        device: "x",
        now: NOW,
      }),
    ).resolves.toBeNull();
    expect(await t.db().select().from(kioskPairingRequests)).toHaveLength(1);
  });
});

describe("finding a request", () => {
  it("by its secret, and by its code within the household only", async () => {
    const { id, expiresAt } = await request("ABC234", "s1");
    await expect(findKioskPairingBySecret(db(), "s1", NOW)).resolves.toEqual({
      id,
      state: "pending",
    });
    await expect(
      findKioskPairingBySecret(db(), "s1", expiresAt),
    ).resolves.toEqual({ id, state: "expired" });
    await expect(
      findKioskPairingBySecret(db(), "other", NOW),
    ).resolves.toBeNull();

    const found = {
      id,
      device: "Safari on iPad",
      state: "pending",
      expiresAt,
    };
    await expect(
      findKioskPairingByCode(db(), HOUSEHOLD_ID, "abc-234", NOW),
    ).resolves.toEqual(found);
    await expect(
      lockKioskPairingByCode(db(), HOUSEHOLD_ID, "ABC234", NOW),
    ).resolves.toEqual(found);
    await expect(
      findKioskPairingByCode(db(), OTHER_HOUSEHOLD, "ABC234", NOW),
    ).resolves.toBeNull();
    await expect(
      findKioskPairingByCode(db(), HOUSEHOLD_ID, "ZZZ234", NOW),
    ).resolves.toBeNull();
  });
});

describe("approveKioskPairing", () => {
  it("creates the device, unpaired, and marks the request approved once", async () => {
    const { id, expiresAt } = await request();
    const later = at(60_000);
    const res = await approve(id, expiresAt, later);
    expect(res).toEqual({ deviceId: expect.any(String) });
    const [device] = await t
      .db()
      .select()
      .from(kioskDevices)
      .where(eq(kioskDevices.id, res!.deviceId));
    expect(device).toMatchObject({
      name: "Kitchen",
      tokenHash: null,
      pairedAt: null,
      revokedAt: null,
      pairingCodeHash: null,
      pairingExpiresAt: at(
        KIOSK_PAIRING_TTL_MS + KIOSK_PAIRING_EXCHANGE_GRACE_MS,
      ),
      createdAt: later,
    });
    expect(await row(id)).toMatchObject({
      status: "approved",
      deviceId: res!.deviceId,
      approvedAt: later,
    });

    // A second approval finds it no longer pending.
    await expect(approve(id, expiresAt, later)).resolves.toBeNull();
  });

  it("refuses an expired request", async () => {
    const { id, expiresAt } = await request();
    await expect(approve(id, expiresAt, expiresAt)).resolves.toBeNull();
    expect((await row(id)).status).toBe("pending");
  });
});

describe("claimApprovedKioskPairing", () => {
  it("pairs once: the request is used and a second exchange finds nothing", async () => {
    const { id, expiresAt } = await request("ABC234", "s1");
    // Not approved yet: nothing to claim.
    await expect(
      claimApprovedKioskPairing(db(), {
        secret: "s1",
        tokenHash: hashKioskToken("t0"),
        now: NOW,
      }),
    ).resolves.toBeNull();

    const approved = await approve(id, expiresAt);
    const later = at(5_000);
    await expect(
      claimApprovedKioskPairing(db(), {
        secret: "wrong",
        tokenHash: hashKioskToken("tx"),
        now: later,
      }),
    ).resolves.toBeNull();
    await expect(
      claimApprovedKioskPairing(db(), {
        secret: "s1",
        tokenHash: hashKioskToken("t1"),
        now: later,
      }),
    ).resolves.toEqual({ deviceId: approved!.deviceId, name: "Kitchen" });
    expect(await row(id)).toMatchObject({ status: "used", usedAt: later });
    const [device] = await t
      .db()
      .select()
      .from(kioskDevices)
      .where(eq(kioskDevices.id, approved!.deviceId));
    expect(device).toMatchObject({
      tokenHash: hashKioskToken("t1"),
      pairedAt: later,
      lastSeenAt: later,
    });
    await expect(
      claimApprovedKioskPairing(db(), {
        secret: "s1",
        tokenHash: hashKioskToken("t2"),
        now: later,
      }),
    ).resolves.toBeNull();
  });

  it("works through the grace after the request's time, and not after it", async () => {
    const a = await request("AAA234", "sa");
    await approve(a.id, a.expiresAt);
    await expect(
      claimApprovedKioskPairing(db(), {
        secret: "sa",
        tokenHash: hashKioskToken("ta"),
        now: at(KIOSK_PAIRING_TTL_MS + KIOSK_PAIRING_EXCHANGE_GRACE_MS - 1),
      }),
    ).resolves.toMatchObject({ name: "Kitchen" });

    const b = await request("BBB234", "sb");
    await approve(b.id, b.expiresAt);
    await expect(
      claimApprovedKioskPairing(db(), {
        secret: "sb",
        tokenHash: hashKioskToken("tb"),
        now: at(KIOSK_PAIRING_TTL_MS + KIOSK_PAIRING_EXCHANGE_GRACE_MS),
      }),
    ).resolves.toBeNull();
  });
});

describe("pruneKioskPairingRequests", () => {
  it("deletes rows created before the cut-off", async () => {
    await request("AAA234", "sa", NOW);
    await request("BBB234", "sb", at(1));
    expect(await pruneKioskPairingRequests(db(), NOW)).toBe(0);
    expect(await pruneKioskPairingRequests(db(), at(1))).toBe(1);
    expect(KIOSK_PAIRING_RETENTION_MS).toBe(24 * 60 * 60_000);
    expect(await t.db().select().from(kioskPairingRequests)).toHaveLength(1);
  });

  it("rejects an approved row without a device (the check constraint)", async () => {
    const { id } = await request();
    await expect(
      t
        .db()
        .update(kioskPairingRequests)
        .set({ status: "approved" })
        .where(eq(kioskPairingRequests.id, id)),
    ).rejects.toThrow();
  });
});
