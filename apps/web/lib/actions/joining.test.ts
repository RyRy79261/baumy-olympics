// @vitest-environment node
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "@baumy/db";
import { insertAvatar } from "@baumy/db/avatars";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import {
  actionRequests,
  auditEvents,
  avatars,
  inviteCodes,
  members,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  AVATAR_HAIR_COLORS,
  AVATAR_HAIR_STYLES,
  AVATAR_SHIRT_COLORS,
  AVATAR_SKIN_TONES,
  MEMBER_COLORS,
} from "@baumy/types";
import {
  FIXED_NOW,
  accountActor,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { defaultColorFor } from "./joining";
import { runAction } from "./registry";

// The two ways into the household, through the real runAction on PGlite:
// redeem_invite (an invite code) and join_as_founder (FOUNDER_EMAILS).

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const HOUR = 60 * 60_000;

beforeEach(() => __resetMemoryRateLimits());

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}
afterEach(() => vi.unstubAllEnvs());

async function code(
  value: string,
  overrides: Partial<typeof inviteCodes.$inferInsert> = {},
) {
  const admin = await seedMember(db(), { role: "admin" });
  await t
    .db()
    .insert(inviteCodes)
    .values({
      code: value,
      householdId: HOUSEHOLD_ID,
      role: "member",
      maxUses: 1,
      expiresAt: new Date(FIXED_NOW.getTime() + 24 * HOUR),
      createdBy: admin,
      createdAt: FIXED_NOW,
      ...overrides,
    });
}

async function memberOf(userId: string) {
  const [row] = await t
    .db()
    .select()
    .from(members)
    .where(eq(members.authUserId, userId));
  return row;
}

async function uses(value: string) {
  const [row] = await t
    .db()
    .select({ n: inviteCodes.useCount })
    .from(inviteCodes)
    .where(eq(inviteCodes.code, value));
  return row?.n;
}

const join = (userId: string, input: Record<string, unknown>) =>
  runAction(
    "redeem_invite",
    { displayName: "New Person", ...input },
    ctxFor(accountActor(userId)),
  );

describe("redeem_invite", () => {
  it("makes the account a member with the code's role, and audits it as them", async () => {
    await code("kiwi-otter-7", { role: "admin", maxUses: 2 });
    const ctx = ctxFor(accountActor("u_new"));
    const res = await runAction(
      "redeem_invite",
      { code: "  Kiwi-OTTER-7 ", displayName: " Sam ", color: "#AA0000" },
      ctx,
    );
    const row = await memberOf("u_new");
    expect(res).toEqual({
      ok: true,
      data: { memberId: row!.id, role: "admin" },
    });
    expect(row).toMatchObject({
      displayName: "Sam",
      color: "#aa0000",
      avatarSprite: "cat",
      role: "admin",
      deactivatedAt: null,
      createdAt: FIXED_NOW,
    });
    expect(await uses("kiwi-otter-7")).toBe(1);
    const audits = await t
      .db()
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "redeem_invite"));
    expect(audits).toEqual([
      expect.objectContaining({
        actorMemberId: row!.id,
        entity: "member",
        entityId: row!.id,
        payload: { code: "kiwi-otter-7", role: "admin", displayName: "Sam" },
      }),
    ]);

    // A retry of the same request, now as the member, replays.
    const again = await runAction(
      "redeem_invite",
      { code: "kiwi-otter-7", displayName: "Sam", color: "#aa0000" },
      { ...ctx, actor: sessionActor(row!.id, "admin", { userId: "u_new" }) },
    );
    expect(again).toEqual(res);
    expect(await uses("kiwi-otter-7")).toBe(1);
  });

  it("gives a new member a steady default colour and the chosen avatar", async () => {
    await code("colour-code");
    await join("u_colour", { code: "colour-code", avatarSprite: "owl" });
    const row = await memberOf("u_colour");
    expect(row).toMatchObject({
      avatarSprite: "owl",
      color: defaultColorFor("u_colour"),
    });
    expect(MEMBER_COLORS).toContain(row!.color);
    expect(defaultColorFor("u_colour")).toBe(defaultColorFor("u_colour"));
  });

  it("stores the character picked on the join form, or none (the default)", async () => {
    await code("look-code", { maxUses: 2 });
    const look = {
      hairStyle: AVATAR_HAIR_STYLES[2],
      hairColor: AVATAR_HAIR_COLORS[3],
      skinTone: AVATAR_SKIN_TONES[4],
      shirtColor: AVATAR_SHIRT_COLORS[5],
    };
    ok(await join("u_look", { code: "look-code", ...look }));
    expect((await memberOf("u_look"))!.avatar).toEqual(look);
    ok(await join("u_plain", { code: "look-code" }));
    expect((await memberOf("u_plain"))!.avatar).toBeNull();
  });

  it("refuses part of a character, or an id the art does not have", async () => {
    await code("part-code");
    const part = await join("u_part", {
      code: "part-code",
      hairStyle: AVATAR_HAIR_STYLES[0],
    });
    expect(part).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [
        {
          path: ["hairStyle"],
          message:
            "Pick your whole character: hair style, hair colour, skin and shirt.",
        },
      ],
    });
    const odd = await join("u_part", {
      code: "part-code",
      hairStyle: "mohawk",
      hairColor: AVATAR_HAIR_COLORS[0],
      skinTone: AVATAR_SKIN_TONES[0],
      shirtColor: AVATAR_SHIRT_COLORS[0],
    });
    expect(odd).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await memberOf("u_part")).toBeUndefined();
    expect(await uses("part-code")).toBe(0);
  });

  it("says why an unusable code does not work, and creates nobody", async () => {
    await code("gone-code", {
      expiresAt: FIXED_NOW, // expires at the instant of the request
    });
    await code("cancelled", { revokedAt: new Date(FIXED_NOW.getTime() - 1) });
    await code("all-used", { maxUses: 2, useCount: 2 });
    const cases: [string, string, RegExp][] = [
      ["no-such-code", "INVITE_NOT_FOUND", /doesn't exist/],
      ["gone-code", "INVITE_EXPIRED", /has expired\. Ask a housemate/],
      ["cancelled", "INVITE_REVOKED", /was cancelled\. Ask a housemate/],
      ["all-used", "INVITE_USED_UP", /already been used\. Ask a housemate/],
    ];
    for (const [value, errCode, message] of cases) {
      const res = await join(`u_${value}`, { code: value });
      expect(res).toMatchObject({ ok: false, code: errCode });
      if (!res.ok) expect(res.message).toMatch(message);
      expect(await memberOf(`u_${value}`)).toBeUndefined();
    }
    expect(await uses("all-used")).toBe(2);
  });

  it("gives the last use of a code to exactly one of two racing accounts", async () => {
    await code("one-seat", { maxUses: 1 });
    const results = await Promise.all([
      join("u_racer_a", { code: "one-seat" }),
      join("u_racer_b", { code: "one-seat" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ code: "INVITE_USED_UP" }),
    ]);
    const joined = await t
      .db()
      .select()
      .from(members)
      .where(eq(members.role, "member"));
    expect(joined).toHaveLength(1);
    expect(await uses("one-seat")).toBe(1);
  });

  it("refuses an existing member, and a switched-off one, keeping the code's use", async () => {
    await code("spare", { maxUses: 5 });
    const me = await seedMember(db(), { authUserId: "u_member" });
    await expect(
      runAction(
        "redeem_invite",
        { code: "spare", displayName: "X" },
        ctxFor(sessionActor(me, "member", { userId: "u_member" })),
      ),
    ).resolves.toMatchObject({ ok: false, code: "ALREADY_MEMBER" });

    await seedMember(db(), {
      authUserId: "u_left",
      deactivatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    const res = await join("u_left", { code: "spare" });
    expect(res).toMatchObject({ ok: false, code: "MEMBERSHIP_ENDED" });
    if (!res.ok) expect(res.message).toMatch(/Ask a household admin/);

    // Active, but the session had not seen the row yet.
    await seedMember(db(), { authUserId: "u_raced" });
    await expect(join("u_raced", { code: "spare" })).resolves.toMatchObject({
      ok: false,
      code: "ALREADY_MEMBER",
    });
    expect(await uses("spare")).toBe(0);
  });

  it("is ui-only and needs a real session", async () => {
    await code("ui-only");
    await expect(
      runAction(
        "redeem_invite",
        { code: "ui-only", displayName: "K" },
        ctxFor(kioskActor(), { source: "kiosk" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    await expect(
      runAction(
        "redeem_invite",
        { code: "ui-only", displayName: "K" },
        ctxFor(kioskActor()),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await uses("ui-only")).toBe(0);
  });

  it("returns INVALID_INPUT per field", async () => {
    const res = await join("u_bad", {
      code: " ",
      displayName: "",
      color: "red",
    });
    expect(res).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    if (res.ok) return;
    expect(res.issues?.map((i) => i.path[0]).sort()).toEqual([
      "code",
      "color",
      "displayName",
    ]);
  });

  it("writes no ledger row for a refused join", async () => {
    await join("u_nothing", { code: "missing" });
    expect(await t.db().select().from(actionRequests)).toHaveLength(0);
  });
});

describe("join_as_founder", () => {
  const founder = (
    email: string,
    emailVerified = true,
    userId = email.split("@")[0]!,
  ) =>
    runAction(
      "join_as_founder",
      { displayName: "Founder" },
      ctxFor(accountActor(userId, { email, emailVerified })),
    );

  it("makes a verified founder an admin without a code", async () => {
    vi.stubEnv("FOUNDER_EMAILS", "ryan@example.com, partner@example.com");
    const res = await founder("Ryan@Example.com", true, "u_ryan");
    const row = await memberOf("u_ryan");
    expect(res).toEqual({
      ok: true,
      data: { memberId: row!.id, role: "admin" },
    });
    expect(row).toMatchObject({ role: "admin", displayName: "Founder" });
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      actorMemberId: row!.id,
      action: "join_as_founder",
      payload: { founder: true, role: "admin", displayName: "Founder" },
    });

    // A second founder may join too; the first cannot join twice.
    await expect(founder("partner@example.com")).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      runAction(
        "join_as_founder",
        { displayName: "Again" },
        ctxFor(accountActor("u_ryan", { email: "ryan@example.com" })),
      ),
    ).resolves.toMatchObject({ ok: false, code: "ALREADY_MEMBER" });
  });

  it("stores the founder's picked character, and refuses part of one", async () => {
    vi.stubEnv("FOUNDER_EMAILS", "ryan@example.com, jo@example.com");
    const look = {
      hairStyle: AVATAR_HAIR_STYLES[1],
      hairColor: AVATAR_HAIR_COLORS[1],
      skinTone: AVATAR_SKIN_TONES[1],
      shirtColor: AVATAR_SHIRT_COLORS[1],
    };
    const ctx = ctxFor(
      accountActor("u_ryan", {
        email: "ryan@example.com",
        emailVerified: true,
      }),
    );
    ok(
      await runAction("join_as_founder", { displayName: "Ryan", ...look }, ctx),
    );
    expect((await memberOf("u_ryan"))!.avatar).toEqual(look);
    await expect(
      runAction(
        "join_as_founder",
        { displayName: "Jo", shirtColor: AVATAR_SHIRT_COLORS[0] },
        ctxFor(
          accountActor("u_jo", {
            email: "jo@example.com",
            emailVerified: true,
          }),
        ),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await memberOf("u_jo")).toBeUndefined();
  });

  it("refuses an unverified founder address, and anyone not on the list", async () => {
    vi.stubEnv("FOUNDER_EMAILS", "ryan@example.com");
    const unverified = await founder("ryan@example.com", false);
    expect(unverified).toMatchObject({ ok: false, code: "EMAIL_NOT_VERIFIED" });
    await expect(founder("mallory@example.com")).resolves.toMatchObject({
      ok: false,
      code: "NOT_A_FOUNDER",
    });
    vi.stubEnv("FOUNDER_EMAILS", "");
    await expect(founder("ryan@example.com")).resolves.toMatchObject({
      ok: false,
      code: "NOT_A_FOUNDER",
    });
    expect(await t.db().select().from(members)).toHaveLength(0);
  });

  it("refuses a founder whose membership was switched off", async () => {
    vi.stubEnv("FOUNDER_EMAILS", "ryan@example.com");
    await seedMember(db(), {
      authUserId: "u_off",
      deactivatedAt: new Date("2026-09-01T00:00:00Z"),
    });
    await expect(
      founder("ryan@example.com", true, "u_off"),
    ).resolves.toMatchObject({ ok: false, code: "MEMBERSHIP_ENDED" });
  });

  it("reports ALREADY_MEMBER when the same account joins twice at once", async () => {
    vi.stubEnv("FOUNDER_EMAILS", "twice@example.com");
    const [a, b] = await Promise.all([
      founder("twice@example.com", true, "u_twice"),
      founder("twice@example.com", true, "u_twice"),
    ]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await t.db().select().from(members)).toHaveLength(1);
  });
});

describe("picking a gallery character on /join (issue #111)", () => {
  async function galleryAvatar(archived = false) {
    const admin = await seedMember(db(), { role: "admin" });
    const id = randomUUID();
    await insertAvatar(db(), {
      id,
      householdId: HOUSEHOLD_ID,
      name: "Knight",
      createdBy: admin,
      createdAt: FIXED_NOW,
      poses: {
        idle: {
          pathname: `avatars/${id}/a1b2c3d4e5f60718.png`,
          width: 28,
          height: 56,
        },
      },
    });
    if (archived) {
      await t
        .db()
        .update(avatars)
        .set({ archivedAt: FIXED_NOW })
        .where(eq(avatars.id, id));
    }
    return id;
  }

  it("joins wearing the picked character, by code or as a founder", async () => {
    const id = await galleryAvatar();
    await code("gallery-code");
    expect(
      await join("u_gallery", { code: "gallery-code", avatarImageId: id }),
    ).toMatchObject({ ok: true });
    expect((await memberOf("u_gallery"))?.avatarImageId).toBe(id);

    vi.stubEnv("FOUNDER_EMAILS", "f@example.com");
    expect(
      await runAction(
        "join_as_founder",
        { displayName: "F", avatarImageId: id },
        ctxFor(accountActor("u_f", { email: "f@example.com" })),
      ),
    ).toMatchObject({ ok: true });
    expect((await memberOf("u_f"))?.avatarImageId).toBe(id);

    // No pick (an empty form value) is the drawn character.
    await code("plain-code");
    await join("u_plain", { code: "plain-code", avatarImageId: "" });
    expect((await memberOf("u_plain"))?.avatarImageId).toBeNull();
  });

  it("refuses an archived or unknown pick, creating nobody and keeping the code's use", async () => {
    const archived = await galleryAvatar(true);
    await code("stale-code");
    expect(
      await join("u_stale", { code: "stale-code", avatarImageId: archived }),
    ).toMatchObject({ ok: false, code: "AVATAR_ARCHIVED" });
    expect(
      await join("u_stale", {
        code: "stale-code",
        avatarImageId: randomUUID(),
      }),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await memberOf("u_stale")).toBeUndefined();
    expect(await uses("stale-code")).toBe(0);

    vi.stubEnv("FOUNDER_EMAILS", "g@example.com");
    expect(
      await runAction(
        "join_as_founder",
        { displayName: "G", avatarImageId: archived },
        ctxFor(accountActor("u_g", { email: "g@example.com" })),
      ),
    ).toMatchObject({ ok: false, code: "AVATAR_ARCHIVED" });
    expect(await memberOf("u_g")).toBeUndefined();
  });
});
