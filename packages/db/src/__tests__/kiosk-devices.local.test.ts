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
import {
  claimKioskPairing,
  hashKioskToken,
  insertKioskPairing,
} from "../kiosk-devices";
import * as schema from "../schema";

// A pairing code works once, even when several iPads type it at the same
// moment: each claim is its own transaction on a real server, and exactly
// one UPDATE … RETURNING may win the row.

if (!isLocalProxy() || !process.env.DATABASE_URL) {
  throw new Error(
    "Run with `pnpm db:local:test`: it needs NEON_LOCAL_PROXY=1 and the local stack.",
  );
}

const memberIds: string[] = [];
const deviceIds: string[] = [];

afterAll(async () => {
  const db = createHttpDb();
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

describe("claimKioskPairing under concurrent claims", () => {
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

    const code = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
    const now = new Date();
    const row = await withTransaction((tx) =>
      insertKioskPairing(tx as unknown as Queryable, {
        householdId: HOUSEHOLD_ID,
        name: "Race iPad",
        code,
        pairedBy: admin!.id,
        now,
      }),
    );
    deviceIds.push(row!.id);

    const tokens = Array.from({ length: 12 }, (_, i) => `token-${i}-${code}`);
    const results = await Promise.all(
      tokens.map((token) =>
        withTransaction((tx) =>
          claimKioskPairing(tx as unknown as Queryable, {
            code,
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
      .where(eq(schema.kioskDevices.id, row!.id));
    expect(stored!.tokenHash).toBe(hashKioskToken(winners[0]!));
    expect(stored!.pairingCodeHash).toBeNull();
  });
});
