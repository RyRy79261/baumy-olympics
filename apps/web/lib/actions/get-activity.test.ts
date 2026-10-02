// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  accountActor,
  ctxFor,
  kioskActor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import type { RequestCtx } from "./define";
import type {
  ActivityChoreView,
  ActivityPointsView,
  GetActivityData,
} from "./get-activity";
import { runAction } from "./registry";

// The activity log's read (issue #150) through the real runAction on PGlite:
// what it lists, what each member may do to each entry on each surface, the
// kitchen screen with nobody picked, and its input.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const HOUR = 60 * 60_000;
const at = (hours: number) => new Date(FIXED_NOW.getTime() + hours * HOUR);
const TRASH = SEED_CHORES.trash;

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

let ryan: string;
let sam: string;
let admin: string;

beforeEach(async () => {
  __resetMemoryRateLimits();
  ryan = await seedMember(db(), { displayName: "Ryan" });
  sam = await seedMember(db(), { displayName: "Sam" });
  admin = await seedMember(db(), { displayName: "Admin", role: "admin" });
});

const me = (id: string, over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(id), over);
const asAdmin = (over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(admin, "admin"), over);

async function read(ctx: RequestCtx): Promise<GetActivityData> {
  return ok(await runAction("get_activity", {}, ctx));
}

function chore(data: GetActivityData, id: string): ActivityChoreView {
  return data.entries.find(
    (e): e is ActivityChoreView => e.kind === "chore" && e.completionId === id,
  )!;
}

function scheduled(data: GetActivityData): ActivityPointsView {
  return data.entries.find(
    (e): e is ActivityPointsView =>
      e.kind === "points" && e.event === "scheduled",
  )!;
}

async function selfClaim(choreId: string, who: string, when = FIXED_NOW) {
  return ok(
    await runAction("log_completion", { choreId }, me(who, { now: when })),
  ).completionId;
}

describe("get_activity", () => {
  it("is empty for a quiet house, and says how far back it reads", async () => {
    await expect(read(me(ryan))).resolves.toEqual({ entries: [], days: 30 });
  });

  it("lists what happened, newest first, with what each member may do", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    ok(
      await runAction(
        "create_bounty",
        { name: "Windows", kind: "maintenance", points: 30 },
        asAdmin({ now: at(-1) }),
      ),
    );
    const id = await selfClaim(choreId, ryan, at(0));

    const mine = await read(me(ryan, { now: at(0.1) }));
    expect(mine.entries.map((e) => `${e.kind} ${e.choreName}`)).toEqual([
      "chore Trash",
      "bounty Windows",
    ]);
    expect(mine.entries[1]).toMatchObject({
      kind: "bounty",
      change: "added",
      by: { memberId: admin, displayName: "Admin" },
      at: at(-1).toISOString(),
    });
    expect(chore(mine, id)).toMatchObject({
      doneBy: { memberId: ryan, displayName: "Ryan" },
      status: "pending",
      windowEndsAt: at(24).toISOString(),
      totalPts: TRASH.basePoints,
      photoUrl: null,
      can: {
        dispute: false,
        undo: true,
        attachPhoto: true,
        withdraw: false,
        concede: false,
        resolve: false,
      },
    });
    // A housemate may dispute it while its window is open, and not after.
    expect(chore(await read(me(sam, { now: at(0.1) })), id).can).toEqual({
      dispute: true,
      undo: false,
      attachPhoto: false,
      withdraw: false,
      concede: false,
      resolve: false,
    });
    expect(chore(await read(me(sam, { now: at(24) })), id).can.dispute).toBe(
      false,
    );
  });

  it("offers the admin's ruling only in a real session in the UI", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    ok(
      await runAction(
        "dispute_completion",
        { completionId: id, reason: "no" },
        me(sam, { now: at(1) }),
      ),
    );
    const resolve = async (ctx: RequestCtx) =>
      chore(await read(ctx), id).can.resolve;
    expect(await resolve(asAdmin({ now: at(2) }))).toBe(true);
    expect(await resolve(asAdmin({ source: "ai", now: at(2) }))).toBe(false);
    expect(await resolve(me(sam, { now: at(2) }))).toBe(false);
    expect(
      await resolve(ctxFor(kioskActor(admin), { source: "kiosk", now: at(2) })),
    ).toBe(false);
  });

  it("offers a veto to the others, where veto_weight is offered, until it applies", async () => {
    const { choreId } = await seedChore(db(), SEED_CHORES.bathroom);
    const change = ok(
      await runAction(
        "schedule_points_change",
        { choreId, basePoints: 50, cooldownHours: 48, reason: "Takes ages" },
        asAdmin(),
      ),
    );
    const entry = scheduled(await read(me(sam)));
    expect(entry).toMatchObject({
      suggestionId: change.suggestionId,
      by: { memberId: admin, displayName: "Admin" },
      toPoints: 50,
      reason: "Takes ages",
      appliesAt: change.appliesAt,
      canVeto: true,
    });
    // Not to the admin who scheduled it, not on the kiosk (no veto_weight
    // there), and not once it has applied.
    expect(scheduled(await read(asAdmin())).canVeto).toBe(false);
    expect(
      scheduled(await read(ctxFor(kioskActor(sam), { source: "kiosk" })))
        .canVeto,
    ).toBe(false);
    const landed = await read(me(sam, { now: new Date(change.appliesAt!) }));
    expect(scheduled(landed).canVeto).toBe(false);
    expect(landed.entries[0]).toMatchObject({
      kind: "points",
      event: "applied",
    });
  });

  it("reads on every surface, and on the kitchen screen with nobody picked, without buttons", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    const cases: [Actor, RequestCtx["source"]][] = [
      [sessionActor(sam), "ui"],
      [sessionActor(sam), "ai"],
      [kioskActor(sam), "kiosk"],
      [{ kind: "service", tokenName: "baumy-brain", memberId: sam }, "brain"],
      [{ kind: "mcp", memberId: sam, scopes: ["baumy:read"] }, "mcp"],
    ];
    for (const [actor, source] of cases) {
      const data = await read(ctxFor(actor, { source }));
      expect(chore(data, id).can.dispute).toBe(true);
    }
    const idle = await read(ctxFor(kioskActor(), { source: "kiosk" }));
    expect(chore(idle, id)).toMatchObject({
      status: "pending",
      can: {
        dispute: false,
        undo: false,
        attachPhoto: false,
        withdraw: false,
        concede: false,
        resolve: false,
      },
    });
  });

  it("refuses an account that has not joined, and a bad limit", async () => {
    await expect(
      runAction("get_activity", {}, ctxFor(accountActor("stranger"))),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      runAction("get_activity", { limit: 0 }, me(ryan)),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_INPUT" });
    const { choreId } = await seedChore(db(), { ...TRASH, cooldownMinutes: 0 });
    await selfClaim(choreId, ryan, at(0));
    await selfClaim(choreId, ryan, at(1));
    const one = ok(
      await runAction("get_activity", { limit: 1 }, me(ryan, { now: at(2) })),
    );
    expect(one.entries.map((e) => e.at)).toEqual([at(1).toISOString()]);
  });
});
