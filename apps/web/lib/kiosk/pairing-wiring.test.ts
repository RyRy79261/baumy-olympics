// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findPairedKioskDevice, hashKioskToken } from "@baumy/db/kiosk-devices";
import {
  approveKioskPairing,
  findKioskPairingByCode,
} from "@baumy/db/kiosk-pairing";
import { kioskPairingRequests } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { seedMember } from "@/test-utils/actions";
import { kioskPairingDeps } from "./pairing-wiring";

// The real dependencies of the kiosk pairing routes on PGlite (issue #126):
// the request with only hashes stored, the status by the iPad's secret, and
// the one-time exchange in a transaction.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const NOW = new Date("2026-10-01T10:00:00Z");

describe("kioskPairingDeps", () => {
  it("stores a request, reads it by secret, and pairs it once approved", async () => {
    const deps = kioskPairingDeps();
    const secret = deps.randomSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const code = deps.newCode();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(deps.newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const req = await deps.createRequest({
      secret,
      code,
      device: "Safari on iPad",
      network: "203.0.113.0/24",
      now: NOW,
    });
    expect(req).toEqual({
      id: expect.any(String),
      expiresAt: expect.any(Date),
    });
    const [row] = await t.db().select().from(kioskPairingRequests);
    expect(row!.householdId).toBe(HOUSEHOLD_ID);
    expect(row!.requesterNetwork).toBe("203.0.113.0/24");
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(await deps.findBySecret(secret, NOW)).toEqual({
      id: req!.id,
      state: "pending",
    });

    const tokenHash = hashKioskToken("tok");
    expect(await deps.claim({ secret, tokenHash, now: NOW })).toBeNull();
    const found = await findKioskPairingByCode(db(), HOUSEHOLD_ID, code, NOW);
    const approved = await approveKioskPairing(db(), {
      requestId: found!.id,
      householdId: HOUSEHOLD_ID,
      name: "Kitchen",
      approvedBy: await seedMember(db(), { role: "admin" }),
      expiresAt: found!.expiresAt,
      now: NOW,
    });
    expect(await deps.claim({ secret, tokenHash, now: NOW })).toEqual({
      deviceId: approved!.deviceId,
      name: "Kitchen",
    });
    await expect(findPairedKioskDevice(tokenHash)).resolves.toMatchObject({
      id: approved!.deviceId,
    });
    expect(await deps.claim({ secret, tokenHash, now: NOW })).toBeNull();
  });

  it("logs with or without the error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = kioskPairingDeps();
    deps.logError("one");
    deps.logError("two", new Error("x"));
    expect(error.mock.calls).toEqual([["one"], ["two", new Error("x")]]);
    error.mockRestore();
  });
});
