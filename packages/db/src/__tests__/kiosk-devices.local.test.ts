import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { HOUSEHOLD_ID } from "../household";
import {
  createHttpDb,
  isLocalProxy,
  withTransaction,
  type Queryable,
} from "../index";
import { hashKioskToken } from "../kiosk-devices";
import {
  approveKioskPairing,
  claimApprovedKioskPairing,
  insertKioskPairingRequest,
} from "../kiosk-pairing";
import * as schema from "../schema";

// An approved pairing request is traded for a device token once, even when
// several tabs of the iPad poll at the same moment: each exchange is its own
// transaction on a real server, and exactly one UPDATE … RETURNING may win.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const memberIds: string[] = [];
const deviceIds: string[] = [];
const requestIds: string[] = [];

afterAll(async () => {
  const db = createHttpDb();
  if (requestIds.length > 0) {
    await db
      .delete(schema.kioskPairingRequests)
      .where(inArray(schema.kioskPairingRequests.id, requestIds));
  }
  if (deviceIds.length > 0) {
    await db
      .delete(schema.kioskDevices)
      .where(inArray(schema.kioskDevices.id, deviceIds));
  }
  if (memberIds.length > 0) {
    await db
      .delete(schema.members)
      .where(inArray(schema.members.id, memberIds));
  }
});

describe("claimApprovedKioskPairing under concurrent exchanges", () => {
  it("pairs exactly one device token", async () => {
    const [admin] = await createHttpDb()
      .insert(schema.members)
      .values({
        householdId: HOUSEHOLD_ID,
        displayName: "Local admin",
        avatarSprite: "cat",
        color: "#112233",
        role: "admin",
      })
      .returning({ id: schema.members.id });
    memberIds.push(admin!.id);

    const code = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
    const secret = `secret-${randomUUID()}`;
    const now = new Date();
    const deviceId = await withTransaction(async (tx) => {
      const q = tx as unknown as Queryable;
      const req = await insertKioskPairingRequest(q, {
        householdId: HOUSEHOLD_ID,
        secret,
        code,
        device: "Safari on iPad",
        now,
      });
      requestIds.push(req!.id);
      const approved = await approveKioskPairing(q, {
        requestId: req!.id,
        householdId: HOUSEHOLD_ID,
        name: "Race iPad",
        approvedBy: admin!.id,
        expiresAt: req!.expiresAt,
        now,
      });
      return approved!.deviceId;
    });
    deviceIds.push(deviceId);

    const tokens = Array.from({ length: 12 }, (_, i) => `token-${i}-${code}`);
    const results = await Promise.all(
      tokens.map((token) =>
        withTransaction((tx) =>
          claimApprovedKioskPairing(tx as unknown as Queryable, {
            secret,
            tokenHash: hashKioskToken(token),
            now,
          }),
        ),
      ),
    );
    const winners = results
      .map((r, i) => (r ? tokens[i]! : null))
      .filter((t): t is string => t !== null);
    expect(winners).toHaveLength(1);

    const [stored] = await createHttpDb()
      .select()
      .from(schema.kioskDevices)
      .where(eq(schema.kioskDevices.id, deviceId));
    expect(stored!.tokenHash).toBe(hashKioskToken(winners[0]!));
  });
});
