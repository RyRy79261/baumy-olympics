// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import {
  TELEGRAM_LINK_CODE_TTL_MS,
  insertTelegramLinkCode,
} from "@baumy/db/telegram-link-codes";
import {
  actionRequests,
  auditEvents,
  members,
  telegramLinkCodes,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { ServiceActor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { runAction } from "./registry";

// link_telegram through the real runAction on PGlite (issue #27): the one
// action an unlinked Telegram user may call; the member comes from the code.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const TG = 5_000_000_201;
const OTHER_TG = 5_000_000_202;

beforeEach(() => __resetMemoryRateLimits());

const brain = (telegramUserId: number, memberId?: string): ServiceActor => ({
  kind: "service",
  tokenName: "baumy-brain",
  telegramUserId,
  ...(memberId ? { memberId } : {}),
});

const brainCtx = (actor: ServiceActor, requestId?: string) =>
  ctxFor(actor, {
    source: "brain",
    ...(requestId ? { requestId } : {}),
  });

async function codeFor(memberId: string, code = "ABCDEFGH23", now = FIXED_NOW) {
  await insertTelegramLinkCode(db(), { code, memberId, now });
  return code;
}

async function member(id: string) {
  const [r] = await t.db().select().from(members).where(eq(members.id, id));
  return r!;
}

describe("link_telegram", () => {
  it("links an unlinked Telegram user to the code's member, keyed and audited on that member", async () => {
    const ryan = await seedMember(db(), { displayName: "Ryan" });
    const code = await codeFor(ryan);
    const ctx = brainCtx(brain(TG), "link-req-0001");

    const res = await runAction("link_telegram", { code }, ctx);
    expect(res).toEqual({
      ok: true,
      data: { memberId: ryan, displayName: "Ryan" },
    });
    expect((await member(ryan)).telegramUserId).toBe(TG);

    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      actorMemberId: ryan,
      source: "brain",
      action: "link_telegram",
      entity: "member",
      entityId: ryan,
      payload: { telegramUserId: TG, previousTelegramUserId: null },
    });
    expect(JSON.stringify(audit)).not.toContain(code);
    const [ledger] = await t.db().select().from(actionRequests);
    expect(ledger).toMatchObject({
      actorMemberId: ryan,
      source: "brain",
      requestId: "link-req-0001",
      status: "done",
    });

    const [row] = await t.db().select().from(telegramLinkCodes);
    expect(row).toMatchObject({ usedAt: FIXED_NOW, usedByTg: TG });

    // Brain retries with the same key: now linked, the actor carries the
    // member, and the stored result comes back without running again.
    const replay = await runAction(
      "link_telegram",
      { code },
      brainCtx(brain(TG, ryan), "link-req-0001"),
    );
    expect(replay).toEqual(res);
    expect(await t.db().select().from(auditEvents)).toHaveLength(1);
  });

  it("refuses a reused, an expired and a wrong code", async () => {
    const ryan = await seedMember(db());
    const used = await codeFor(ryan, "USEDCODE23");
    await runAction("link_telegram", { code: used }, brainCtx(brain(TG)));

    const old = await codeFor(
      ryan,
      "OLDCODE234",
      new Date(FIXED_NOW.getTime() - TELEGRAM_LINK_CODE_TTL_MS),
    );
    for (const code of [used, old, "NOSUCHCODE"]) {
      await expect(
        runAction("link_telegram", { code }, brainCtx(brain(OTHER_TG))),
      ).resolves.toMatchObject({ ok: false, code: "LINK_CODE_INVALID" });
    }
    expect(await t.db().select().from(auditEvents)).toHaveLength(1);
  });

  it("refuses a Telegram id linked to another member, leaving the code unused", async () => {
    const ryan = await seedMember(db());
    const sam = await seedMember(db(), { telegramUserId: TG });
    const code = await codeFor(ryan);

    // Unlinked or linked, the header's tg id is what counts.
    for (const actor of [brain(TG), brain(TG, sam)]) {
      await expect(
        runAction("link_telegram", { code }, brainCtx(actor)),
      ).resolves.toMatchObject({ ok: false, code: "TELEGRAM_ALREADY_LINKED" });
    }
    expect((await member(ryan)).telegramUserId).toBeNull();
    const [row] = await t.db().select().from(telegramLinkCodes);
    expect(row!.usedAt).toBeNull();
    expect(await t.db().select().from(auditEvents)).toHaveLength(0);
  });

  it("moves a member's link to a new Telegram id", async () => {
    const ryan = await seedMember(db(), { telegramUserId: OTHER_TG });
    const code = await codeFor(ryan);
    await expect(
      runAction("link_telegram", { code }, brainCtx(brain(TG))),
    ).resolves.toMatchObject({ ok: true });
    expect((await member(ryan)).telegramUserId).toBe(TG);
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit!.payload).toEqual({
      telegramUserId: TG,
      previousTelegramUserId: OTHER_TG,
    });
  });

  it("refuses a deactivated member's code", async () => {
    const gone = await seedMember(db(), { deactivatedAt: FIXED_NOW });
    const code = await codeFor(gone);
    await expect(
      runAction("link_telegram", { code }, brainCtx(brain(TG))),
    ).resolves.toMatchObject({ ok: false, code: "LINK_CODE_INVALID" });
  });

  it("rate-limits repeated tries per Telegram id", async () => {
    await seedMember(db());
    for (let i = 0; i < 5; i++) {
      await expect(
        runAction(
          "link_telegram",
          { code: `WRONGCODE${i}` },
          brainCtx(brain(TG)),
        ),
      ).resolves.toMatchObject({ ok: false, code: "LINK_CODE_INVALID" });
    }
    await expect(
      runAction("link_telegram", { code: "WRONGCODE9" }, brainCtx(brain(TG))),
    ).resolves.toMatchObject({ ok: false, code: "RATE_LIMITED" });
    // Another Telegram user has a bucket of its own.
    await expect(
      runAction(
        "link_telegram",
        { code: "WRONGCODE9" },
        brainCtx(brain(OTHER_TG)),
      ),
    ).resolves.toMatchObject({ ok: false, code: "LINK_CODE_INVALID" });
  });

  it("is offered to brain only, and only a service may call it", async () => {
    const ryan = await seedMember(db());
    const code = await codeFor(ryan);
    await expect(
      runAction("link_telegram", { code }, ctxFor(sessionActor(ryan))),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    await expect(
      runAction(
        "link_telegram",
        { code },
        ctxFor(sessionActor(ryan), { source: "brain" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    // A service actor with no Telegram user behind it.
    await expect(
      runAction(
        "link_telegram",
        { code },
        ctxFor(
          { kind: "service", tokenName: "baumy-brain" },
          { source: "brain" },
        ),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    const [row] = await t.db().select().from(telegramLinkCodes);
    expect(row!.usedAt).toBeNull();
  });

  it("refuses a code that could not be one before touching the database", async () => {
    await expect(
      runAction("link_telegram", { code: "short" }, brainCtx(brain(TG))),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});
