// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import {
  auditEvents,
  members,
  reminderAcks,
  reminders,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import { rosterAvatars } from "@baumy/types";
import {
  FIXED_NOW,
  accountActor,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { RequestCtx } from "./define";
import { REGISTRY, runAction } from "./registry";

// The reminder actions through the real runAction on PGlite (ADR 0005 §4,
// issue #63): list_reminders, create_reminder, acknowledge_reminder and
// dismiss_reminder. Success, every error code, the surfaces and the
// permissions: any member may post, see or dismiss; the kiosk needs no PIN
// (the tapped face is the member); MCP gets none of them.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const MIN = 60_000;
const at = (minutes: number) => new Date(FIXED_NOW.getTime() + minutes * MIN);

let ryan: string;
let jo: string;

beforeEach(async () => {
  __resetMemoryRateLimits();
  ryan = await seedMember(db(), {
    displayName: "Ryan",
    createdAt: at(-60),
  });
  jo = await seedMember(db(), { displayName: "Jo", createdAt: at(-30) });
});

const as = (member: string, over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(member), over);
const kiosk = (memberId?: string) =>
  ctxFor(kioskActor(memberId), { source: "kiosk" });
const brain = (memberId: string): RequestCtx =>
  ctxFor(
    { kind: "service", tokenName: "baumy-brain", memberId },
    { source: "brain" },
  );
const ai = (memberId: string): RequestCtx =>
  ctxFor(sessionActor(memberId), { source: "ai" });
const mcp = (memberId: string): RequestCtx =>
  ctxFor(
    { kind: "mcp", memberId, scopes: ["baumy:read", "baumy:write"] },
    { source: "mcp" },
  );

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

async function post(
  title: string,
  ctx: RequestCtx = as(ryan),
  body?: string,
): Promise<string> {
  return ok(
    await runAction(
      "create_reminder",
      { title, ...(body === undefined ? {} : { body }) },
      ctx,
    ),
  ).reminderId;
}

const list = async (ctx: RequestCtx = as(ryan)) =>
  ok(await runAction("list_reminders", {}, ctx));

async function audits(reminderId: string) {
  return t
    .db()
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entity, "reminder"),
        eq(auditEvents.entityId, reminderId),
      ),
    );
}

describe("create_reminder", () => {
  it("posts a reminder by the member, audited, and replays a retry", async () => {
    const ctx = as(ryan);
    const input = { title: "  Handyman on Wednesday ", body: " Wed 10-16 " };
    const first = ok(await runAction("create_reminder", input, ctx));
    expect(first).toEqual({
      reminderId: expect.any(String),
      title: "Handyman on Wednesday",
    });
    expect(ok(await runAction("create_reminder", input, ctx))).toEqual(first);
    expect(await t.db().select().from(reminders)).toEqual([
      expect.objectContaining({
        id: first.reminderId,
        title: "Handyman on Wednesday",
        body: "Wed 10-16",
        createdBy: ryan,
        createdAt: FIXED_NOW,
        dismissedAt: null,
      }),
    ]);
    const rows = await audits(first.reminderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorMemberId: ryan,
      source: "ui",
      action: "create_reminder",
    });
  });

  it("refuses a reminder with no title", async () => {
    expect(
      await runAction("create_reminder", { title: " " }, as(ryan)),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ path: ["title"], message: "Give the reminder a title." }],
    });
    expect(await t.db().select().from(reminders)).toHaveLength(0);
  });

  it("works from the kiosk without a PIN, from the AI and from brain", async () => {
    await post("From the kitchen", kiosk(jo));
    await post("From Baumy", ai(ryan));
    await post("From Telegram", brain(jo));
    const titles = (await list()).reminders
      .map((r) => [r.title, r.createdBy.name])
      .sort();
    expect(titles).toEqual([
      ["From Baumy", "Ryan"],
      ["From Telegram", "Jo"],
      ["From the kitchen", "Jo"],
    ]);
  });

  it("is not offered over MCP, and is for household members only", async () => {
    expect(
      await runAction("create_reminder", { title: "Hi" }, mcp(ryan)),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect(
      await runAction(
        "create_reminder",
        { title: "Hi" },
        ctxFor(accountActor("u")),
      ),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    // The kiosk with nobody picked cannot post: a write needs a member.
    expect(
      await runAction("create_reminder", { title: "Hi" }, kiosk()),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await t.db().select().from(reminders)).toHaveLength(0);
  });

  it("previews what it will post", async () => {
    const ctx = { ...as(ryan), db: db() };
    expect(
      await REGISTRY.create_reminder.preview!(ctx, { title: "Boiler" }),
    ).toBe('Post the reminder "Boiler" on the kitchen screen');
  });
});

describe("list_reminders", () => {
  it("draws members who have not chosen in shirts of their own, as the dashboard does", async () => {
    for (const name of ["Sam", "Mika", "Kim", "Lou"]) {
      await seedMember(db(), { displayName: name });
    }
    const listed = await list();
    const shirts = listed.members.map((m) => m.avatar.shirtColor);
    expect(listed.members).toHaveLength(6);
    expect(new Set(shirts).size).toBe(6);
  });

  it("lists the active reminders with who has seen them, and every active member's character", async () => {
    const chosen = {
      hairStyle: "bob",
      hairColor: "black",
      skinTone: "tan",
      shirtColor: "pink",
    } as const;
    await t
      .db()
      .update(members)
      .set({ avatar: chosen })
      .where(eq(members.id, jo));
    await seedMember(db(), { displayName: "Gone", deactivatedAt: at(-1) });
    const id = await post("Boiler", as(ryan), "Wed 10-16");
    ok(
      await runAction(
        "acknowledge_reminder",
        { reminderId: id },
        as(ryan, { now: at(2) }),
      ),
    );
    expect(await list()).toEqual({
      members: [
        {
          id: ryan,
          displayName: "Ryan",
          color: "#336699",
          // The roster's character: the one every screen draws.
          avatar: rosterAvatars([
            { id: ryan, avatar: null },
            { id: jo, avatar: chosen },
          ]).get(ryan),
          image: null,
        },
        {
          id: jo,
          displayName: "Jo",
          color: "#336699",
          avatar: chosen,
          image: null,
        },
      ],
      reminders: [
        {
          id,
          title: "Boiler",
          body: "Wed 10-16",
          createdBy: { id: ryan, name: "Ryan" },
          createdAt: FIXED_NOW.toISOString(),
          seenBy: [ryan],
          waitingFor: [jo],
        },
      ],
    });
  });

  it("lists only active members as having seen it, so every face can be drawn", async () => {
    const sam = await seedMember(db(), { displayName: "Sam" });
    const id = await post("Boiler");
    ok(
      await runAction(
        "acknowledge_reminder",
        { reminderId: id },
        as(sam, { now: at(1) }),
      ),
    );
    ok(
      await runAction(
        "acknowledge_reminder",
        { reminderId: id },
        as(ryan, { now: at(2) }),
      ),
    );
    expect((await list()).reminders[0]).toMatchObject({
      seenBy: [sam, ryan],
      waitingFor: [jo],
    });
    await t
      .db()
      .update(members)
      .set({ deactivatedAt: at(3) })
      .where(eq(members.id, sam));
    const after = await list();
    expect(after.members.map((m) => m.id)).toEqual([ryan, jo]);
    expect(after.reminders[0]).toMatchObject({
      seenBy: [ryan],
      waitingFor: [jo],
    });
  });

  it("does not wait for someone who joined after it was posted", async () => {
    const id = await post("Boiler");
    const sam = await seedMember(db(), {
      displayName: "Sam",
      createdAt: at(5),
    });
    const listed = await list();
    expect(listed.members.map((m) => m.id)).toEqual([ryan, jo, sam]);
    expect(listed.reminders[0]).toMatchObject({
      id,
      seenBy: [],
      waitingFor: [ryan, jo],
    });
  });

  it("does not bring back a reminder everyone saw when someone joins", async () => {
    const id = await post("Boiler");
    ok(await runAction("acknowledge_reminder", { reminderId: id }, as(ryan)));
    const last = ok(
      await runAction("acknowledge_reminder", { reminderId: id }, as(jo)),
    );
    expect(last.seenByEveryone).toBe(true);
    await seedMember(db(), { displayName: "Sam" });
    expect((await list()).reminders).toEqual([]);
  });

  it("is what the idle kitchen screen reads, and brain and the AI too", async () => {
    const id = await post("Boiler");
    for (const ctx of [kiosk(), kiosk(jo), brain(jo), ai(ryan)]) {
      expect((await list(ctx)).reminders.map((r) => r.id)).toEqual([id]);
    }
  });

  it("is not offered over MCP, and not to someone who is not a member", async () => {
    expect(await runAction("list_reminders", {}, mcp(ryan))).toMatchObject({
      ok: false,
      code: "SURFACE_FORBIDDEN",
    });
    expect(
      await runAction("list_reminders", {}, ctxFor(accountActor("u"))),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await runAction("list_reminders", { all: true }, as(ryan)),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("acknowledge_reminder", () => {
  it("records the tapped face on the kiosk without a PIN, and the reminder leaves once everyone has seen it", async () => {
    const id = await post("Boiler");
    const first = ok(
      await runAction("acknowledge_reminder", { reminderId: id }, kiosk(ryan)),
    );
    expect(first).toEqual({
      reminderId: id,
      memberId: ryan,
      seenByEveryone: false,
    });
    const [audit] = await audits(id).then((rows) =>
      rows.filter((r) => r.action === "acknowledge_reminder"),
    );
    expect(audit).toMatchObject({ source: "kiosk", actorMemberId: ryan });
    expect((await list()).reminders).toHaveLength(1);

    const last = ok(
      await runAction("acknowledge_reminder", { reminderId: id }, kiosk(jo)),
    );
    expect(last.seenByEveryone).toBe(true);
    expect((await list()).reminders).toEqual([]);
  });

  it("seeing it twice changes nothing", async () => {
    const id = await post("Boiler");
    ok(
      await runAction(
        "acknowledge_reminder",
        { reminderId: id },
        as(jo, { now: at(1) }),
      ),
    );
    ok(await runAction("acknowledge_reminder", { reminderId: id }, brain(jo)));
    expect(await t.db().select().from(reminderAcks)).toEqual([
      { reminderId: id, memberId: jo, ackedAt: at(1) },
    ]);
  });

  it("is NOT_FOUND for a dismissed reminder or one that is not there", async () => {
    const id = await post("Boiler");
    ok(await runAction("dismiss_reminder", { reminderId: id }, as(jo)));
    for (const reminderId of [id, "6f1c1e8e-3a57-4c1b-9d8e-0f1f2a3b4c5d"]) {
      expect(
        await runAction("acknowledge_reminder", { reminderId }, as(ryan)),
      ).toEqual({
        ok: false,
        code: "NOT_FOUND",
        message: "That reminder is not there any more.",
      });
    }
    expect(await t.db().select().from(reminderAcks)).toEqual([]);
  });

  it("needs a member: not the idle kiosk, not MCP", async () => {
    const id = await post("Boiler");
    expect(
      await runAction("acknowledge_reminder", { reminderId: id }, kiosk()),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(
      await runAction("acknowledge_reminder", { reminderId: id }, mcp(ryan)),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    expect(
      await runAction("acknowledge_reminder", { reminderId: "r1" }, as(ryan)),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("previews the reminder's title", async () => {
    const id = await post("Boiler");
    const ctx = { ...as(ryan), db: db() };
    expect(
      await REGISTRY.acknowledge_reminder.preview!(ctx, { reminderId: id }),
    ).toBe('Mark "Boiler" as seen');
    expect(
      await REGISTRY.acknowledge_reminder.preview!(ctx, {
        reminderId: "6f1c1e8e-3a57-4c1b-9d8e-0f1f2a3b4c5d",
      }),
    ).toBe("Mark the reminder as seen");
  });
});

describe("dismiss_reminder", () => {
  it("takes a reminder off for everyone, audited with its title", async () => {
    const id = await post("Boiler");
    const data = ok(
      await runAction("dismiss_reminder", { reminderId: id }, kiosk(jo)),
    );
    expect(data).toEqual({ reminderId: id, title: "Boiler" });
    expect((await list()).reminders).toEqual([]);
    const [row] = await t.db().select().from(reminders);
    expect(row).toMatchObject({ dismissedAt: FIXED_NOW, dismissedBy: jo });
    const [audit] = (await audits(id)).filter(
      (r) => r.action === "dismiss_reminder",
    );
    expect(audit).toMatchObject({
      source: "kiosk",
      actorMemberId: jo,
      payload: { reminderId: id, title: "Boiler" },
    });
  });

  it("tells the loser of a race it is already gone", async () => {
    const id = await post("Boiler");
    ok(await runAction("dismiss_reminder", { reminderId: id }, as(jo)));
    expect(
      await runAction("dismiss_reminder", { reminderId: id }, as(ryan)),
    ).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message:
        "That reminder has already been dismissed, or is not there any more.",
    });
  });

  it("is a confirm-risk write from brain and the AI, never over MCP", async () => {
    expect(REGISTRY.dismiss_reminder.risk).toBe("confirm");
    const id = await post("Boiler");
    expect(
      await runAction("dismiss_reminder", { reminderId: id }, mcp(ryan)),
    ).toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    ok(await runAction("dismiss_reminder", { reminderId: id }, brain(ryan)));
    expect(
      await runAction("dismiss_reminder", { reminderId: id }, kiosk()),
    ).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("previews the reminder's title, or that it is gone", async () => {
    const id = await post("Boiler");
    const ctx = { ...as(ryan), db: db() };
    expect(
      await REGISTRY.dismiss_reminder.preview!(ctx, { reminderId: id }),
    ).toBe('Dismiss the reminder "Boiler" for everyone');
    ok(await runAction("dismiss_reminder", { reminderId: id }, as(jo)));
    expect(
      await REGISTRY.dismiss_reminder.preview!(ctx, { reminderId: id }),
    ).toBe("Dismiss the reminder (already gone) for everyone");
  });
});
