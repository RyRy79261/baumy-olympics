// @vitest-environment node
import { count, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import { formatBerlinDateTime } from "@baumy/core";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { CHORE_ICONS } from "@baumy/types";
import {
  actionRequests,
  auditEvents,
  choreRuleVersions,
  chores,
  completionScores,
  completions,
  members,
  seasons,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  accountActor,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import {
  NEW_BOUNTY_MS,
  berlinMidnightAfter,
  isUrgent,
} from "@/lib/chores/urgency";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { RequestCtx } from "./define";
import { spriteFor } from "./manage-chore";
import { REGISTRY, runAction } from "./registry";

// list_chores, log_completion and manage_chore through the real runAction
// on PGlite (issue #14): success, every error code, the surfaces and the
// permissions.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (hours: number) => new Date(FIXED_NOW.getTime() + hours * HOUR);
const TRASH = SEED_CHORES.trash;

const PIN = "4321";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});
beforeEach(() => {
  __resetMemoryRateLimits();
});

function kiosk(memberId: string, name = "Kiosker"): Actor {
  return { kind: "kiosk", deviceId: "dev-1", memberId, displayName: name };
}

function mcp(memberId: string, scopes = ["baumy:read", "baumy:write"]): Actor {
  return { kind: "mcp", memberId, scopes };
}

function brain(memberId: string): Actor {
  return { kind: "service", tokenName: "baumy-brain", memberId };
}

async function tally() {
  const n = async (
    table: typeof completions | typeof auditEvents | typeof actionRequests,
  ) => {
    const [row] = await t.db().select({ n: count() }).from(table);
    return row!.n;
  };
  return {
    completions: await n(completions),
    audits: await n(auditEvents),
    requests: await n(actionRequests),
  };
}

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

/** The "+N" in a preview line. */
function previewPoints(line: string | { invalid: string }): number {
  if (typeof line !== "string") throw new Error(`refused: ${line.invalid}`);
  const m = /: \+(\d+) \(streak (\d+)\)/.exec(line);
  if (!m) throw new Error(`no points in "${line}"`);
  return Number(m[1]);
}

async function preview(ctx: RequestCtx, input: Record<string, unknown>) {
  const def = REGISTRY.log_completion;
  return def.preview!({ ...ctx, db: db() }, def.input.parse(input));
}

let ryan: string;
let partner: string;
let trash: string;

beforeEach(async () => {
  ryan = await seedMember(db(), {
    displayName: "Ryan",
    kioskPinHash: pinHash,
  });
  partner = await seedMember(db(), {
    displayName: "Partner",
    kioskPinHash: pinHash,
  });
  // Added a month ago, so it is not new.
  ({ choreId: trash } = await seedChore(db(), {
    ...TRASH,
    createdAt: at(-30 * 24),
  }));
});

describe("list_chores", () => {
  it("lists each chore with its points, streak, due state and what logging it would score for me", async () => {
    const { choreId: dishes } = await seedChore(db(), SEED_CHORES.dishes);
    ok(
      await runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(sessionActor(partner)),
      ),
    );
    const data = ok(
      await runAction(
        "list_chores",
        {},
        ctxFor(sessionActor(ryan), { now: at(1) }),
      ),
    );
    expect(data.chores.map((c) => c.name)).toEqual(["Dishes", "Trash"]);
    expect(data.chores[1]).toEqual({
      id: trash,
      name: "Trash",
      sprite: "trash",
      kind: "maintenance",
      proofMode: "none",
      confirmMode: "optimistic",
      effortFactorPct: 100,
      archived: false,
      basePoints: TRASH.basePoints,
      cooldownMinutes: TRASH.cooldownMinutes,
      // Base 20 at effort 100% implies 4 days.
      intervalMinutes: 4 * 24 * 60,
      streak: { holderId: partner, holderName: "Partner", length: 1 },
      lastDoneAt: FIXED_NOW.toISOString(),
      state: "cooldown",
      availableAt: at(48).toISOString(),
      dueAt: at(96).toISOString(),
      urgent: false,
      isNew: false,
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT.*Z$/),
      // Ryan would break the partner's 1-streak: 20 + 20% of 20.
      next: {
        totalPts: 24,
        streakLen: 1,
        streakPts: 20,
        breakPts: 4,
        brokenMemberId: partner,
        brokenLen: 1,
      },
    });
    expect(data.chores[0]).toMatchObject({
      id: dishes,
      state: "due",
      urgent: true,
      streak: null,
      lastDoneAt: null,
      next: { totalPts: SEED_CHORES.dishes.basePoints, streakLen: 1 },
    });
  });

  it("says each chore's kind, and whether it is new (added in the last 3 days)", async () => {
    await seedChore(db(), {
      ...SEED_CHORES.dishes,
      kind: "consumable",
      createdAt: new Date(FIXED_NOW.getTime() - NEW_BOUNTY_MS + MIN),
    });
    await seedChore(db(), {
      ...SEED_CHORES.bathroom,
      createdAt: new Date(FIXED_NOW.getTime() - NEW_BOUNTY_MS),
    });
    const data = ok(
      await runAction("list_chores", {}, ctxFor(sessionActor(ryan))),
    );
    expect(data.chores.map((c) => [c.name, c.kind, c.isNew])).toEqual([
      ["Bathroom", "maintenance", false],
      ["Dishes", "consumable", true],
      ["Trash", "maintenance", false],
    ]);
  });

  it("calls a chore urgent when it falls due before Berlin midnight", async () => {
    // Trash was done 73 hours ago: out of its 48h cooldown, due again at
    // 4 days, which is 23 hours from now (11:00Z tomorrow). It is 12:00 in
    // Berlin now, so the next midnight (22:00Z) comes first.
    await t.db().delete(completions);
    ok(
      await runAction(
        "log_completion",
        { choreId: trash, occurredAt: at(-73).toISOString() },
        ctxFor(sessionActor(partner), { now: at(-73) }),
      ),
    );
    const list = async (hours: number) =>
      ok(
        await runAction(
          "list_chores",
          {},
          ctxFor(sessionActor(ryan), { now: at(hours) }),
        ),
      ).chores[0]!;
    const noon = await list(0);
    expect(noon).toMatchObject({
      state: "done",
      dueAt: at(23).toISOString(),
      urgent: false,
    });
    // Half an hour before midnight: still due tomorrow, not today.
    expect(await list(11.5)).toMatchObject({ state: "done", urgent: false });
    // Half an hour after midnight it falls due today: urgent.
    expect(await list(12.5)).toMatchObject({ state: "done", urgent: true });
    // And once it is due, it stays urgent.
    expect(await list(24)).toMatchObject({ state: "due", urgent: true });
  });

  it("isUrgent: due, or due before midnight; never an unavailable chore", () => {
    const now = FIXED_NOW;
    const midnight = berlinMidnightAfter(now);
    // 12:00 in Berlin (CEST): midnight is 22:00Z.
    expect(midnight.toISOString()).toBe("2026-09-27T22:00:00.000Z");
    const due = (
      state: "due" | "cooldown" | "done" | "unavailable",
      t: Date | null,
    ) => isUrgent({ state, dueAt: t ? t.toISOString() : null }, now);
    expect(due("due", null)).toBe(true);
    expect(due("cooldown", new Date(midnight.getTime() - 1))).toBe(true);
    expect(due("done", new Date(midnight.getTime() - 1))).toBe(true);
    expect(due("cooldown", midnight)).toBe(false);
    expect(due("done", null)).toBe(false);
    expect(due("unavailable", new Date(midnight.getTime() - 1))).toBe(false);
    // The day the clocks go back is 25 hours long: midnight is 23:00Z.
    expect(
      berlinMidnightAfter(new Date("2026-10-25T10:00:00Z")).toISOString(),
    ).toBe("2026-10-25T23:00:00.000Z");
  });

  it("leaves archived chores out unless asked, and never offers to score one", async () => {
    await seedChore(db(), { ...SEED_CHORES.dishes, archivedAt: FIXED_NOW });
    const ctx = ctxFor(sessionActor(ryan));
    const active = ok(await runAction("list_chores", {}, ctx));
    expect(active.chores.map((c) => c.name)).toEqual(["Trash"]);
    const all = ok(
      await runAction("list_chores", { includeArchived: true }, ctx),
    );
    expect(
      all.chores.map((c) => [c.name, c.archived, c.state, c.next]),
    ).toEqual([
      ["Dishes", true, "unavailable", null],
      ["Trash", false, "due", expect.objectContaining({ totalPts: 20 })],
    ]);
  });

  it("shows a chore whose weight starts later as unavailable", async () => {
    await seedChore(db(), { ...SEED_CHORES.dishes, effectiveFrom: at(24) });
    const data = ok(
      await runAction("list_chores", {}, ctxFor(sessionActor(ryan))),
    );
    expect(data.chores[0]).toMatchObject({
      name: "Dishes",
      basePoints: null,
      intervalMinutes: null,
      state: "unavailable",
      availableAt: null,
      dueAt: null,
      next: null,
    });
  });

  it("is offered on every surface", async () => {
    const cases: [Actor, RequestCtx["source"]][] = [
      [sessionActor(ryan), "ui"],
      [kiosk(ryan), "kiosk"],
      [sessionActor(ryan), "ai"],
      [mcp(ryan, ["baumy:read"]), "mcp"],
      [brain(ryan), "brain"],
    ];
    for (const [actor, source] of cases) {
      await expect(
        runAction("list_chores", {}, ctxFor(actor, { source })),
      ).resolves.toMatchObject({ ok: true });
    }
  });

  it("refuses anyone who is not a member", async () => {
    for (const actor of [accountActor("stranger"), mcp(ryan, [])]) {
      await expect(
        runAction(
          "list_chores",
          {},
          ctxFor(actor, { source: actor.kind === "kiosk" ? "kiosk" : "ui" }),
        ),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
  });

  it("shows the kitchen screen the chores before anyone taps in, with no preview", async () => {
    const idle: Actor = { kind: "kiosk", deviceId: "dev-1" };
    const data = ok(
      await runAction("list_chores", {}, ctxFor(idle, { source: "kiosk" })),
    );
    expect(data.chores.length).toBeGreaterThan(0);
    for (const c of data.chores) expect(c.next).toBeNull();
  });

  it("refuses unknown input", async () => {
    await expect(
      runAction("list_chores", { all: true }, ctxFor(sessionActor(ryan))),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("log_completion", () => {
  it("logs the phone's self-claim with source ui, scores it and audits it once", async () => {
    const ctx = ctxFor(sessionActor(ryan));
    const data = ok(await runAction("log_completion", { choreId: trash }, ctx));
    expect(data).toEqual({
      completionId: expect.any(String),
      choreId: trash,
      choreName: "Trash",
      doneBy: ryan,
      doneByName: "Ryan",
      loggedBy: ryan,
      status: "pending",
      occurredAt: FIXED_NOW.toISOString(),
      counted: true,
      hasPhoto: false,
      totalPts: TRASH.basePoints,
      streakLen: 1,
      breakPts: 0,
      brokenMemberId: null,
      brokenMemberName: null,
      brokenLen: null,
    });
    const [row] = await t.db().select().from(completions);
    expect(row).toMatchObject({
      id: data.completionId,
      source: "ui",
      doneBy: ryan,
      loggedBy: ryan,
      clientRequestId: ctx.requestId,
    });
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      actorMemberId: ryan,
      source: "ui",
      action: "log_completion",
      entity: "completion",
      entityId: data.completionId,
      payload: { choreId: trash },
    });
    await expect(tally()).resolves.toEqual({
      completions: 1,
      audits: 1,
      requests: 1,
    });
  });

  it("logs the kiosk's self-claim with source kiosk and needs no PIN", async () => {
    const data = ok(
      await runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(kiosk(ryan), { source: "kiosk" }),
      ),
    );
    const [row] = await t
      .db()
      .select()
      .from(completions)
      .where(eq(completions.id, data.completionId));
    expect(row).toMatchObject({
      source: "kiosk",
      doneBy: ryan,
      loggedBy: ryan,
    });
  });

  it("naming yourself as the doer is still a self-claim", async () => {
    await expect(
      runAction(
        "log_completion",
        { choreId: trash, doneBy: ryan },
        ctxFor(kiosk(ryan), { source: "kiosk" }),
      ),
    ).resolves.toMatchObject({ ok: true, data: { status: "pending" } });
  });

  it("on the kiosk, logging for someone else needs the logger's PIN in the same request", async () => {
    const input = { choreId: trash, doneBy: partner };
    const ctx = ctxFor(kiosk(ryan, "Ryan"), { source: "kiosk" });
    await expect(runAction("log_completion", input, ctx)).resolves.toEqual({
      ok: false,
      code: "ATTESTATION_REQUIRED",
      message: "Enter your PIN to do this.",
    });
    await expect(
      runAction("log_completion", input, { ...ctx, pin: "0000" }),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_FAILED" });
    await expect(tally()).resolves.toEqual({
      completions: 0,
      audits: 0,
      requests: 0,
    });

    const data = ok(
      await runAction("log_completion", input, { ...ctx, pin: PIN }),
    );
    expect(data).toMatchObject({
      doneBy: partner,
      doneByName: "Partner",
      loggedBy: ryan,
      // Logged by someone else: verified from the start.
      status: "confirmed",
      totalPts: TRASH.basePoints,
    });
    const [row] = await t.db().select().from(completions);
    expect(row).toMatchObject({
      source: "kiosk",
      doneBy: partner,
      loggedBy: ryan,
      verifiedBy: ryan,
    });
  });

  it("from a phone, a session vouches for someone else without a PIN", async () => {
    await expect(
      runAction(
        "log_completion",
        { choreId: trash, doneBy: partner },
        ctxFor(sessionActor(ryan)),
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { doneBy: partner, loggedBy: ryan, status: "confirmed" },
    });
  });

  it("the preview's number is the total_pts stored, streaks and breaks included", async () => {
    const plan: [string, number, "ui" | "kiosk"][] = [
      [ryan, 0, "ui"],
      [ryan, 48, "kiosk"],
      [ryan, 96, "ui"],
      [partner, 144, "kiosk"],
      [ryan, 192, "ui"],
    ];
    const seen: number[] = [];
    for (const [who, h, source] of plan) {
      const actor = source === "kiosk" ? kiosk(who) : sessionActor(who);
      const ctx = ctxFor(actor, { source, now: at(h) });
      const line = await preview(ctx, { choreId: trash });
      const listed = ok(await runAction("list_chores", {}, ctx)).chores.find(
        (c) => c.id === trash,
      )!;
      const data = ok(
        await runAction("log_completion", { choreId: trash }, ctx),
      );
      const [stored] = await t
        .db()
        .select({ total: completionScores.totalPts })
        .from(completionScores)
        .where(eq(completionScores.completionId, data.completionId));
      expect(previewPoints(line)).toBe(stored!.total);
      expect(listed.next?.totalPts).toBe(stored!.total);
      expect(data.totalPts).toBe(stored!.total);
      seen.push(stored!.total);
    }
    // 20, 25, 30; the partner breaks a 3-streak (20 + 12); Ryan breaks 1 (24).
    expect(seen).toEqual([20, 25, 30, 32, 24]);
  });

  it("the preview names the streak it breaks, and says a partner-mode claim waits", async () => {
    ok(
      await runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(sessionActor(partner)),
      ),
    );
    const ctx = ctxFor(sessionActor(ryan), { now: at(48) });
    await expect(preview(ctx, { choreId: trash })).resolves.toBe(
      "Log Trash for Ryan: +24 (streak 1), breaking Partner's streak of 1 for +4",
    );
    const { choreId: bathroom } = await seedChore(db(), {
      ...SEED_CHORES.bathroom,
      confirmMode: "partner",
    });
    await expect(preview(ctx, { choreId: bathroom })).resolves.toBe(
      `Log Bathroom for Ryan: +${SEED_CHORES.bathroom.basePoints} (streak 1), once someone else confirms it`,
    );
    await expect(
      preview(ctx, { choreId: bathroom, doneBy: partner }),
    ).resolves.toBe(
      `Log Bathroom for Partner: +${SEED_CHORES.bathroom.basePoints} (streak 1)`,
    );
  });

  it("the preview explains a refusal instead of a score", async () => {
    const ctx = ctxFor(sessionActor(ryan));
    ok(await runAction("log_completion", { choreId: trash }, ctx));
    await expect(preview(ctx, { choreId: trash })).resolves.toBe(
      `Trash was done recently. You can log it again from ${formatBerlinDateTime(at(48))} (Berlin time).`,
    );
    await expect(
      preview(ctx, {
        choreId: trash,
        doneBy: "00000000-0000-4000-8000-00000000dead",
      }),
    ).resolves.toBe("That person is not an active member of the household.");
  });

  it("a second attempt within the cooldown is refused with the retry time in Berlin, and stores nothing", async () => {
    ok(
      await runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(sessionActor(ryan)),
      ),
    );
    const before = await tally();
    // The partner, 12 hours later, on the kiosk.
    const second = await runAction(
      "log_completion",
      { choreId: trash },
      ctxFor(kiosk(partner), { source: "kiosk", now: at(12) }),
    );
    // FIXED_NOW is Sun 27 Sep 10:00Z (12:00 Berlin); 48h later is Tue 12:00.
    expect(second).toEqual({
      ok: false,
      code: "COOLDOWN",
      message:
        "Trash was done recently. You can log it again from Tue 29 Sep, 12:00 (Berlin time).",
      retryAt: at(48).toISOString(),
    });
    await expect(tally()).resolves.toEqual(before);
  });

  it("maps every other refusal to its code and stores nothing", async () => {
    const ctx = (over: Partial<RequestCtx> = {}) =>
      ctxFor(sessionActor(ryan), over);
    const { choreId: photo } = await seedChore(db(), {
      ...SEED_CHORES.dishes,
      proofMode: "required",
    });
    const { choreId: archived } = await seedChore(db(), {
      name: "Old",
      basePoints: 10,
      cooldownMinutes: 60,
      archivedAt: FIXED_NOW,
    });
    const { choreId: later } = await seedChore(db(), {
      name: "Later",
      basePoints: 10,
      cooldownMinutes: 60,
      effectiveFrom: at(24),
    });
    const { choreId: bathroom } = await seedChore(db(), SEED_CHORES.bathroom);
    ok(await runAction("log_completion", { choreId: bathroom }, ctx()));
    const before = await tally();

    const cases: [Record<string, unknown>, string, string][] = [
      [
        { choreId: trash, occurredAt: at(1).toISOString() },
        "FUTURE",
        "That time is in the future. Log it once it is done.",
      ],
      [
        { choreId: trash, occurredAt: at(-25).toISOString() },
        "BACKDATE_TOO_FAR",
        "That was more than 24 hours ago. Chores can be logged at most a day late.",
      ],
      [
        { choreId: bathroom, occurredAt: at(-1).toISOString() },
        "OUT_OF_ORDER",
        "Bathroom was already logged after that time. Only log what happened since.",
      ],
      [{ choreId: photo }, "PHOTO_REQUIRED", "Dishes needs a photo as proof."],
      [
        { choreId: archived },
        "ARCHIVED_CHORE",
        "Old is archived. Ask an admin to restore it first.",
      ],
      [
        { choreId: later },
        "NO_RULE_VERSION",
        "Later has no points set for that time yet. Ask an admin to set them.",
      ],
      [
        { choreId: "00000000-0000-4000-8000-00000000beef" },
        "NOT_FOUND",
        "That chore was not found.",
      ],
      [
        { choreId: trash, doneBy: "00000000-0000-4000-8000-00000000dead" },
        "NOT_FOUND",
        "That person is not an active member of the household.",
      ],
    ];
    for (const [input, code, message] of cases) {
      await expect(
        runAction("log_completion", input, ctx()),
        code,
      ).resolves.toEqual({ ok: false, code, message });
    }

    // A season that is closed takes nothing more.
    await t
      .db()
      .insert(seasons)
      .values({
        householdId: HOUSEHOLD_ID,
        year: 2025,
        startsAt: new Date("2024-12-31T23:00:00Z"),
        endsAt: new Date("2025-12-31T23:00:00Z"),
        status: "closed",
      });
    const newYear = new Date("2026-01-01T00:30:00Z");
    await expect(
      runAction(
        "log_completion",
        {
          choreId: trash,
          occurredAt: new Date("2025-12-31T22:00:00Z").toISOString(),
        },
        ctx({ now: newYear }),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "SEASON_CLOSED",
      message: "That season is closed, so nothing more can be logged in it.",
    });
    await expect(tally()).resolves.toEqual(before);
  });

  it("a deactivated member cannot be named as the doer", async () => {
    await t
      .db()
      .update(members)
      .set({ deactivatedAt: FIXED_NOW })
      .where(eq(members.id, partner));
    await expect(
      runAction(
        "log_completion",
        { choreId: trash, doneBy: partner },
        ctxFor(sessionActor(ryan)),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("a request id that already made a completion for another chore is a conflict", async () => {
    const { choreId: dishes } = await seedChore(db(), SEED_CHORES.dishes);
    const requestId = "shared-request-id-1";
    ok(
      await runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(sessionActor(ryan), { requestId }),
      ),
    );
    // Another member's ledger has no such key, so the completions' unique
    // request id is what catches it.
    await expect(
      runAction(
        "log_completion",
        { choreId: dishes },
        ctxFor(sessionActor(partner), { requestId }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
  });

  it("a partner-mode self-claim is stored but not counted yet", async () => {
    const { choreId } = await seedChore(db(), {
      ...SEED_CHORES.bathroom,
      confirmMode: "partner",
    });
    await expect(
      runAction("log_completion", { choreId }, ctxFor(sessionActor(ryan))),
    ).resolves.toMatchObject({
      ok: true,
      data: {
        status: "pending",
        counted: false,
        totalPts: null,
        streakLen: null,
      },
    });
  });

  it("keeps a note", async () => {
    ok(
      await runAction(
        "log_completion",
        { choreId: trash, note: " took two bags " },
        ctxFor(sessionActor(ryan)),
      ),
    );
    const [row] = await t.db().select().from(completions);
    expect(row?.note).toBe("took two bags");
  });

  it("is offered on ai, mcp (with the write scope) and brain, each with its own source", async () => {
    const { choreId: a } = await seedChore(db(), {
      name: "A",
      basePoints: 5,
      cooldownMinutes: 0,
    });
    const { choreId: b } = await seedChore(db(), {
      name: "B",
      basePoints: 5,
      cooldownMinutes: 0,
    });
    const { choreId: c } = await seedChore(db(), {
      name: "C",
      basePoints: 5,
      cooldownMinutes: 0,
    });
    const cases: [Actor, RequestCtx["source"], string][] = [
      [sessionActor(ryan), "ai", a],
      [mcp(ryan), "mcp", b],
      [brain(ryan), "brain", c],
    ];
    for (const [actor, source, choreId] of cases) {
      const data = ok(
        await runAction(
          "log_completion",
          { choreId },
          ctxFor(actor, { source }),
        ),
      );
      const [row] = await t
        .db()
        .select({ source: completions.source })
        .from(completions)
        .where(eq(completions.id, data.completionId));
      expect(row?.source).toBe(source);
    }
    await expect(
      runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(mcp(ryan, ["baumy:read"]), { source: "mcp" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("refuses non-members and bad input", async () => {
    await expect(
      runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(accountActor("stranger")),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      runAction(
        "log_completion",
        { choreId: "trash" },
        ctxFor(sessionActor(ryan)),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ path: ["choreId"], message: "Pick a chore." }],
    });
    await expect(
      runAction(
        "log_completion",
        { choreId: trash, occurredAt: "yesterday" },
        ctxFor(sessionActor(ryan)),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("manage_chore", () => {
  let admin: string;
  const adminCtx = (over: Partial<RequestCtx> = {}) =>
    ctxFor(sessionActor(admin, "admin"), over);

  beforeEach(async () => {
    admin = await seedMember(db(), { role: "admin", displayName: "Admin" });
  });

  const windows = {
    op: "create",
    name: "Windows",
    basePoints: "40",
    cooldownHours: "84",
  };

  it("creates a chore from form strings, with defaults and a manual rule version", async () => {
    const data = ok(await runAction("manage_chore", windows, adminCtx()));
    expect(data).toEqual({
      choreId: expect.any(String),
      name: "Windows",
      archived: false,
      weightChanged: true,
    });
    const [chore] = await t
      .db()
      .select()
      .from(chores)
      .where(eq(chores.id, data.choreId));
    expect(chore).toMatchObject({
      sprite: "windows",
      kind: "maintenance",
      proofMode: "none",
      confirmMode: "optimistic",
      effortFactorPct: 100,
    });
    const [rule] = await t
      .db()
      .select()
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.choreId, data.choreId));
    expect(rule).toMatchObject({
      basePoints: 40,
      cooldownMinutes: 84 * 60,
      source: "manual",
      createdBy: admin,
      effectiveFrom: FIXED_NOW,
    });
    const [audit] = await t.db().select().from(auditEvents);
    expect(audit).toMatchObject({
      action: "manage_chore",
      entity: "chore",
      entityId: data.choreId,
    });
  });

  it("refuses a name another active chore has", async () => {
    await expect(
      runAction("manage_chore", { ...windows, name: "trash" }, adminCtx()),
    ).resolves.toEqual({
      ok: false,
      code: "CHORE_NAME_TAKEN",
      message: "There is already a chore called trash. Pick another name.",
    });
  });

  it("edits settings and weight; a new weight is a new rule version, the old scores stay", async () => {
    ok(
      await runAction(
        "log_completion",
        { choreId: trash },
        ctxFor(sessionActor(ryan)),
      ),
    );
    const update = {
      op: "update",
      choreId: trash,
      name: "Bins",
      basePoints: "30",
      cooldownHours: "1",
      proofMode: "optional",
      confirmMode: "optimistic",
      effortFactorPct: "120",
    };
    const data = ok(
      await runAction("manage_chore", update, adminCtx({ now: at(1) })),
    );
    expect(data).toEqual({
      choreId: trash,
      name: "Bins",
      archived: false,
      weightChanged: true,
    });
    const versions = await t
      .db()
      .select({
        source: choreRuleVersions.source,
        base: choreRuleVersions.basePoints,
      })
      .from(choreRuleVersions)
      .where(eq(choreRuleVersions.choreId, trash));
    expect(versions).toHaveLength(2);
    expect(versions).toContainEqual({ source: "manual", base: 30 });
    const [score] = await t.db().select().from(completionScores);
    expect(score?.totalPts).toBe(TRASH.basePoints);

    // The same values again change nothing about the weight.
    await expect(
      runAction("manage_chore", update, adminCtx({ now: at(2) })),
    ).resolves.toMatchObject({ ok: true, data: { weightChanged: false } });

    const { choreId: dishes } = await seedChore(db(), SEED_CHORES.dishes);
    await expect(
      runAction(
        "manage_chore",
        { ...update, choreId: dishes, name: "BINS" },
        adminCtx(),
      ),
    ).resolves.toMatchObject({ ok: false, code: "CHORE_NAME_TAKEN" });
  });

  it("sets a chore's kind on create and update, and keeps it when left out", async () => {
    const kindOf = async (id: string) =>
      (
        await t
          .db()
          .select({ kind: chores.kind })
          .from(chores)
          .where(eq(chores.id, id))
      )[0]!.kind;
    const created = ok(
      await runAction(
        "manage_chore",
        { ...windows, name: "Toilet paper", kind: "consumable" },
        adminCtx(),
      ),
    );
    expect(await kindOf(created.choreId)).toBe("consumable");

    const update = {
      op: "update",
      choreId: trash,
      name: "Trash",
      basePoints: String(TRASH.basePoints),
      cooldownHours: String(TRASH.cooldownMinutes / 60),
      proofMode: "none",
      confirmMode: "optimistic",
      effortFactorPct: "100",
    };
    expect(await kindOf(trash)).toBe("maintenance");
    ok(
      await runAction(
        "manage_chore",
        { ...update, kind: "consumable" },
        adminCtx(),
      ),
    );
    expect(await kindOf(trash)).toBe("consumable");
    ok(await runAction("manage_chore", update, adminCtx({ now: at(1) })));
    expect(await kindOf(trash)).toBe("consumable");

    await expect(
      runAction("manage_chore", { ...update, kind: "errand" }, adminCtx()),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ path: ["kind"], message: "Pick consumable or maintenance." }],
    });
  });

  it("sets a chore's icon on create and update, and keeps it when left out", async () => {
    const spriteOf = async (id: string) =>
      (
        await t
          .db()
          .select({ sprite: chores.sprite })
          .from(chores)
          .where(eq(chores.id, id))
      )[0]!.sprite;
    const created = ok(
      await runAction(
        "manage_chore",
        { ...windows, sprite: CHORE_ICONS[0] },
        adminCtx(),
      ),
    );
    expect(await spriteOf(created.choreId)).toBe(CHORE_ICONS[0]);

    const update = {
      op: "update",
      choreId: trash,
      name: "Trash",
      basePoints: String(TRASH.basePoints),
      cooldownHours: String(TRASH.cooldownMinutes / 60),
      proofMode: "none",
      confirmMode: "optimistic",
      effortFactorPct: "100",
    };
    const before = await spriteOf(trash);
    expect(before).toBeTruthy();
    expect(CHORE_ICONS).not.toContain(before);
    ok(await runAction("manage_chore", update, adminCtx()));
    expect(await spriteOf(trash)).toBe(before);
    ok(
      await runAction(
        "manage_chore",
        { ...update, sprite: CHORE_ICONS[3] },
        adminCtx({ now: at(1) }),
      ),
    );
    expect(await spriteOf(trash)).toBe(CHORE_ICONS[3]);

    await expect(
      runAction("manage_chore", { ...update, sprite: "rocket" }, adminCtx()),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ path: ["sprite"], message: "Pick one of the icons." }],
    });
  });

  it("keeps the weight when points and cooldown are both left out, and refuses one alone", async () => {
    const settingsOnly = {
      op: "update",
      choreId: trash,
      name: "Bins",
      proofMode: "none",
      confirmMode: "optimistic",
      effortFactorPct: "100",
    };
    const versions = () =>
      t
        .db()
        .select({
          base: choreRuleVersions.basePoints,
          cooldown: choreRuleVersions.cooldownMinutes,
        })
        .from(choreRuleVersions)
        .where(eq(choreRuleVersions.choreId, trash));
    expect(await versions()).toEqual([
      { base: TRASH.basePoints, cooldown: TRASH.cooldownMinutes },
    ]);
    await expect(
      runAction("manage_chore", settingsOnly, adminCtx({ now: at(1) })),
    ).resolves.toEqual({
      ok: true,
      data: {
        choreId: trash,
        name: "Bins",
        archived: false,
        weightChanged: false,
      },
    });
    expect(await versions()).toEqual([
      { base: TRASH.basePoints, cooldown: TRASH.cooldownMinutes },
    ]);

    for (const [half, field] of [
      [{ basePoints: "30" }, "basePoints"],
      [{ cooldownHours: "2" }, "cooldownHours"],
    ] as const) {
      await expect(
        runAction(
          "manage_chore",
          { ...settingsOnly, name: "Other", ...half },
          adminCtx({ now: at(2) }),
        ),
      ).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
        message:
          "Give the points and the cooldown together, or leave both out.",
        issues: [
          {
            path: [field === "basePoints" ? "cooldownHours" : "basePoints"],
            message:
              "Give the points and the cooldown together, or leave both out.",
          },
        ],
      });
    }
    // Refused, so nothing changed: the name is still Bins.
    const [row] = await t
      .db()
      .select({ name: chores.name })
      .from(chores)
      .where(eq(chores.id, trash));
    expect(row!.name).toBe("Bins");
    expect(await versions()).toHaveLength(1);
  });

  it("archives and restores, unless the name was taken meanwhile", async () => {
    await expect(
      runAction("manage_chore", { op: "archive", choreId: trash }, adminCtx()),
    ).resolves.toMatchObject({ ok: true, data: { archived: true } });
    await expect(
      runAction("manage_chore", { op: "restore", choreId: trash }, adminCtx()),
    ).resolves.toMatchObject({ ok: true, data: { archived: false } });
    // Restoring a chore that is not archived is a no-op success.
    await expect(
      runAction("manage_chore", { op: "restore", choreId: trash }, adminCtx()),
    ).resolves.toMatchObject({ ok: true, data: { archived: false } });

    ok(
      await runAction(
        "manage_chore",
        { op: "archive", choreId: trash },
        adminCtx(),
      ),
    );
    ok(
      await runAction(
        "manage_chore",
        { ...windows, name: "Trash" },
        adminCtx(),
      ),
    );
    await expect(
      runAction("manage_chore", { op: "restore", choreId: trash }, adminCtx()),
    ).resolves.toMatchObject({ ok: false, code: "CHORE_NAME_TAKEN" });
  });

  it("returns NOT_FOUND for another chore id", async () => {
    await expect(
      runAction(
        "manage_chore",
        { op: "archive", choreId: "00000000-0000-4000-8000-00000000beef" },
        adminCtx(),
      ),
    ).resolves.toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "That chore was not found.",
    });
  });

  it("validates the numbers and the op", async () => {
    for (const bad of [
      { ...windows, basePoints: "0" },
      { ...windows, basePoints: "12.5" },
      { ...windows, cooldownHours: "-1" },
      { ...windows, effortFactorPct: "400" },
      { ...windows, name: "  " },
      { op: "delete", choreId: trash },
    ]) {
      await expect(
        runAction("manage_chore", bad, adminCtx()),
      ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    }
  });

  it("is for an admin's own session, and only in the UI", async () => {
    await expect(
      runAction("manage_chore", windows, ctxFor(sessionActor(ryan))),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    for (const [actor, source] of [
      [kiosk(admin), "kiosk"],
      [sessionActor(admin, "admin"), "ai"],
      [mcp(admin), "mcp"],
      [brain(admin), "brain"],
    ] as [Actor, RequestCtx["source"]][]) {
      await expect(
        runAction("manage_chore", windows, ctxFor(actor, { source })),
      ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    }
    const [n] = await t.db().select({ n: count() }).from(chores);
    expect(n!.n).toBe(1);
  });
});

describe("spriteFor", () => {
  it("slugs the name, with a fallback", () => {
    expect(spriteFor("Fridge clean-out")).toBe("fridge-clean-out");
    expect(spriteFor("Dishwasher (unload)")).toBe("dishwasher-unload");
    expect(spriteFor("!!")).toBe("chore");
  });
});
