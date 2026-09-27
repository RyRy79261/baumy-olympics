// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { withTransaction } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  findPairedKioskDevice,
  hashKioskToken,
  insertKioskPairing,
  revokeKioskDevice,
} from "@baumy/db/kiosk-devices";
import { kioskDevices } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { FIXED_NOW, allowAll, seedMember } from "@/test-utils/actions";
import type { RateLimiter } from "@/lib/rate-limit";
import { PAIR_FAILED_MESSAGE, PAIR_LIMIT, pairKioskDevice } from "./pairing";

// /kiosk/pair's exchange on PGlite: a code works once, only the token's hash
// is stored, and a revoked device is not found by its token any more.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

let tokens = 0;
const deps = (rateLimiter: RateLimiter = allowAll) => ({
  withTransaction,
  rateLimiter,
  newToken: () => `token-${++tokens}`,
});

async function mint(code = "ABCD2345") {
  const admin = await seedMember(db(), { role: "admin" });
  return insertKioskPairing(db(), {
    householdId: HOUSEHOLD_ID,
    name: "Kitchen iPad",
    code,
    pairedBy: admin,
    now: FIXED_NOW,
  });
}

describe("pairKioskDevice", () => {
  it("pairs once with a code typed any way, and a second use fails", async () => {
    const row = await mint();
    const first = await pairKioskDevice(
      { code: "abcd-2345", ip: "1.2.3.4", now: FIXED_NOW },
      deps(),
    );
    expect(first).toMatchObject({
      ok: true,
      deviceId: row!.id,
      name: "Kitchen iPad",
    });
    if (!first.ok) return;
    const stored = await t.db().select().from(kioskDevices);
    expect(stored[0]!.tokenHash).toBe(hashKioskToken(first.token));
    expect(JSON.stringify(stored)).not.toContain(first.token);
    await expect(
      findPairedKioskDevice(hashKioskToken(first.token)),
    ).resolves.toMatchObject({ id: row!.id });

    await expect(
      pairKioskDevice(
        { code: "ABCD2345", ip: "1.2.3.4", now: FIXED_NOW },
        deps(),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: PAIR_FAILED_MESSAGE,
    });

    // Revoked: the token no longer finds the device.
    await revokeKioskDevice(db(), {
      householdId: HOUSEHOLD_ID,
      id: row!.id,
      now: FIXED_NOW,
    });
    await expect(
      findPairedKioskDevice(hashKioskToken(first.token)),
    ).resolves.toBeNull();
  });

  it("refuses a malformed code before counting or claiming", async () => {
    const limiter = { limit: vi.fn(allowAll.limit) };
    for (const code of [undefined, "", "ABC", 12345678]) {
      const res = await pairKioskDevice(
        { code, ip: "1.2.3.4", now: FIXED_NOW },
        deps(limiter),
      );
      expect(res).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        issues: [{ path: ["code"] }],
      });
    }
    expect(limiter.limit).not.toHaveBeenCalled();
  });

  it("limits tries per IP address", async () => {
    await mint();
    const limiter = {
      limit: vi.fn(async () => ({ ok: false, retryAfterSeconds: 42 })),
    };
    await expect(
      pairKioskDevice(
        { code: "ABCD2345", ip: "1.2.3.4", now: FIXED_NOW },
        deps(limiter),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "RATE_LIMITED",
      retryAfterSeconds: 42,
    });
    expect(limiter.limit).toHaveBeenCalledWith(
      "kiosk_pair:ip:1.2.3.4",
      PAIR_LIMIT,
    );
    // The code was not used up.
    const [row] = await t.db().select().from(kioskDevices);
    expect(row!.pairedAt).toBeNull();
  });
});
