import {
  berlinWallTimeToUtc,
  PHOTO_RETENTION_DAYS,
  RULESET_V1,
  seasonBounds,
  type VerificationEvent,
} from "@baumy/core";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { logCompletion } from "../completions";
import { applyCompletionEvent, listOpenClaims } from "../confirmations";
import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { completionScores, completions, disputes, seasons } from "../schema";
import {
  approveAdjustment,
  createAdjustment,
  listSeasonScores,
} from "../scores";
import { ensureSeason, findSeason, seasonStatusNow } from "../seasons";
import {
  clearPrunedPhoto,
  closeDueSeasons,
  listPhotosToPrune,
  settleDueCompletions,
} from "../sweep";
import { SEED_CHORES, seedChore, seedPlayer } from "./_game-fixtures";
import { useTestDb } from "./_harness";

// The daily job's steps (SPEC §6.7) on PGlite: each persists what reads
// already derive, a second run is a no-op, and the stored scores are the same
// whether or not a step ran.

const t = useTestDb();
const db = () => t.db() as unknown as Queryable;
const tx = <T>(fn: (q: Queryable) => Promise<T>) =>
  t.db().transaction((x) => fn(x as unknown as Queryable));

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const WINDOW = RULESET_V1.challengeWindowH * HOUR;
const EXPIRY = RULESET_V1.partnerConfirmExpiryH * HOUR;
const BACKDATE = RULESET_V1.maxBackdateH * HOUR;
const RETAIN = PHOTO_RETENTION_DAYS * DAY;
/** Mon 28 Dec 2026, 08:00 Berlin: the season's last week. */
const T0 = berlinWallTimeToUtc(2026, 12, 28, 8);
const at = (ms: number) => new Date(T0.getTime() + ms);
const { endsAt } = seasonBounds(2026);

let reqSeq = 0;

async function claim(
  choreId: string,
  doneBy: string,
  when: Date,
  photoPathname: string | null = null,
) {
  reqSeq += 1;
  const r = await tx((q) =>
    logCompletion(q, {
      householdId: HOUSEHOLD_ID,
      choreId,
      doneBy,
      loggedBy: doneBy,
      occurredAt: when,
      now: when,
      source: "ui",
      clientRequestId: `sweep-${reqSeq}`,
      photoPathname,
    }),
  );
  if (!r.ok) throw new Error(`log failed: ${r.code}`);
  return r.completion;
}

async function event(completionId: string, e: VerificationEvent, now: Date) {
  const r = await tx((q) =>
    applyCompletionEvent(q, {
      householdId: HOUSEHOLD_ID,
      completionId,
      event: e,
      now,
    }),
  );
  if (!r.ok) throw new Error(`${e.type} failed: ${r.code}`);
}

const dispute = (actor: string): VerificationEvent => ({
  type: "dispute",
  actor,
  reason: "not done",
});

/**
 * Four claims on Mon 28 Dec: an optimistic one (finalizes after 24h), a
 * partner-mode one nobody confirms (voided after 72h), a disputed one with no
 * photo (times out after 24h) and a disputed one with a photo in time (open
 * until someone rules).
 */
async function arrange() {
  const ryan = await seedPlayer(db(), "Ryan");
  const partner = await seedPlayer(db(), "Partner");
  const trash = await seedChore(db(), SEED_CHORES.trash);
  const dishes = await seedChore(db(), SEED_CHORES.dishes);
  const bathroom = await seedChore(db(), SEED_CHORES.bathroom);
  const mop = await seedChore(db(), {
    name: "Mop",
    basePoints: 37,
    cooldownMinutes: 0,
    confirmMode: "partner",
  });
  const optimistic = await claim(trash.choreId, ryan, T0);
  const unconfirmed = await claim(mop.choreId, partner, T0);
  const noPhoto = await claim(dishes.choreId, ryan, T0);
  await event(noPhoto.id, dispute(partner), at(HOUR));
  const withPhoto = await claim(
    bathroom.choreId,
    partner,
    T0,
    "completions/x/proof.webp",
  );
  await event(withPhoto.id, dispute(ryan), at(HOUR));
  return { ryan, partner, optimistic, unconfirmed, noPhoto, withPhoto };
}

async function statuses() {
  const rows = await db()
    .select({
      id: completions.id,
      status: completions.status,
      voidReason: completions.voidReason,
    })
    .from(completions)
    .orderBy(asc(completions.id));
  return new Map(rows.map((r) => [r.id, r]));
}

async function scores() {
  return db()
    .select()
    .from(completionScores)
    .orderBy(asc(completionScores.completionId));
}

describe("settleDueCompletions", () => {
  it("persists every transition that is due, once", async () => {
    const c = await arrange();
    // Nothing is due yet.
    expect(await tx((q) => settleDueCompletions(q, at(WINDOW - 1)))).toEqual({
      finalized: 0,
      expired: 0,
      timedOut: 0,
    });

    const now = at(EXPIRY);
    const before = await scores();
    const openBefore = await listOpenClaims(db(), {
      householdId: HOUSEHOLD_ID,
      now,
    });
    expect(await tx((q) => settleDueCompletions(q, now))).toEqual({
      finalized: 1,
      expired: 1,
      timedOut: 1,
    });
    const s = await statuses();
    expect(s.get(c.optimistic.id)?.status).toBe("finalized");
    expect(s.get(c.unconfirmed.id)).toMatchObject({
      status: "voided",
      voidReason: "unconfirmed",
    });
    expect(s.get(c.noPhoto.id)).toMatchObject({
      status: "voided",
      voidReason: "disputed",
    });
    expect(s.get(c.withPhoto.id)?.status).toBe("disputed");

    // The timed-out dispute is closed at the moment its window ended.
    const [expired] = await db()
      .select()
      .from(disputes)
      .where(eq(disputes.completionId, c.noPhoto.id));
    expect(expired).toMatchObject({
      resolution: "expired",
      resolvedAt: at(WINDOW),
    });

    // Reads were already right before the step ran.
    expect(await scores()).toEqual(before);
    expect(
      await listOpenClaims(db(), { householdId: HOUSEHOLD_ID, now }),
    ).toEqual(openBefore.map((o) => ({ ...o, row: expect.anything() })));

    // A second run finds nothing to do.
    expect(await tx((q) => settleDueCompletions(q, now))).toEqual({
      finalized: 0,
      expired: 0,
      timedOut: 0,
    });
    expect(await statuses()).toEqual(s);
  });

  it("does the work once when two runs overlap", async () => {
    await arrange();
    const now = at(EXPIRY);
    const [a, b] = await Promise.all([
      tx((q) => settleDueCompletions(q, now)),
      tx((q) => settleDueCompletions(q, now)),
    ]);
    expect(a.finalized + b.finalized).toBe(1);
    expect(a.expired + b.expired).toBe(1);
    expect(a.timedOut + b.timedOut).toBe(1);
  });

  it("scopes to one household", async () => {
    await arrange();
    const other = "00000000-0000-4000-8000-0000000000ff";
    expect(
      await tx((q) =>
        settleDueCompletions(q, at(EXPIRY), { householdId: other }),
      ),
    ).toEqual({ finalized: 0, expired: 0, timedOut: 0 });
  });
});

describe("closeDueSeasons", () => {
  it("closes the season after the last window and writes the winner", async () => {
    const c = await arrange();
    const season = (await findSeason(db(), HOUSEHOLD_ID, 2026))!;
    // Ryan 20 (Trash) + 10 approved; the partner 26 once Bathroom is upheld.
    const adj = await createAdjustment(db(), {
      seasonId: season.id,
      memberId: c.ryan,
      points: 10,
      reason: "carried the shopping",
      createdBy: c.ryan,
      now: at(2 * HOUR),
    });
    await approveAdjustment(db(), {
      adjustmentId: adj.id,
      approvedBy: c.partner,
      now: at(3 * HOUR),
    });

    const status = async (now: Date) =>
      seasonStatusNow(db(), (await findSeason(db(), HOUSEHOLD_ID, 2026))!, now);

    // Before Dec 31 24:00 Berlin, nothing moves.
    expect(
      await tx((q) => closeDueSeasons(q, new Date(endsAt.getTime() - 1))),
    ).toEqual([]);
    expect(await status(new Date(endsAt.getTime() - 1))).toBe("active");

    // At 24:00 it is closing, whether or not the step has run.
    expect(await status(endsAt)).toBe("closing");
    expect(await tx((q) => closeDueSeasons(q, endsAt))).toEqual([
      {
        seasonId: season.id,
        year: 2026,
        status: "closing",
        winnerMemberId: null,
      },
    ]);
    expect(await tx((q) => closeDueSeasons(q, endsAt))).toEqual([]);

    // Past the backdate allowance, the disputed Bathroom is still open.
    const late = new Date(endsAt.getTime() + BACKDATE);
    expect(await status(late)).toBe("closing");
    expect(await tx((q) => closeDueSeasons(q, late))).toEqual([]);

    // An admin upholds it; the season closes with Ryan ahead, 30 to 26.
    await event(
      c.withPhoto.id,
      { type: "resolve", actor: c.ryan, actorIsAdmin: true, outcome: "uphold" },
      late,
    );
    const done = new Date(late.getTime() + HOUR);
    expect(await status(done)).toBe("closed");
    expect(await tx((q) => closeDueSeasons(q, done))).toEqual([
      {
        seasonId: season.id,
        year: 2026,
        status: "closed",
        winnerMemberId: c.ryan,
      },
    ]);
    const closed = (await findSeason(db(), HOUSEHOLD_ID, 2026))!;
    expect(closed).toMatchObject({
      status: "closed",
      winnerMemberId: c.ryan,
      finalizedAt: done,
    });
    expect(await status(done)).toBe("closed");

    // A second run is a no-op.
    expect(await tx((q) => closeDueSeasons(q, done))).toEqual([]);
    expect(await findSeason(db(), HOUSEHOLD_ID, 2026)).toEqual(closed);
  });

  it("writes the winner the standings name, whatever the order of runs", async () => {
    const c = await arrange();
    await event(
      c.withPhoto.id,
      { type: "concede", actor: c.partner },
      at(2 * HOUR),
    );
    const done = new Date(endsAt.getTime() + BACKDATE);
    // Straight from active to closed, with no settle run before it.
    expect(await tx((q) => closeDueSeasons(q, done))).toEqual([
      expect.objectContaining({ status: "closed", winnerMemberId: c.ryan }),
    ]);
    const scored = await listSeasonScores(
      db(),
      (await findSeason(db(), HOUSEHOLD_ID, 2026))!.id,
    );
    expect(scored.map((s) => s.doneBy)).toEqual([c.ryan]);
  });

  it("closes an empty season with no winner", async () => {
    await ensureSeason(db(), {
      householdId: HOUSEHOLD_ID,
      year: 2026,
      now: T0,
    });
    const done = new Date(endsAt.getTime() + BACKDATE);
    expect(await tx((q) => closeDueSeasons(q, done))).toEqual([
      expect.objectContaining({ status: "closed", winnerMemberId: null }),
    ]);
  });

  it("leaves a season whose prize mode v1 does not play closing", async () => {
    const season = await ensureSeason(db(), {
      householdId: HOUSEHOLD_ID,
      year: 2026,
      now: T0,
    });
    await db()
      .update(seasons)
      .set({ prizeMode: "longest_streak" })
      .where(eq(seasons.id, season.id));
    const done = new Date(endsAt.getTime() + BACKDATE);
    expect(await tx((q) => closeDueSeasons(q, done))).toEqual([
      expect.objectContaining({ status: "closing" }),
    ]);
    expect(await tx((q) => closeDueSeasons(q, done))).toEqual([]);
    expect((await findSeason(db(), HOUSEHOLD_ID, 2026))!.status).toBe(
      "closing",
    );
  });

  it("closes a season once when two runs overlap", async () => {
    await ensureSeason(db(), {
      householdId: HOUSEHOLD_ID,
      year: 2026,
      now: T0,
    });
    const done = new Date(endsAt.getTime() + BACKDATE);
    const [a, b] = await Promise.all([
      tx((q) => closeDueSeasons(q, done)),
      tx((q) => closeDueSeasons(q, done)),
    ]);
    expect(a.length + b.length).toBe(1);
  });
});

describe("photo pruning", () => {
  it("lists a photo 90 days after its claim settled, and clears it once", async () => {
    const c = await arrange();
    const ruledAt = at(2 * DAY);
    await event(
      c.withPhoto.id,
      { type: "resolve", actor: c.ryan, actorIsAdmin: true, outcome: "void" },
      ruledAt,
    );
    const due = new Date(ruledAt.getTime() + RETAIN);
    expect(await listPhotosToPrune(db(), new Date(due.getTime() - 1))).toEqual(
      [],
    );
    const photo = {
      completionId: c.withPhoto.id,
      pathname: "completions/x/proof.webp",
    };
    expect(await listPhotosToPrune(db(), due)).toEqual([photo]);
    expect(
      await listPhotosToPrune(db(), due, {
        householdId: "00000000-0000-4000-8000-0000000000ff",
      }),
    ).toEqual([]);

    expect(await tx((q) => clearPrunedPhoto(q, photo))).toBe(true);
    expect(await tx((q) => clearPrunedPhoto(q, photo))).toBe(false);
    expect(await listPhotosToPrune(db(), due)).toEqual([]);
    const [row] = await db()
      .select()
      .from(completions)
      .where(eq(completions.id, c.withPhoto.id));
    // The attach time outlives the file: the timeout was judged on it.
    expect(row).toMatchObject({ photoPathname: null, photoAttachedAt: T0 });
  });

  it("keeps the photo of a claim that is still open", async () => {
    await arrange();
    expect(await listPhotosToPrune(db(), at(RETAIN * 2))).toEqual([]);
  });
});
