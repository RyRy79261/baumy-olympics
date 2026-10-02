// @vitest-environment node
import { count, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashKioskPin } from "@baumy/auth/kiosk-pin";
import type { Queryable } from "@baumy/db";
import { SEED_CHORES, seedChore } from "@baumy/db/game-fixtures";
import {
  auditEvents,
  completionScores,
  completions,
  disputes,
} from "@baumy/db/schema";
import { useTestDb } from "@baumy/db/test-harness";
import {
  FIXED_NOW,
  ctxFor,
  seedMember,
  sessionActor,
} from "@/test-utils/actions";
import type { Actor } from "@/lib/auth";
import { __resetMemoryRateLimits } from "@/lib/rate-limit";
import { claimEventFailure } from "./confirmations";
import type { RequestCtx } from "./define";
import type { ActivityChoreView, GetActivityData } from "./get-activity";
import { REGISTRY, runAction } from "./registry";

// The honesty layer's actions (issue #15, SPEC §4.3) through the real
// runAction on PGlite: each event's success and error codes, the surfaces,
// the kiosk PIN, the admin-only ruling, photos that only the upload route can
// name, and what the activity log offers. There is no confirming (issue
// #150). E9 and E11 are here end to end.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (hours: number) => new Date(FIXED_NOW.getTime() + hours * HOUR);
const TRASH = SEED_CHORES.trash;
const BATHROOM = SEED_CHORES.bathroom;

const PIN = "4321";
let pinHash: string;
beforeAll(async () => {
  pinHash = await hashKioskPin(PIN);
});
beforeEach(() => {
  __resetMemoryRateLimits();
});

function kiosk(memberId: string): Actor {
  return { kind: "kiosk", deviceId: "dev-1", memberId, displayName: "K" };
}

function ok<T>(r: { ok: true; data: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.data;
}

let ryan: string;
let partner: string;
let admin: string;

beforeEach(async () => {
  ryan = await seedMember(db(), { displayName: "Ryan", kioskPinHash: pinHash });
  partner = await seedMember(db(), {
    displayName: "Partner",
    kioskPinHash: pinHash,
  });
  admin = await seedMember(db(), { displayName: "Admin", role: "admin" });
});

const me = (id: string, over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(id), over);
const adminCtx = (over: Partial<RequestCtx> = {}) =>
  ctxFor(sessionActor(admin, "admin"), over);

/** A self-claim by `who` at `when`, through log_completion. */
async function selfClaim(choreId: string, who: string, when = FIXED_NOW) {
  return ok(
    await runAction("log_completion", { choreId }, me(who, { now: when })),
  ).completionId;
}

async function stored(id: string) {
  const [row] = await t
    .db()
    .select()
    .from(completions)
    .where(eq(completions.id, id));
  return row!;
}

async function score(id: string) {
  const [row] = await t
    .db()
    .select()
    .from(completionScores)
    .where(eq(completionScores.completionId, id));
  return row?.totalPts ?? null;
}

/** The claim's entry in the activity log, as `ctx`'s member reads it. */
async function entryOf(id: string, ctx: RequestCtx) {
  const data: GetActivityData = ok(await runAction("get_activity", {}, ctx));
  return data.entries.find(
    (e): e is ActivityChoreView => e.kind === "chore" && e.completionId === id,
  )!;
}

async function audits(action: string) {
  const [row] = await t
    .db()
    .select({ n: count() })
    .from(auditEvents)
    .where(eq(auditEvents.action, action));
  return row!.n;
}

describe("E9: dispute, photo, withdraw, finalize", () => {
  it("excludes the claim while disputed, keeps it past the window with a photo, and re-scores it on withdraw", async () => {
    const { choreId } = await seedChore(db(), BATHROOM);
    const id = await selfClaim(choreId, ryan);
    expect(await score(id)).toBe(BATHROOM.basePoints);

    const disputed = ok(
      await runAction(
        "dispute_completion",
        { completionId: id, reason: "The tub is still grey" },
        me(partner, { now: at(1) }),
      ),
    );
    expect(disputed).toMatchObject({ status: "disputed" });
    expect(await score(id)).toBeNull();
    expect(await audits("dispute_completion")).toBe(1);

    // Ryan attaches a photo inside the window (the upload route sets
    // ctx.photo after storing the file).
    const pathname = `completions/${id}/abcdefgh12.webp`;
    const photo = ok(
      await runAction(
        "attach_completion_photo",
        { completionId: id },
        me(ryan, { now: at(2), photo: { completionId: id, pathname } }),
      ),
    );
    expect(photo.photoUrl).toBe(
      `/api/blob?pathname=${encodeURIComponent(pathname)}`,
    );

    // Past the window, the photo keeps it disputed; the activity log says so.
    const entry = await entryOf(id, me(partner, { now: at(30) }));
    expect(entry).toMatchObject({
      completionId: id,
      status: "disputed",
      photoUrl: photo.photoUrl,
      dispute: {
        raisedBy: { memberId: partner, displayName: "Partner" },
        reason: "The tub is still grey",
      },
      can: { withdraw: true, dispute: false, concede: false },
    });
    expect(JSON.stringify(entry)).not.toMatch(/blob\.vercel-storage|https?:/);

    // Withdrawn at 30h: pending again, finalizing an hour later, re-scored.
    const back = ok(
      await runAction(
        "withdraw_dispute",
        { completionId: id },
        me(partner, { now: at(30) }),
      ),
    );
    expect(back).toMatchObject({
      status: "pending",
      disputeResolution: "withdrawn",
      finalizesAt: at(31).toISOString(),
    });
    expect(await score(id)).toBe(BATHROOM.basePoints);

    expect(await entryOf(id, me(ryan, { now: at(31) }))).toMatchObject({
      status: "finalized",
      totalPts: BATHROOM.basePoints,
    });
  });
});

describe("E11: a disputed claim still blocks the cooldown", () => {
  it("answers COOLDOWN to the partner who disputed Trash and tries it two hours later", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const monday = new Date("2026-09-28T06:00:00Z"); // Mon 08:00 Berlin
    const id = await selfClaim(choreId, ryan, monday);
    ok(
      await runAction(
        "dispute_completion",
        { completionId: id, reason: "Bin is full" },
        me(partner, { now: new Date(monday.getTime() + HOUR) }),
      ),
    );
    const tenAm = new Date(monday.getTime() + 2 * HOUR);
    await expect(
      runAction("log_completion", { choreId }, me(partner, { now: tenAm })),
    ).resolves.toMatchObject({
      ok: false,
      code: "COOLDOWN",
      retryAt: new Date(monday.getTime() + 48 * HOUR).toISOString(),
    });
  });
});

describe("no confirming (issue #150)", () => {
  it("has no confirm_completion on any surface: a self-claim counts at once", async () => {
    expect(REGISTRY).toHaveProperty("dispute_completion");
    expect(REGISTRY).not.toHaveProperty("confirm_completion");
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    expect(await stored(id)).toMatchObject({
      status: "pending",
      finalizesAt: at(24),
    });
    expect(await score(id)).toBe(TRASH.basePoints);
  });
});

describe("the kiosk and the other surfaces", () => {
  it("on the kiosk undoes as the acting member with no PIN, even one who never set a PIN (issue #145)", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    // Admin has no PIN at all.
    const id = await selfClaim(choreId, admin);
    const ctx = ctxFor(kiosk(admin), { source: "kiosk" });
    ok(await runAction("undo_completion", { completionId: id }, ctx));
    expect(await stored(id)).toMatchObject({
      status: "voided",
      voidReason: "undone",
    });
    expect(await audits("undo_completion")).toBe(1);
  });

  it("on the kiosk needs the disputing member's PIN in the request (issue #145)", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    const dispute = { completionId: id, reason: "Still full" };
    const ctx = ctxFor(kiosk(partner), { source: "kiosk" });
    await expect(
      runAction("dispute_completion", dispute, ctx),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
    await expect(
      runAction("dispute_completion", dispute, { ...ctx, pin: "0000" }),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_FAILED" });
    expect((await stored(id)).status).toBe("pending");
    ok(await runAction("dispute_completion", dispute, { ...ctx, pin: PIN }));
    expect((await stored(id)).status).toBe("disputed");
  });

  it("still refuses a dispute from a member with no PIN on the kiosk, PIN or not (issue #145)", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    const dispute = { completionId: id, reason: "Still full" };
    const ctx = ctxFor(kiosk(admin), { source: "kiosk" });
    await expect(
      runAction("dispute_completion", dispute, ctx),
    ).resolves.toMatchObject({ ok: false, code: "ATTESTATION_REQUIRED" });
    await expect(
      runAction("dispute_completion", dispute, { ...ctx, pin: PIN }),
    ).resolves.toMatchObject({
      ok: false,
      code: "PIN_NOT_SET",
      message: expect.stringContaining("haven't set a personal PIN"),
    });
    expect((await stored(id)).status).toBe("pending");
    expect(await audits("dispute_completion")).toBe(0);
  });

  it("disputes on every other surface, and MCP needs the write scope", async () => {
    const { choreId } = await seedChore(db(), { ...TRASH, cooldownMinutes: 0 });
    const cases: [Actor, RequestCtx["source"]][] = [
      [sessionActor(partner), "ai"],
      [
        { kind: "service", tokenName: "baumy-brain", memberId: partner },
        "brain",
      ],
      [{ kind: "mcp", memberId: partner, scopes: ["baumy:write"] }, "mcp"],
    ];
    for (const [i, [actor, source]] of cases.entries()) {
      const id = await selfClaim(choreId, ryan, at(i));
      await expect(
        runAction(
          "dispute_completion",
          { completionId: id, reason: "not done" },
          ctxFor(actor, { source, now: at(i) }),
        ),
      ).resolves.toMatchObject({ ok: true, data: { status: "disputed" } });
    }
    const id = await selfClaim(choreId, ryan, at(5));
    await expect(
      runAction(
        "dispute_completion",
        { completionId: id, reason: "not done" },
        ctxFor(
          { kind: "mcp", memberId: partner, scopes: ["baumy:read"] },
          { source: "mcp", now: at(5) },
        ),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("dispute_completion", () => {
  it("needs a reason, is refused to the doer and to unknown claims, and closes after 24h", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    const blank = await runAction(
      "dispute_completion",
      { completionId: id, reason: "   " },
      me(partner),
    );
    expect(blank).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      issues: [{ path: ["reason"], message: "Say why you are disputing it." }],
    });
    await expect(
      runAction(
        "dispute_completion",
        { completionId: id, reason: "mine" },
        me(ryan),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      runAction(
        "dispute_completion",
        { completionId: "00000000-0000-4000-8000-00000000beef", reason: "x" },
        me(partner),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
    // 24h after logging the claim has settled: too late to dispute.
    await expect(
      runAction(
        "dispute_completion",
        { completionId: id, reason: "late" },
        me(partner, { now: at(24) }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      message:
        "This claim can't be disputed any more: it is settled or already disputed.",
    });
    expect(await audits("dispute_completion")).toBe(0);
    const [n] = await t.db().select({ n: count() }).from(disputes);
    expect(n!.n).toBe(0);
  });
});

describe("undo_completion", () => {
  it("lets the logger undo within 10 minutes, and refuses after and to anyone else", async () => {
    const { choreId } = await seedChore(db(), { ...TRASH, cooldownMinutes: 0 });
    const id = await selfClaim(choreId, ryan);
    await expect(
      runAction(
        "undo_completion",
        { completionId: id },
        me(partner, { now: at(0.05) }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      message: "Only the person who logged it can undo it.",
    });
    await expect(
      runAction(
        "undo_completion",
        { completionId: id },
        me(ryan, { now: new Date(FIXED_NOW.getTime() + 10 * MIN + 1000) }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "WINDOW_CLOSED" });
    expect((await stored(id)).status).toBe("pending");

    const data = ok(
      await runAction(
        "undo_completion",
        { completionId: id },
        me(ryan, { now: new Date(FIXED_NOW.getTime() + 10 * MIN) }),
      ),
    );
    expect(data.status).toBe("voided");
    expect(await stored(id)).toMatchObject({ voidReason: "undone" });
    expect(await score(id)).toBeNull();
    // Voided: nothing left to undo.
    await expect(
      runAction("undo_completion", { completionId: id }, me(ryan)),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });

  it("a claim logged for someone else is verified at once, so there is nothing to undo", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const data = ok(
      await runAction("log_completion", { choreId, doneBy: partner }, me(ryan)),
    );
    await expect(
      runAction(
        "undo_completion",
        { completionId: data.completionId },
        me(ryan),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});

describe("withdraw, concede and a photo-backed dispute", () => {
  async function disputedClaim(photo: boolean) {
    const { choreId } = await seedChore(db(), BATHROOM);
    const id = await selfClaim(choreId, ryan);
    ok(
      await runAction(
        "dispute_completion",
        { completionId: id, reason: "not done" },
        me(partner, { now: at(1) }),
      ),
    );
    if (photo) {
      ok(
        await runAction(
          "attach_completion_photo",
          { completionId: id },
          me(ryan, {
            now: at(2),
            photo: {
              completionId: id,
              pathname: `completions/${id}/photo1234.webp`,
            },
          }),
        ),
      );
    }
    return id;
  }

  it("the disputer alone cannot void a photo-backed claim: not by conceding, undoing or waiting", async () => {
    const id = await disputedClaim(true);
    for (const name of ["concede_completion", "undo_completion"] as const) {
      await expect(
        runAction(name, { completionId: id }, me(partner, { now: at(3) })),
      ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await entryOf(id, me(partner, { now: at(48) }))).status).toBe(
      "disputed",
    );
    // An unphotographed one, by contrast, is void once the window ends.
    const bare = await disputedClaim(false);
    expect(await entryOf(bare, me(ryan, { now: at(48) }))).toMatchObject({
      status: "voided",
      voidReason: "disputed",
    });
  });

  it("withdraw is for the disputer; concede is for the doer and voids it", async () => {
    const id = await disputedClaim(false);
    await expect(
      runAction(
        "withdraw_dispute",
        { completionId: id },
        me(ryan, { now: at(2) }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      message: "Only the person who disputed it can withdraw the dispute.",
    });
    const data = ok(
      await runAction(
        "concede_completion",
        { completionId: id },
        me(ryan, { now: at(2) }),
      ),
    );
    expect(data).toMatchObject({
      status: "voided",
      disputeResolution: "conceded",
    });
    await expect(
      runAction(
        "withdraw_dispute",
        { completionId: id },
        me(partner, { now: at(3) }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});

describe("resolve_dispute", () => {
  it("is admin-only, UI-only, never on the admin's own claim, and upholds or voids", async () => {
    const { choreId } = await seedChore(db(), {
      ...BATHROOM,
      cooldownMinutes: 0,
    });
    const a = await selfClaim(choreId, ryan);
    const b = await selfClaim(choreId, admin, at(0.5));
    for (const id of [a, b]) {
      ok(
        await runAction(
          "dispute_completion",
          { completionId: id, reason: "hmm" },
          me(id === a ? partner : ryan, { now: at(1) }),
        ),
      );
    }
    await expect(
      runAction(
        "resolve_dispute",
        { completionId: a, outcome: "uphold" },
        me(partner, { now: at(2) }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    await expect(
      runAction(
        "resolve_dispute",
        { completionId: a, outcome: "uphold" },
        adminCtx({ source: "ai", now: at(2) }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    await expect(
      runAction(
        "resolve_dispute",
        { completionId: b, outcome: "uphold" },
        adminCtx({ now: at(2) }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "FORBIDDEN",
      message: "Admins can't rule on their own claim. Ask another admin.",
    });

    expect((await entryOf(a, adminCtx({ now: at(2) }))).can.resolve).toBe(true);

    const upheld = ok(
      await runAction(
        "resolve_dispute",
        { completionId: a, outcome: "uphold" },
        adminCtx({ now: at(2) }),
      ),
    );
    expect(upheld).toMatchObject({
      status: "confirmed",
      disputeResolution: "upheld",
    });
    expect(await score(a)).toBe(BATHROOM.basePoints);
  });

  it("void rules the claim out", async () => {
    const { choreId } = await seedChore(db(), BATHROOM);
    const a = await selfClaim(choreId, ryan);
    ok(
      await runAction(
        "dispute_completion",
        { completionId: a, reason: "no" },
        me(partner, { now: at(1) }),
      ),
    );
    const voided = ok(
      await runAction(
        "resolve_dispute",
        { completionId: a, outcome: "void" },
        adminCtx({ now: at(2) }),
      ),
    );
    expect(voided).toMatchObject({
      status: "voided",
      disputeResolution: "overruled",
    });
  });
});

describe("attach_completion_photo", () => {
  it("needs a photo from the upload route, for this very claim", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    await expect(
      runAction("attach_completion_photo", { completionId: id }, me(ryan)),
    ).resolves.toMatchObject({ ok: false, code: "PHOTO_MISSING" });
    const other = "11111111-1111-4111-8111-111111111111";
    await expect(
      runAction(
        "attach_completion_photo",
        { completionId: id },
        me(ryan, {
          photo: {
            completionId: other,
            pathname: `completions/${other}/abcdefgh.webp`,
          },
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "PHOTO_MISSING" });
    // The route stored it for another claim, even under this claim's folder.
    await expect(
      runAction(
        "attach_completion_photo",
        { completionId: id },
        me(ryan, {
          photo: {
            completionId: other,
            pathname: `completions/${id}/abcdefgh.webp`,
          },
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "PHOTO_MISSING" });
    await expect(
      runAction(
        "attach_completion_photo",
        { completionId: id },
        me(ryan, {
          photo: { completionId: id, pathname: `completions/${id}/../x.webp` },
        }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "PHOTO_MISSING" });
  });

  it("is refused to other members, twice, to a voided claim and to unknown claims", async () => {
    const { choreId } = await seedChore(db(), { ...TRASH, cooldownMinutes: 0 });
    const id = await selfClaim(choreId, ryan);
    const photo = (cid: string) => ({
      completionId: cid,
      pathname: `completions/${cid}/abcdefgh.webp`,
    });
    await expect(
      runAction(
        "attach_completion_photo",
        { completionId: id },
        me(partner, { photo: photo(id) }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "FORBIDDEN" });
    ok(
      await runAction(
        "attach_completion_photo",
        { completionId: id },
        me(ryan, { photo: photo(id) }),
      ),
    );
    await expect(
      runAction(
        "attach_completion_photo",
        { completionId: id },
        me(ryan, { photo: photo(id) }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "PHOTO_ALREADY_ATTACHED" });

    const undone = await selfClaim(choreId, ryan, at(0.1));
    ok(
      await runAction(
        "undo_completion",
        { completionId: undone },
        me(ryan, { now: at(0.1) }),
      ),
    );
    await expect(
      runAction(
        "attach_completion_photo",
        { completionId: undone },
        me(ryan, { now: at(0.1), photo: photo(undone) }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "INVALID_STATE" });
    const ghost = "22222222-2222-4222-8222-222222222222";
    await expect(
      runAction(
        "attach_completion_photo",
        { completionId: ghost },
        me(ryan, { photo: photo(ghost) }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("is offered on the UI and the kiosk only", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    await expect(
      runAction(
        "attach_completion_photo",
        { completionId: id },
        me(ryan, { source: "ai" }),
      ),
    ).resolves.toMatchObject({ ok: false, code: "SURFACE_FORBIDDEN" });
    ok(
      await runAction(
        "attach_completion_photo",
        { completionId: id },
        ctxFor(kiosk(ryan), {
          source: "kiosk",
          photo: {
            completionId: id,
            pathname: `completions/${id}/abcdefgh.webp`,
          },
        }),
      ),
    );
  });
});

describe("log_completion with proof", () => {
  it("proof_mode=required refuses a log without a photo, and takes one with it", async () => {
    const { choreId } = await seedChore(db(), {
      ...TRASH,
      proofMode: "required",
    });
    await expect(
      runAction("log_completion", { choreId }, me(ryan)),
    ).resolves.toMatchObject({
      ok: false,
      code: "PHOTO_REQUIRED",
      message: "Trash needs a photo as proof.",
    });
    const cid = "33333333-3333-4333-8333-333333333333";
    const data = ok(
      await runAction(
        "log_completion",
        { choreId },
        me(ryan, {
          photo: {
            completionId: cid,
            pathname: `completions/${cid}/abcdefgh.webp`,
          },
        }),
      ),
    );
    expect(data).toMatchObject({ completionId: cid, hasPhoto: true });
    expect(await stored(cid)).toMatchObject({
      photoPathname: `completions/${cid}/abcdefgh.webp`,
      photoAttachedAt: FIXED_NOW,
    });
  });
});

describe("previews", () => {
  it("say what the event does to whose claim", async () => {
    const { choreId } = await seedChore(db(), TRASH);
    const id = await selfClaim(choreId, ryan);
    const ctx = { ...me(partner), db: db() };
    const line = (name: keyof typeof REGISTRY, input: object) => {
      const def = REGISTRY[name];
      return def.preview!(ctx, def.input.parse(input) as never);
    };
    await expect(line("undo_completion", { completionId: id })).resolves.toBe(
      "Undo Ryan's Trash",
    );
    await expect(
      line("dispute_completion", { completionId: id, reason: "no" }),
    ).resolves.toBe(`Dispute Ryan's Trash: "no"`);
    await expect(
      line("resolve_dispute", { completionId: id, outcome: "void" }),
    ).resolves.toBe("Void Ryan's Trash");
    await expect(
      line("resolve_dispute", { completionId: id, outcome: "uphold" }),
    ).resolves.toBe("Uphold Ryan's Trash");
    const ghost = "44444444-4444-4444-8444-444444444444";
    for (const [name, input] of [
      ["undo_completion", { completionId: ghost }],
      ["dispute_completion", { completionId: ghost, reason: "x" }],
      ["resolve_dispute", { completionId: ghost, outcome: "void" }],
    ] as const) {
      await expect(line(name, input)).resolves.toBe(
        "That claim was not found.",
      );
    }
  });
});

describe("claimEventFailure", () => {
  it("has a sentence for a lost race and a blank reason", () => {
    expect(claimEventFailure("undo", { ok: false, code: "STALE" })).toEqual({
      ok: false,
      code: "INVALID_STATE",
      message: "Someone else just changed this claim. Refresh and look again.",
    });
    expect(
      claimEventFailure("dispute", { ok: false, code: "REASON_REQUIRED" }),
    ).toMatchObject({ code: "REASON_REQUIRED" });
    expect(
      claimEventFailure("undo", { ok: false, code: "WINDOW_CLOSED" }).message,
    ).toContain("10 minutes");
    expect(
      claimEventFailure("dispute", { ok: false, code: "WINDOW_CLOSED" })
        .message,
    ).toBe("The 24-hour window to dispute this claim has closed.");
  });
});
