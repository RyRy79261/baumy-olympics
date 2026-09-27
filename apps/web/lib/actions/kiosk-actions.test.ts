// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import {
  KIOSK_PAIRING_TTL_MS,
  hashPairingCode,
  insertKioskPairing,
} from "@baumy/db/kiosk-devices";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  actionRateLimit,
  actionRequests,
  auditEvents,
  kioskDevices,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type * as Codes from "@/lib/codes";

// The kiosk's actions through the real runAction and the real PIN verifier
// on PGlite: pair_kiosk and revoke_kiosk (admin, UI only, never the kiosk)
// and check_kiosk_pin (attested, kiosk only).

const nextCodes: string[] = [];
vi.mock("@/lib/codes", async (importOriginal) => {
  const real = await importOriginal<typeof Codes>();
  return {
    ...real,
    generateKioskPairingCode: () =>
      nextCodes.shift() ?? real.generateKioskPairingCode(),
  };
});

const { runAction } = await import("./registry");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const PIN = "4321";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

beforeEach(() => {
  __resetMemoryRateLimits();
  nextCodes.length = 0;
});

async function adminCtx() {
  const id = await seedMember(db(), { role: "admin", displayName: "Admin" });
  return { id, ctx: ctxFor(sessionActor(id, "admin")) };
}

async function device(id: string) {
  const [r] = await t
    .db()
    .select()
    .from(kioskDevices)
    .where(eq(kioskDevices.id, id));
  return r!;
}

/** Everyone but an admin with a real session. */
async function nonAdmins(): Promise<Actor[]> {
  const plain = await seedMember(db());
  const admin = await seedMember(db(), { role: "admin" });
  return [
    sessionActor(plain, "member"),
    sessionActor(undefined),
    kioskActor(admin),
    { kind: "mcp", memberId: admin, scopes: ["baumy:read", "baumy:write"] },
    { kind: "service", tokenName: "baumy-brain", memberId: admin },
  ];
}

describe("pair_kiosk", () => {
  it("shows the code once, stores only its hash for 10 minutes, and audits it", async () => {
    const { id, ctx } = await adminCtx();
    nextCodes.push("ABCD2345");
    const res = await runAction("pair_kiosk", { name: " Kitchen iPad " }, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const expiresAt = new Date(
      FIXED_NOW.getTime() + KIOSK_PAIRING_TTL_MS,
    ).toISOString();
    expect(res.data).toEqual({
      deviceId: expect.any(String),
      name: "Kitchen iPad",
      code: "ABCD2345",
      expiresAt,
    });
    expect(await device(res.data.deviceId)).toMatchObject({
      name: "Kitchen iPad",
      pairingCodeHash: hashPairingCode("ABCD2345"),
      pairedBy: id,
      tokenHash: null,
    });

    // Neither the ledger nor the audit row holds the code.
    const [ledger] = await t.db().select().from(actionRequests);
    const [audit] = await t.db().select().from(auditEvents);
    expect(JSON.stringify([ledger, audit])).not.toContain("ABCD2345");
    expect(audit).toMatchObject({
      actorMemberId: id,
      action: "pair_kiosk",
      entity: "kiosk_device",
      entityId: res.data.deviceId,
      payload: { name: "Kitchen iPad", expiresAt },
    });

    // A replay of the same request gets the result without the code.
    await expect(
      runAction("pair_kiosk", { name: "Kitchen iPad" }, ctx),
    ).resolves.toEqual({ ok: true, data: { ...res.data, code: null } });
    expect(await t.db().select().from(kioskDevices)).toHaveLength(1);
  });

  it("mints another code after a collision", async () => {
    const { id, ctx } = await adminCtx();
    await insertKioskPairing(db(), {
      householdId: HOUSEHOLD_ID,
      name: "Old",
      code: "TAKEN234",
      pairedBy: id,
      now: FIXED_NOW,
    });
    nextCodes.push("TAKEN234", "FRESH234");
    const res = await runAction("pair_kiosk", { name: "New" }, ctx);
    expect(res).toMatchObject({ ok: true, data: { code: "FRESH234" } });
  });

  it("gives up with INTERNAL if every code collides", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id, ctx } = await adminCtx();
    await insertKioskPairing(db(), {
      householdId: HOUSEHOLD_ID,
      name: "Old",
      code: "TAKEN234",
      pairedBy: id,
      now: FIXED_NOW,
    });
    nextCodes.push(...Array(5).fill("TAKEN234"));
    await expect(
      runAction("pair_kiosk", { name: "New" }, ctx),
    ).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
    error.mockRestore();
  });

  it("refuses a blank or overlong name", async () => {
    const { ctx } = await adminCtx();
    for (const name of ["  ", "x".repeat(41)]) {
      await expect(
        runAction("pair_kiosk", { name }, ctx),
      ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });

  it("is for admins with a real session only, and never from the kiosk", async () => {
    for (const actor of await nonAdmins()) {
      await expect(
        runAction("pair_kiosk", { name: "X" }, ctxFor(actor)),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const { ctx } = await adminCtx();
    for (const source of ["kiosk", "ai", "mcp", "brain"] as const) {
      await expect(
        runAction("pair_kiosk", { name: "X" }, { ...ctx, source }),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    expect(await t.db().select().from(kioskDevices)).toHaveLength(0);
  });
});

describe("revoke_kiosk", () => {
  it("revokes once, audits it, then says it is gone", async () => {
    const { ctx } = await adminCtx();
    const paired = await runAction("pair_kiosk", { name: "iPad" }, ctx);
    if (!paired.ok) throw new Error("pair failed");
    const deviceId = paired.data.deviceId;
    const res = await runAction(
      "revoke_kiosk",
      { deviceId },
      { ...ctx, requestId: "revoke-request-1" },
    );
    expect(res).toEqual({
      ok: true,
      data: { deviceId, name: "iPad", wasPaired: false },
    });
    expect((await device(deviceId)).revokedAt).toEqual(FIXED_NOW);
    const audits = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "revoke_kiosk"));
    expect(audits).toHaveLength(1);

    await expect(
      runAction(
        "revoke_kiosk",
        { deviceId },
        { ...ctx, requestId: "revoke-request-2" },
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    await expect(
      runAction("revoke_kiosk", { deviceId: "nope" }, ctx),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("is for admins with a real session only, and never from the kiosk", async () => {
    const { ctx } = await adminCtx();
    const paired = await runAction("pair_kiosk", { name: "iPad" }, ctx);
    if (!paired.ok) throw new Error("pair failed");
    const input = { deviceId: paired.data.deviceId };
    for (const actor of await nonAdmins()) {
      await expect(
        runAction("revoke_kiosk", input, ctxFor(actor)),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(
      runAction("revoke_kiosk", input, { ...ctx, source: "kiosk" }),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect((await device(input.deviceId)).revokedAt).toBeNull();
  });
});

describe("check_kiosk_pin: attestation on the kiosk", () => {
  async function kioskCtx(pin?: string, memberId?: string) {
    const me = memberId ?? (await seedMember(db(), { kioskPinHash: pinHash }));
    const actor: Actor = {
      kind: "kiosk",
      deviceId: "dev-1",
      memberId: me,
      displayName: "Ryan",
    };
    return {
      me,
      ctx: ctxFor(actor, { source: "kiosk", ...(pin ? { pin } : {}) }),
    };
  }

  it("without a PIN returns ATTESTATION_REQUIRED; a wrong one ATTESTATION_FAILED; the right one passes", async () => {
    const { me, ctx } = await kioskCtx();
    await expect(runAction("check_kiosk_pin", {}, ctx)).resolves.toEqual({
      ok: false,
      code: "ATTESTATION_REQUIRED",
      message: "Enter your PIN to do this.",
    });
    await expect(
      runAction("check_kiosk_pin", {}, { ...ctx, pin: "0000" }),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_FAILED" });
    await expect(
      runAction("check_kiosk_pin", {}, { ...ctx, pin: PIN }),
    ).resolves.toEqual({
      ok: true,
      data: { memberId: me, displayName: "Ryan" },
    });
  });

  it("a correct PIN on one request does not attest the next", async () => {
    const { ctx } = await kioskCtx();
    await expect(
      runAction("check_kiosk_pin", {}, { ...ctx, pin: PIN }),
    ).resolves.toMatchObject({ ok: true });
    await expect(runAction("check_kiosk_pin", {}, ctx)).resolves.toMatchObject({
      ok: false,
      code: "ATTESTATION_REQUIRED",
    });
  });

  it("refuses the 6th wrong PIN within 15 minutes, even the right one", async () => {
    const { me, ctx } = await kioskCtx();
    for (let i = 0; i < 5; i++) {
      await expect(
        runAction("check_kiosk_pin", {}, { ...ctx, pin: "0000" }),
      ).resolves.toMatchObject({ code: "ATTESTATION_FAILED" });
    }
    await expect(
      runAction("check_kiosk_pin", {}, { ...ctx, pin: PIN }),
    ).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
    const rows = await t.db().select().from(actionRateLimit);
    expect(rows.find((r) => r.key === `pin:dev-1:${me}`)?.count).toBe(6);
  });

  it("after 10 failures in 24h is locked until the member sets a new PIN", async () => {
    const { me, ctx } = await kioskCtx();
    // Five on each of two kiosks, so the 15-minute limit never bites.
    for (let i = 0; i < 10; i++) {
      const deviceId = i < 5 ? "dev-1" : "dev-2";
      const res = await runAction(
        "check_kiosk_pin",
        {},
        {
          ...ctx,
          actor: { kind: "kiosk", deviceId, memberId: me },
          pin: "0000",
        },
      );
      expect(res).toMatchObject({
        ok: false,
        code: i < 9 ? "ATTESTATION_FAILED" : "PIN_LOCKED",
      });
    }
    await expect(
      runAction("check_kiosk_pin", {}, { ...ctx, pin: PIN }),
    ).resolves.toMatchObject({ ok: false, code: "PIN_LOCKED" });
    const locks = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "kiosk_pin_locked"));
    expect(locks).toHaveLength(1);

    // Their own session sets a new PIN: the lock and the counters go.
    const reset = await runAction(
      "set_kiosk_pin",
      { pin: "2468", currentPassword: undefined },
      ctxFor(
        sessionActor(me, "member", {
          sessionCreatedAt: FIXED_NOW.toISOString(),
        }),
      ),
    );
    expect(reset).toMatchObject({ ok: true });
    const left = await t.db().select().from(actionRateLimit);
    expect(
      left.filter((r) => r.key.startsWith("pin") && r.key.endsWith(me)),
    ).toEqual([]);
    expect(left.length).toBeGreaterThan(0);
    await expect(
      runAction("check_kiosk_pin", {}, { ...ctx, pin: "2468" }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("needs a member picked, and is offered on the kiosk only", async () => {
    const nobody = ctxFor(kioskActor(), { source: "kiosk", pin: PIN });
    await expect(
      runAction("check_kiosk_pin", {}, nobody),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    const { ctx } = await kioskCtx(PIN);
    for (const source of ["ui", "ai", "mcp", "brain"] as const) {
      await expect(
        runAction("check_kiosk_pin", {}, { ...ctx, source }),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
  });

  it("tells a member without a PIN to set one", async () => {
    const plain = await seedMember(db());
    const { ctx } = await kioskCtx(PIN, plain);
    await expect(runAction("check_kiosk_pin", {}, ctx)).resolves.toMatchObject({
      ok: false,
      code: "ATTESTATION_FAILED",
      message: expect.stringContaining("no kiosk PIN"),
    });
  });
});
