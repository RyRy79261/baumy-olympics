// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { auditEvents, inviteCodes, members } from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { Actor } from "@/lib/auth";
import type * as Codes from "@/lib/codes";

// The admin actions behind /admin/members, through the real runAction on
// PGlite: mint_invite, revoke_invite and manage_members. Admin only, UI only.

const nextCodes: string[] = [];
vi.mock("@/lib/codes", async (importOriginal) => {
  const real = await importOriginal<typeof Codes>();
  return {
    ...real,
    generateInviteCode: () => nextCodes.shift() ?? real.generateInviteCode(),
  };
});

const { runAction } = await import("./registry");

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const DAY = 24 * 60 * 60_000;

beforeEach(() => {
  __resetMemoryRateLimits();
  nextCodes.length = 0;
});

async function adminCtx() {
  const id = await seedMember(db(), { role: "admin", displayName: "Admin" });
  return { id, ctx: ctxFor(sessionActor(id, "admin")) };
}

async function row(id: string) {
  const [r] = await t.db().select().from(members).where(eq(members.id, id));
  return r!;
}

/** Everyone who is not an admin with a session, on the ui surface. */
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

describe("mint_invite", () => {
  it("mints a lowercase code with the defaults, and audits it", async () => {
    const { id, ctx } = await adminCtx();
    const res = await runAction("mint_invite", {}, ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({
      code: expect.stringMatching(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/),
      role: "member",
      maxUses: 1,
      expiresAt: new Date(FIXED_NOW.getTime() + 7 * DAY).toISOString(),
    });
    const [stored] = await t.db().select().from(inviteCodes);
    expect(stored).toMatchObject({
      code: res.data.code,
      createdBy: id,
      useCount: 0,
      revokedAt: null,
      createdAt: FIXED_NOW,
    });
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      actorMemberId: id,
      action: "mint_invite",
      entity: "invite_code",
      entityId: res.data.code,
    });
  });

  it("takes form strings for the numbers, and an admin role", async () => {
    const { ctx } = await adminCtx();
    const res = await runAction(
      "mint_invite",
      { role: "admin", maxUses: "3", expiresInDays: "1" },
      ctx,
    );
    expect(res).toMatchObject({
      ok: true,
      data: {
        role: "admin",
        maxUses: 3,
        expiresAt: new Date(FIXED_NOW.getTime() + DAY).toISOString(),
      },
    });
  });

  it("refuses numbers out of range", async () => {
    const { ctx } = await adminCtx();
    for (const bad of [
      { maxUses: 0 },
      { maxUses: 21 },
      { maxUses: "1.5" },
      { expiresInDays: 31 },
      { expiresInDays: "soon" },
      { role: "owner" },
    ]) {
      await expect(runAction("mint_invite", bad, ctx)).resolves.toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    }
    expect(await t.db().select().from(inviteCodes)).toHaveLength(0);
  });

  it("draws again when a generated code is taken", async () => {
    const { ctx } = await adminCtx();
    nextCodes.push("aaaa-bbbb-cccc");
    await runAction("mint_invite", {}, ctx);
    nextCodes.push("aaaa-bbbb-cccc", "dddd-eeee-ffff");
    const res = await runAction("mint_invite", {}, ctxFor(ctx.actor));
    expect(res).toMatchObject({ ok: true, data: { code: "dddd-eeee-ffff" } });
  });

  it("gives up with INTERNAL after repeated collisions, writing nothing", async () => {
    const { ctx } = await adminCtx();
    nextCodes.push("aaaa-bbbb-cccc");
    await runAction("mint_invite", {}, ctx);
    nextCodes.push(...Array(5).fill("aaaa-bbbb-cccc"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      runAction("mint_invite", {}, ctxFor(ctx.actor)),
    ).resolves.toMatchObject({ ok: false, code: "INTERNAL" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    expect(await t.db().select().from(inviteCodes)).toHaveLength(1);
  });

  it("is refused to everyone but an admin session on the ui", async () => {
    for (const actor of await nonAdmins()) {
      await expect(
        runAction("mint_invite", {}, ctxFor(actor)),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    const { ctx } = await adminCtx();
    for (const source of ["kiosk", "ai", "mcp", "brain"] as const) {
      await expect(
        runAction("mint_invite", {}, { ...ctx, source }),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    expect(await t.db().select().from(inviteCodes)).toHaveLength(0);
  });
});

describe("revoke_invite", () => {
  it("revokes once, then says there is nothing to revoke", async () => {
    const { ctx } = await adminCtx();
    nextCodes.push("gone-gone-gone");
    await runAction("mint_invite", {}, ctx);
    const res = await runAction(
      "revoke_invite",
      { code: " GONE-gone-gone" },
      ctxFor(ctx.actor),
    );
    expect(res).toEqual({ ok: true, data: { code: "gone-gone-gone" } });
    const [stored] = await t.db().select().from(inviteCodes);
    expect(stored?.revokedAt).toEqual(FIXED_NOW);
    await expect(
      runAction("revoke_invite", { code: "gone-gone-gone" }, ctxFor(ctx.actor)),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("is admin only", async () => {
    const plain = await seedMember(db());
    await expect(
      runAction("revoke_invite", { code: "x" }, ctxFor(sessionActor(plain))),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("manage_members", () => {
  it("changes a member's role, and audits the change", async () => {
    const { id, ctx } = await adminCtx();
    const other = await seedMember(db(), { displayName: "Other" });
    const res = await runAction(
      "manage_members",
      { op: "set_role", memberId: other, role: "admin" },
      ctx,
    );
    expect(res).toMatchObject({
      ok: true,
      data: { memberId: other, role: "admin", active: true },
    });
    expect((await row(other)).role).toBe("admin");
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      actorMemberId: id,
      entity: "member",
      entityId: other,
      payload: { op: "set_role", memberId: other, role: "admin" },
    });

    // Now there are two admins, so the first may step down.
    await expect(
      runAction(
        "manage_members",
        { op: "set_role", memberId: id, role: "member" },
        ctxFor(ctx.actor),
      ),
    ).resolves.toMatchObject({ ok: true, data: { role: "member" } });
  });

  it("never leaves the household without an active admin", async () => {
    const { id, ctx } = await adminCtx();
    for (const change of [
      { op: "set_role", memberId: id, role: "member" },
      { op: "deactivate", memberId: id },
    ]) {
      const res = await runAction("manage_members", change, ctxFor(ctx.actor));
      expect(res).toMatchObject({ ok: false, code: "LAST_ADMIN" });
    }
    expect(await row(id)).toMatchObject({ role: "admin", deactivatedAt: null });

    // A deactivated admin does not count.
    await seedMember(db(), {
      role: "admin",
      deactivatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await expect(
      runAction(
        "manage_members",
        { op: "deactivate", memberId: id },
        ctxFor(ctx.actor),
      ),
    ).resolves.toMatchObject({ ok: false, code: "LAST_ADMIN" });
  });

  it("deactivates and reactivates, keeping the first deactivation time", async () => {
    const { ctx } = await adminCtx();
    const other = await seedMember(db());
    await expect(
      runAction("manage_members", { op: "deactivate", memberId: other }, ctx),
    ).resolves.toMatchObject({ ok: true, data: { active: false } });
    expect((await row(other)).deactivatedAt).toEqual(FIXED_NOW);

    const later = new Date(FIXED_NOW.getTime() + DAY);
    await runAction(
      "manage_members",
      { op: "deactivate", memberId: other },
      ctxFor(ctx.actor, { now: later }),
    );
    expect((await row(other)).deactivatedAt).toEqual(FIXED_NOW);

    await expect(
      runAction(
        "manage_members",
        { op: "reactivate", memberId: other },
        ctxFor(ctx.actor),
      ),
    ).resolves.toMatchObject({ ok: true, data: { active: true } });
    expect((await row(other)).deactivatedAt).toBeNull();
  });

  it("edits the name, colour and avatar", async () => {
    const { ctx } = await adminCtx();
    const other = await seedMember(db(), { displayName: "Old" });
    const res = await runAction(
      "manage_members",
      {
        op: "edit",
        memberId: other,
        displayName: " New ",
        color: "#ABCDEF",
        avatarSprite: "frog",
      },
      ctx,
    );
    expect(res).toMatchObject({
      ok: true,
      data: { displayName: "New", color: "#abcdef", avatarSprite: "frog" },
    });
    expect(await row(other)).toMatchObject({
      displayName: "New",
      color: "#abcdef",
      avatarSprite: "frog",
      role: "member",
    });
  });

  it("returns INVALID_INPUT for an empty edit or an unknown op, NOT_FOUND for a stranger", async () => {
    const { ctx } = await adminCtx();
    const other = await seedMember(db());
    for (const bad of [
      { op: "edit", memberId: other },
      { op: "promote", memberId: other },
      { op: "edit", memberId: "not-a-uuid", displayName: "X" },
      { op: "edit", memberId: other, avatarSprite: "dragon" },
    ]) {
      await expect(
        runAction("manage_members", bad, ctxFor(ctx.actor)),
      ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
    await expect(
      runAction(
        "manage_members",
        {
          op: "reactivate",
          memberId: "00000000-0000-4000-8000-00000000dead",
        },
        ctxFor(ctx.actor),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("is refused to everyone but an admin session", async () => {
    const target = await seedMember(db(), { displayName: "Target" });
    for (const actor of await nonAdmins()) {
      await expect(
        runAction(
          "manage_members",
          { op: "deactivate", memberId: target },
          ctxFor(actor),
        ),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await row(target)).deactivatedAt).toBeNull();
  });
});

describe("the household", () => {
  it("keeps one household id on everything minted", async () => {
    const { ctx } = await adminCtx();
    await runAction("mint_invite", {}, ctx);
    const [stored] = await t.db().select().from(inviteCodes);
    expect(stored?.householdId).toBe(HOUSEHOLD_ID);
  });
});
