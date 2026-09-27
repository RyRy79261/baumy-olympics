import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { VerificationEvent } from "@baumy/core";
import { logCompletion } from "../completions";
import {
  applyCompletionEvent,
  attachCompletionPhoto,
  claimAbilities,
  findCompletionPhoto,
  listOpenClaims,
  listSettledClaims,
  loadForVerification,
} from "../confirmations";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { completionScores, completions, disputes } from "../schema";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";
import { useTestDb } from "./_harness";

// The honesty layer's write path (SPEC §4.3) on PGlite: each event through
// `applyCompletionEvent`, the dispute rows it keeps in step, the re-score,
// photos, and the open-claims read that judges status at `now`.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;

const NOW = new Date("2026-09-28T08:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const BATHROOM = SEED_CHORES.bathroom;
const TRASH = SEED_CHORES.trash;

let reqSeq = 0;

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

async function claim(
  choreId: string,
  doneBy: string,
  when: Date,
  extra: { loggedBy?: string; completionId?: string; photo?: string } = {},
) {
  reqSeq += 1;
  const r = await t.db().transaction((tx) =>
    logCompletion(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy,
      loggedBy: extra.loggedBy ?? doneBy,
      occurredAt: when,
      now: when,
      source: "ui",
      clientRequestId: `conf-${reqSeq}`,
      completionId: extra.completionId,
      photoPathname: extra.photo,
    }),
  );
  return ok(r).completion;
}

function apply(completionId: string, event: VerificationEvent, now: Date) {
  return t.db().transaction((tx) =>
    applyCompletionEvent(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      completionId,
      event,
      now,
    }),
  );
}

function attach(
  completionId: string,
  actorId: string,
  now: Date,
  pathname = `completions/${completionId}/p.webp`,
) {
  return t.db().transaction((tx) =>
    attachCompletionPhoto(tx as unknown as Queryable, {
      householdId: HOUSEHOLD_ID,
      completionId,
      actorId,
      pathname,
      now,
    }),
  );
}

async function scoreOf(completionId: string) {
  const [row] = await t
    .db()
    .select()
    .from(completionScores)
    .where(eq(completionScores.completionId, completionId));
  return row ?? null;
}

async function disputesOf(completionId: string) {
  return t
    .db()
    .select()
    .from(disputes)
    .where(eq(disputes.completionId, completionId))
    .orderBy(asc(disputes.createdAt));
}

async function stored(completionId: string) {
  const [row] = await t
    .db()
    .select()
    .from(completions)
    .where(eq(completions.id, completionId));
  return row!;
}

describe("applyCompletionEvent", () => {
  it("E9: a disputed Bathroom claim, a photo, a withdrawn dispute, a later finalize and a re-score", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const { choreId } = await seedChore(db(), BATHROOM);
    const c = await claim(choreId, ryan, NOW);
    expect((await scoreOf(c.id))!.totalPts).toBe(BATHROOM.basePoints);

    // Disputed: excluded from scoring.
    const disputed = ok(
      await apply(
        c.id,
        { type: "dispute", actor: partner, reason: "  Still dirty  " },
        at(2),
      ),
    );
    expect(disputed.completion.status).toBe("disputed");
    expect(disputed.previousStatus).toBe("pending");
    expect(await scoreOf(c.id)).toBeNull();
    const [open] = await disputesOf(c.id);
    expect(open).toMatchObject({
      raisedBy: partner,
      reason: "Still dirty",
      resolution: null,
      resolvedAt: null,
      createdAt: at(2),
    });

    // The doer attaches a photo inside the window.
    const photo = ok(await attach(c.id, ryan, at(3)));
    expect(photo.completion.photoAttachedAt).toEqual(at(3));

    // Withdrawn 23.5h in: back to pending, finalizing an hour later, since
    // that is after logged_at + 24h.
    const withdrawn = ok(
      await apply(c.id, { type: "withdraw", actor: partner }, at(23.5)),
    );
    expect(withdrawn.disputeResolution).toBe("withdrawn");
    expect(withdrawn.completion).toMatchObject({
      status: "pending",
      finalizesAt: at(24.5),
    });
    const [closed] = await disputesOf(c.id);
    expect(closed).toMatchObject({
      resolution: "withdrawn",
      resolvedAt: at(23.5),
    });
    // Re-scored: it counts again.
    expect((await scoreOf(c.id))!.totalPts).toBe(BATHROOM.basePoints);

    // Open until 24.5h, settled after.
    const openAt = (h: number) =>
      listOpenClaims(db(), { householdId: HOUSEHOLD_ID, now: at(h) });
    expect((await openAt(24.4)).map((o) => o.completionId)).toEqual([c.id]);
    await expect(openAt(24.5)).resolves.toEqual([]);
    const settled = await listSettledClaims(db(), {
      householdId: HOUSEHOLD_ID,
      memberId: ryan,
      since: at(-1),
      now: at(24.5),
      limit: 5,
    });
    expect(settled).toEqual([
      {
        completionId: c.id,
        choreName: BATHROOM.name,
        loggedAt: NOW,
        status: "finalized",
        voidReason: null,
        totalPts: BATHROOM.basePoints,
      },
    ]);
  });

  it("confirms a partner-mode claim, which scores it and records who verified", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), {
      ...TRASH,
      confirmMode: "partner",
    });
    const c = await claim(choreId, ryan, NOW);
    expect(await scoreOf(c.id)).toBeNull();
    const r = ok(await apply(c.id, { type: "confirm", actor: partner }, at(1)));
    expect(r.completion).toMatchObject({
      status: "confirmed",
      verifiedBy: partner,
      verifiedAt: at(1),
    });
    expect(r.disputeResolution).toBeNull();
    expect((await scoreOf(c.id))!.totalPts).toBe(TRASH.basePoints);
  });

  it("concede voids the claim and closes the dispute as conceded", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const c = await claim(choreId, ryan, NOW);
    ok(
      await apply(
        c.id,
        { type: "dispute", actor: partner, reason: "no" },
        at(1),
      ),
    );
    const r = ok(await apply(c.id, { type: "concede", actor: ryan }, at(2)));
    expect(r.completion).toMatchObject({
      status: "voided",
      voidReason: "conceded",
    });
    expect((await disputesOf(c.id))[0]).toMatchObject({
      resolution: "conceded",
    });
    expect(await scoreOf(c.id)).toBeNull();
  });

  it("undo inside 10 minutes voids it; after, and by anyone but the logger, it is refused", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const c = await claim(choreId, ryan, NOW);
    await expect(
      apply(c.id, { type: "undo", actor: partner }, at(0.1)),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    await expect(
      apply(
        c.id,
        { type: "undo", actor: ryan },
        new Date(NOW.getTime() + 10 * MIN + 1),
      ),
    ).resolves.toEqual({ ok: false, code: "WINDOW_CLOSED" });
    expect((await stored(c.id)).status).toBe("pending");
    const r = ok(
      await apply(
        c.id,
        { type: "undo", actor: ryan },
        new Date(NOW.getTime() + 10 * MIN),
      ),
    );
    expect(r.completion).toMatchObject({
      status: "voided",
      voidReason: "undone",
    });
    expect(await scoreOf(c.id)).toBeNull();
  });

  it("undo of a disputed claim closes the dispute as undone", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const c = await claim(choreId, ryan, NOW);
    ok(
      await apply(
        c.id,
        { type: "dispute", actor: partner, reason: "?" },
        at(0.05),
      ),
    );
    ok(await apply(c.id, { type: "undo", actor: ryan }, at(0.1)));
    expect((await disputesOf(c.id))[0]).toMatchObject({ resolution: "undone" });
  });

  it("an admin upholds or voids a dispute; the doer cannot rule on their own", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const admin = await seedPlayer(db(), "Admin");
    const { choreId } = await seedChore(db(), { ...TRASH, cooldownMinutes: 0 });
    const a = await claim(choreId, ryan, NOW);
    const b = await claim(choreId, ryan, at(1));
    for (const id of [a.id, b.id]) {
      ok(
        await apply(
          id,
          { type: "dispute", actor: partner, reason: "?" },
          at(2),
        ),
      );
    }
    await expect(
      apply(
        a.id,
        { type: "resolve", actor: ryan, actorIsAdmin: true, outcome: "uphold" },
        at(3),
      ),
    ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    const up = ok(
      await apply(
        a.id,
        {
          type: "resolve",
          actor: admin,
          actorIsAdmin: true,
          outcome: "uphold",
        },
        at(3),
      ),
    );
    expect(up.completion).toMatchObject({
      status: "confirmed",
      verifiedBy: admin,
    });
    expect((await disputesOf(a.id))[0]).toMatchObject({ resolution: "upheld" });
    const down = ok(
      await apply(
        b.id,
        { type: "resolve", actor: admin, actorIsAdmin: true, outcome: "void" },
        at(3),
      ),
    );
    expect(down.completion).toMatchObject({
      status: "voided",
      voidReason: "disputed",
    });
    expect((await disputesOf(b.id))[0]).toMatchObject({
      resolution: "overruled",
    });
  });

  it("refuses events the row's status at now does not allow, and unknown completions", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const c = await claim(choreId, ryan, NOW);
    await expect(
      apply(c.id, { type: "withdraw", actor: partner }, at(1)),
    ).resolves.toEqual({ ok: false, code: "INVALID_STATE" });
    await expect(
      apply(c.id, { type: "dispute", actor: partner, reason: "  " }, at(1)),
    ).resolves.toEqual({ ok: false, code: "REASON_REQUIRED" });
    // Finalized by time, never written: too late to dispute or confirm.
    await expect(
      apply(c.id, { type: "confirm", actor: partner }, at(24)),
    ).resolves.toEqual({ ok: false, code: "INVALID_STATE" });
    await expect(
      apply(
        "00000000-0000-4000-8000-00000000beef",
        { type: "confirm", actor: partner },
        at(1),
      ),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await disputesOf(c.id)).toEqual([]);
  });

  it("a photo-backed dispute is not voided by the disputer or by the window closing", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), BATHROOM);
    const c = await claim(choreId, ryan, NOW);
    ok(
      await apply(
        c.id,
        { type: "dispute", actor: partner, reason: "no" },
        at(1),
      ),
    );
    ok(await attach(c.id, ryan, at(2)));
    for (const type of ["concede", "undo"] as const) {
      await expect(
        apply(c.id, { type, actor: partner }, at(3)),
      ).resolves.toEqual({ ok: false, code: "FORBIDDEN" });
    }
    const open = await listOpenClaims(db(), {
      householdId: HOUSEHOLD_ID,
      now: at(30),
    });
    expect(open.map((o) => [o.completionId, o.status])).toEqual([
      [c.id, "disputed"],
    ]);
    expect((await stored(c.id)).status).toBe("disputed");
  });
});

describe("attachCompletionPhoto", () => {
  it("lets only the doer or logger attach, once, and not to a voided claim", async () => {
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const other = await seedPlayer(db());
    const { choreId } = await seedChore(db(), { ...TRASH, cooldownMinutes: 0 });
    // Logged by the partner for Ryan: both may attach.
    const c = await claim(choreId, ryan, NOW, { loggedBy: partner });
    await expect(attach(c.id, other, at(1))).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    const r = ok(await attach(c.id, partner, at(1)));
    expect(r.completion.photoPathname).toBe(`completions/${c.id}/p.webp`);
    await expect(attach(c.id, ryan, at(2))).resolves.toEqual({
      ok: false,
      code: "PHOTO_ALREADY_ATTACHED",
    });

    const d = await claim(choreId, ryan, at(1));
    ok(await apply(d.id, { type: "undo", actor: ryan }, at(1)));
    await expect(attach(d.id, ryan, at(1))).resolves.toEqual({
      ok: false,
      code: "INVALID_STATE",
    });
    await expect(
      attach("00000000-0000-4000-8000-00000000beef", ryan, at(1)),
    ).resolves.toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("a claim logged with a photo keeps the id the upload chose", async () => {
    const ryan = await seedPlayer(db());
    const { choreId } = await seedChore(db(), {
      ...TRASH,
      proofMode: "required",
    });
    const id = "11111111-1111-4111-8111-111111111111";
    const c = await claim(choreId, ryan, NOW, {
      completionId: id,
      photo: `completions/${id}/x.webp`,
    });
    expect(c).toMatchObject({ id, photoAttachedAt: NOW });
    await expect(findCompletionPhoto(db(), HOUSEHOLD_ID, id)).resolves.toBe(
      `completions/${id}/x.webp`,
    );
    await expect(
      findCompletionPhoto(db(), "00000000-0000-4000-8000-000000000000", id),
    ).resolves.toBeUndefined();
    const bare = await claim(
      choreId,
      ryan,
      new Date(NOW.getTime() + 49 * HOUR),
      {
        photo: `completions/${"2".repeat(8)}/y.webp`,
      },
    );
    await t
      .db()
      .update(completions)
      .set({ photoPathname: null })
      .where(eq(completions.id, bare.id));
    await expect(
      findCompletionPhoto(db(), HOUSEHOLD_ID, bare.id),
    ).resolves.toBeNull();
  });
});

describe("listOpenClaims and claimAbilities", () => {
  it("lists pending and disputed claims with names, windows and what each member may do", async () => {
    const ryan = await seedPlayer(db(), "Ryan");
    const partner = await seedPlayer(db(), "Partner");
    const optimistic = await seedChore(db(), TRASH);
    const partnerMode = await seedChore(db(), {
      ...SEED_CHORES.dishes,
      confirmMode: "partner",
    });
    const a = await claim(optimistic.choreId, ryan, NOW);
    const b = await claim(partnerMode.choreId, ryan, NOW);
    ok(
      await apply(
        a.id,
        { type: "dispute", actor: partner, reason: "hmm" },
        at(0.05),
      ),
    );

    const open = await listOpenClaims(db(), {
      householdId: HOUSEHOLD_ID,
      now: at(0.1),
    });
    expect(open.map((o) => o.completionId).sort()).toEqual([a.id, b.id].sort());
    const oa = open.find((o) => o.completionId === a.id)!;
    expect(oa).toMatchObject({
      choreName: TRASH.name,
      doneByName: "Ryan",
      loggedByName: "Ryan",
      status: "disputed",
      windowEndsAt: at(24),
      expiresAt: null,
      totalPts: null,
      dispute: { raisedBy: partner, raisedByName: "Partner", reason: "hmm" },
    });
    const ob = open.find((o) => o.completionId === b.id)!;
    expect(ob).toMatchObject({
      status: "pending",
      finalizesAt: null,
      expiresAt: at(72),
      dispute: null,
    });

    expect(claimAbilities(oa.row, false, ryan, false, at(0.1))).toEqual({
      confirm: false,
      dispute: false,
      withdraw: false,
      concede: true,
      undo: true,
      resolve: false,
      attachPhoto: true,
    });
    expect(claimAbilities(oa.row, false, partner, true, at(0.1))).toEqual({
      confirm: false,
      dispute: false,
      withdraw: true,
      concede: false,
      undo: false,
      resolve: true,
      attachPhoto: false,
    });
    expect(claimAbilities(ob.row, true, partner, false, at(1))).toEqual({
      confirm: true,
      dispute: true,
      withdraw: false,
      concede: false,
      undo: false,
      resolve: false,
      attachPhoto: false,
    });

    // The partner-mode claim expires at 72h; the unphotographed dispute is
    // void at 24h. Neither is open after, whatever is stored.
    await expect(
      listOpenClaims(db(), { householdId: HOUSEHOLD_ID, now: at(72) }),
    ).resolves.toEqual([]);
    const settled = await listSettledClaims(db(), {
      householdId: HOUSEHOLD_ID,
      memberId: ryan,
      since: at(-1),
      now: at(72),
      limit: 1,
    });
    expect(settled).toHaveLength(1);
    const all = await listSettledClaims(db(), {
      householdId: HOUSEHOLD_ID,
      memberId: ryan,
      since: at(-1),
      now: at(72),
      limit: 5,
    });
    expect(
      Object.fromEntries(all.map((s) => [s.completionId, s.voidReason])),
    ).toEqual({ [a.id]: "disputed", [b.id]: "unconfirmed" });
  });

  it("is empty with no claims, and loads a completion with its open dispute", async () => {
    await expect(
      listOpenClaims(db(), { householdId: HOUSEHOLD_ID, now: NOW }),
    ).resolves.toEqual([]);
    const ryan = await seedPlayer(db());
    const partner = await seedPlayer(db());
    const { choreId } = await seedChore(db(), TRASH);
    const c = await claim(choreId, ryan, NOW);
    ok(
      await apply(
        c.id,
        { type: "dispute", actor: partner, reason: "x" },
        at(1),
      ),
    );
    const loaded = (await loadForVerification(db(), HOUSEHOLD_ID, c.id))!;
    expect(loaded.row.disputedBy).toBe(partner);
    expect(loaded.dispute?.reason).toBe("x");
    expect(loaded.chore.name).toBe(TRASH.name);
  });
});
