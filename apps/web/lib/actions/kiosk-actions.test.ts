// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import { hashKioskToken } from "@baumy/db/kiosk-devices";
import {
  KIOSK_PAIRING_EXCHANGE_GRACE_MS,
  KIOSK_PAIRING_TTL_MS,
  claimApprovedKioskPairing,
  insertKioskPairingRequest,
} from "@baumy/db/kiosk-pairing";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  actionRateLimit,
  actionRequests,
  auditEvents,
  kioskDevices,
  kioskPairingRequests,
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
import { runAction } from "./registry";

// The kiosk's actions through the real runAction and the real PIN verifier
// on PGlite: approve_kiosk_pairing, rename_kiosk and revoke_kiosk (admin, UI
// only, never the kiosk; issue #126) and check_kiosk_pin (attested, kiosk
// only).

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const PIN = "4321";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});

beforeEach(() => {
  __resetMemoryRateLimits();
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

/** An unpaired iPad showing `code`, holding the secret `secret-<code>`. */
async function ipadShowing(code: string, now = FIXED_NOW) {
  const row = await insertKioskPairingRequest(db(), {
    householdId: HOUSEHOLD_ID,
    secret: `secret-${code}`,
    code,
    device: "Safari on iPad",
    now,
  });
  return row!;
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

/** An approved and paired device, through the real action. */
async function pairedDevice(ctx: ReturnType<typeof ctxFor>, code = "PAI234") {
  await ipadShowing(code);
  const res = await runAction(
    "approve_kiosk_pairing",
    { code, name: "iPad" },
    { ...ctx, requestId: `approve-${code}` },
  );
  if (!res.ok) throw new Error(`approve failed: ${res.message}`);
  await claimApprovedKioskPairing(db(), {
    secret: `secret-${code}`,
    tokenHash: hashKioskToken(`token-${code}`),
    now: FIXED_NOW,
  });
  return res.data.deviceId;
}

describe("approve_kiosk_pairing", () => {
  it("creates the device for the iPad showing the code, and audits it without the code", async () => {
    const { id, ctx } = await adminCtx();
    const request = await ipadShowing("ABC234");
    const res = await runAction(
      "approve_kiosk_pairing",
      { code: " abc-234 ", name: " Kitchen " },
      ctx,
    );
    expect(res).toEqual({
      ok: true,
      data: {
        deviceId: expect.any(String),
        name: "Kitchen",
        device: "Safari on iPad",
      },
    });
    if (!res.ok) return;
    expect(await device(res.data.deviceId)).toMatchObject({
      name: "Kitchen",
      pairedBy: id,
      tokenHash: null,
      pairedAt: null,
    });
    const [req] = await t.db().select().from(kioskPairingRequests);
    expect(req).toMatchObject({
      status: "approved",
      deviceId: res.data.deviceId,
      approvedBy: id,
      approvedAt: FIXED_NOW,
    });

    const [ledger] = await t.db().select().from(actionRequests);
    const [audit] = await t.db().select().from(auditEvents);
    expect(JSON.stringify([ledger, audit])).not.toMatch(/ABC-?234/i);
    expect(audit).toMatchObject({
      actorMemberId: id,
      action: "approve_kiosk_pairing",
      entity: "kiosk_device",
      entityId: res.data.deviceId,
      payload: {
        name: "Kitchen",
        device: "Safari on iPad",
        requestId: request.id,
      },
    });

    // The same request again is a replay, not a second device.
    await expect(
      runAction(
        "approve_kiosk_pairing",
        { code: " abc-234 ", name: " Kitchen " },
        ctx,
      ),
    ).resolves.toEqual(res);
    expect(await t.db().select().from(kioskDevices)).toHaveLength(1);

    // The iPad's exchange then pairs that device.
    await expect(
      claimApprovedKioskPairing(db(), {
        secret: "secret-ABC234",
        tokenHash: hashKioskToken("tok"),
        now: FIXED_NOW,
      }),
    ).resolves.toEqual({ deviceId: res.data.deviceId, name: "Kitchen" });
  });

  it("says NOT_FOUND for a code no iPad is showing", async () => {
    const { ctx } = await adminCtx();
    await ipadShowing("ABC234");
    await expect(
      runAction("approve_kiosk_pairing", { code: "XYZ234", name: "K" }, ctx),
    ).resolves.toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      message: expect.stringContaining("No iPad is showing that code"),
    });
    expect(await t.db().select().from(kioskDevices)).toHaveLength(0);
  });

  it("says WINDOW_CLOSED once the code's 10 minutes are up", async () => {
    const { ctx } = await adminCtx();
    await ipadShowing("ABC234");
    const justIn = new Date(FIXED_NOW.getTime() + KIOSK_PAIRING_TTL_MS - 1);
    const expired = new Date(FIXED_NOW.getTime() + KIOSK_PAIRING_TTL_MS);
    await expect(
      runAction(
        "approve_kiosk_pairing",
        { code: "ABC234", name: "K" },
        { ...ctx, now: expired },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "WINDOW_CLOSED",
      message: expect.stringContaining("expired"),
    });
    expect(await t.db().select().from(kioskDevices)).toHaveLength(0);
    // A millisecond earlier it still worked.
    await expect(
      runAction(
        "approve_kiosk_pairing",
        { code: "ABC234", name: "K" },
        { ...ctx, requestId: "approve-just-in", now: justIn },
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("says INVALID_STATE for a code already approved or used, and adds no device", async () => {
    const { ctx } = await adminCtx();
    await pairedDevice(ctx, "ABC234");
    const other = await adminCtx();
    await expect(
      runAction(
        "approve_kiosk_pairing",
        { code: "ABC234", name: "Again" },
        other.ctx,
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      message: expect.stringContaining("already approved"),
    });
    expect(await t.db().select().from(kioskDevices)).toHaveLength(1);
    // Past even the exchange grace, a used request is still INVALID_STATE.
    await expect(
      runAction(
        "approve_kiosk_pairing",
        { code: "ABC234", name: "Again" },
        {
          ...other.ctx,
          requestId: "approve-late",
          now: new Date(
            FIXED_NOW.getTime() +
              KIOSK_PAIRING_TTL_MS +
              KIOSK_PAIRING_EXCHANGE_GRACE_MS,
          ),
        },
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("refuses a malformed code, or a blank or overlong name", async () => {
    const { ctx } = await adminCtx();
    await ipadShowing("ABC234");
    for (const [i, input] of [
      { code: "ABC23", name: "K" },
      { code: "ABC234", name: "  " },
      { code: "ABC234", name: "x".repeat(41) },
    ].entries()) {
      const res = await runAction("approve_kiosk_pairing", input, {
        ...ctx,
        requestId: `approve-bad-${i}`,
      });
      expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      if (!res.ok) {
        expect(res.issues?.[0]?.path[0]).toBe(i === 0 ? "code" : "name");
      }
    }
    expect(await t.db().select().from(kioskDevices)).toHaveLength(0);
  });

  it("is for admins with a real session only, and never from the kiosk", async () => {
    await ipadShowing("ABC234");
    const input = { code: "ABC234", name: "X" };
    for (const actor of await nonAdmins()) {
      await expect(
        runAction("approve_kiosk_pairing", input, ctxFor(actor)),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const { ctx } = await adminCtx();
    for (const source of ["kiosk", "ai", "mcp", "brain"] as const) {
      await expect(
        runAction("approve_kiosk_pairing", input, { ...ctx, source }),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    expect(await t.db().select().from(kioskDevices)).toHaveLength(0);
    const [req] = await t.db().select().from(kioskPairingRequests);
    expect(req!.status).toBe("pending");
  });

  it("is limited to 20 approvals per admin per 10 minutes", async () => {
    const { ctx } = await adminCtx();
    for (let i = 0; i < 20; i++) {
      await expect(
        runAction(
          "approve_kiosk_pairing",
          { code: "NOP234", name: "K" },
          { ...ctx, requestId: `approve-${i}` },
        ),
      ).resolves.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(
      runAction(
        "approve_kiosk_pairing",
        { code: "NOP234", name: "K" },
        { ...ctx, requestId: "approve-21" },
      ),
    ).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
  });
});

describe("rename_kiosk", () => {
  it("renames a screen, audits it, and refuses a revoked one", async () => {
    const { ctx } = await adminCtx();
    const deviceId = await pairedDevice(ctx);
    await expect(
      runAction("rename_kiosk", { deviceId, name: " Fridge " }, ctx),
    ).resolves.toEqual({ ok: true, data: { deviceId, name: "Fridge" } });
    expect((await device(deviceId)).name).toBe("Fridge");
    const [audit] = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "rename_kiosk"));
    expect(audit).toMatchObject({
      entity: "kiosk_device",
      entityId: deviceId,
      payload: { deviceId, name: "Fridge" },
    });

    await expect(
      runAction(
        "rename_kiosk",
        { deviceId, name: " " },
        { ...ctx, requestId: "rename-blank" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ path: ["name"] }],
    });

    await expect(
      runAction(
        "revoke_kiosk",
        { deviceId },
        { ...ctx, requestId: "revoke-before-rename" },
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      runAction(
        "rename_kiosk",
        { deviceId, name: "Late" },
        { ...ctx, requestId: "rename-revoked" },
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect((await device(deviceId)).name).toBe("Fridge");
  });

  it("is for admins with a real session only, and never from the kiosk", async () => {
    const { ctx } = await adminCtx();
    const deviceId = await pairedDevice(ctx);
    const input = { deviceId, name: "Hacked" };
    for (const actor of await nonAdmins()) {
      await expect(
        runAction("rename_kiosk", input, ctxFor(actor)),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await expect(
      runAction("rename_kiosk", input, { ...ctx, source: "kiosk" }),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect((await device(deviceId)).name).toBe("iPad");
  });
});

describe("revoke_kiosk", () => {
  it("revokes once, audits it, then says it is gone", async () => {
    const { ctx } = await adminCtx();
    const deviceId = await pairedDevice(ctx);
    const res = await runAction(
      "revoke_kiosk",
      { deviceId },
      { ...ctx, requestId: "revoke-request-1" },
    );
    expect(res).toEqual({
      ok: true,
      data: { deviceId, name: "iPad", wasPaired: true },
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

  it("cancels an approval the iPad has not picked up", async () => {
    const { ctx } = await adminCtx();
    await ipadShowing("ABC234");
    const approved = await runAction(
      "approve_kiosk_pairing",
      { code: "ABC234", name: "iPad" },
      ctx,
    );
    if (!approved.ok) throw new Error("approve failed");
    await expect(
      runAction(
        "revoke_kiosk",
        { deviceId: approved.data.deviceId },
        { ...ctx, requestId: "revoke-early" },
      ),
    ).resolves.toMatchObject({ ok: true, data: { wasPaired: false } });
    await expect(
      claimApprovedKioskPairing(db(), {
        secret: "secret-ABC234",
        tokenHash: hashKioskToken("t"),
        now: FIXED_NOW,
      }),
    ).resolves.toBeNull();
  });

  it("is for admins with a real session only, and never from the kiosk", async () => {
    const { ctx } = await adminCtx();
    const input = { deviceId: await pairedDevice(ctx) };
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
