import {
  challengeWindowEndsAt,
  effectiveStatus,
  isVerified,
  PHOTO_RETENTION_DAYS,
  photoPruneAt,
  seasonStandings,
  seasonStatusAt,
  settle,
  type VerificationRow,
} from "@baumy/core";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  ne,
} from "drizzle-orm";
import type { Queryable } from "./index";
import { listMembers } from "./members";
import { chores, completions, disputes, seasons } from "./schema";
import { listSeasonAdjustments, listSeasonScores } from "./scores";
import { seasonHasOpenClaims, type SeasonRow } from "./seasons";

// The daily job's steps (SPEC §6.7), run by `GET /api/cron/daily` and lazily
// on hub page loads (apps/web/lib/background-work.ts). Each one only
// persists what reads already derive from `now`, so correctness never waits
// on it:
//
// - `settleDueCompletions`: the ⏱ transitions of SPEC §4.3 (finalize, the
//   partner-mode expiry, a disputed claim's timeout);
// - `closeDueSeasons`: `closing` at Dec 31 24:00 Berlin, `closed` with its
//   winner once no claim of the season can still move (`seasonStatusAt`);
// - `listPhotosToPrune` and `clearPrunedPhoto`: proof photos 90 days after
//   their claim settled. The caller deletes the file between the two.
//
// Every step is idempotent (a second run finds nothing to do) and claims its
// rows with `FOR UPDATE SKIP LOCKED`, so two runs at once never do the same
// work twice and never wait on each other. A row skipped because someone else
// holds it is done by them, or by the next run. Every function takes the
// caller's handle and writes neither `audit_events` nor `action_requests`.

type Scope = { householdId?: string };

export interface SettleResult {
  finalized: number;
  /** Partner-mode claims nobody confirmed within 72h. */
  expired: number;
  /** Disputed claims whose window ended with no photo attached in time. */
  timedOut: number;
}

/**
 * Persist every time-derived verification transition due at `now` (`settle`).
 * Under the chore's row lock (SKIP LOCKED: a chore being logged or judged
 * right now is left for the next run), each row is read again and written as
 * a compare-and-set on its stored status. A disputed row that times out has
 * its dispute closed as `expired`, at the moment its window ended. None of
 * these transitions changes the counted set (SPEC §4.3), so nothing is
 * re-scored.
 */
export async function settleDueCompletions(
  db: Queryable,
  now: Date,
  scope: Scope = {},
): Promise<SettleResult> {
  const result: SettleResult = { finalized: 0, expired: 0, timedOut: 0 };
  const candidates = await db
    .select({ completion: completions, confirmMode: chores.confirmMode })
    .from(completions)
    .innerJoin(chores, eq(chores.id, completions.choreId))
    .where(
      and(
        inArray(completions.status, ["pending", "disputed"]),
        scope.householdId
          ? eq(completions.householdId, scope.householdId)
          : undefined,
      ),
    )
    .orderBy(asc(completions.loggedAt), asc(completions.id));
  for (const { completion: c, confirmMode } of candidates) {
    if (effectiveStatus({ ...c, confirmMode }, now) === c.status) continue;
    const [lockedChore] = await db
      .select({ id: chores.id })
      .from(chores)
      .where(eq(chores.id, c.choreId))
      .for("update", { skipLocked: true });
    if (!lockedChore) continue;
    const [fresh] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, c.id));
    if (!fresh) continue;
    const row: VerificationRow = {
      status: fresh.status,
      confirmMode,
      doneBy: fresh.doneBy,
      loggedBy: fresh.loggedBy,
      loggedAt: fresh.loggedAt,
      finalizesAt: fresh.finalizesAt,
      photoAttachedAt: fresh.photoAttachedAt,
      disputedBy: null,
      verifiedBy: fresh.verifiedBy,
      verifiedAt: fresh.verifiedAt,
      voidReason: fresh.voidReason,
    };
    const next = settle(row, now);
    if (next.status === row.status) continue;
    const [updated] = await db
      .update(completions)
      .set({ status: next.status, voidReason: next.voidReason })
      .where(
        and(eq(completions.id, fresh.id), eq(completions.status, row.status)),
      )
      .returning({ id: completions.id });
    if (!updated) continue;
    if (row.status === "disputed") {
      await db
        .update(disputes)
        .set({ resolution: "expired", resolvedAt: challengeWindowEndsAt(row) })
        .where(
          and(eq(disputes.completionId, fresh.id), isNull(disputes.resolvedAt)),
        );
      result.timedOut += 1;
    } else if (next.status === "finalized") {
      result.finalized += 1;
    } else {
      result.expired += 1;
    }
  }
  return result;
}

export interface ClosedSeason {
  seasonId: string;
  year: number;
  status: "closing" | "closed";
  /** Set once closed; null on a tie or when nobody has a positive total. */
  winnerMemberId: string | null;
}

/**
 * Move every season past its end on (SPEC §4.5): `active` becomes `closing`,
 * and a season `seasonStatusAt` calls closed is written `closed` with the
 * winner of its standings (`seasonStandings`, the same ranking as
 * `get_standings`). A season whose prize mode v1 does not play stays
 * `closing` for the owner to settle by hand. Seasons are claimed with
 * `FOR UPDATE SKIP LOCKED`; a point adjustment being approved holds its
 * season `FOR SHARE`, so the winner never misses it.
 */
export async function closeDueSeasons(
  db: Queryable,
  now: Date,
  scope: Scope = {},
): Promise<ClosedSeason[]> {
  const due = await db
    .select()
    .from(seasons)
    .where(
      and(
        ne(seasons.status, "closed"),
        lte(seasons.endsAt, now),
        scope.householdId
          ? eq(seasons.householdId, scope.householdId)
          : undefined,
      ),
    )
    .orderBy(asc(seasons.endsAt), asc(seasons.id))
    .for("update", { skipLocked: true });
  const moved: ClosedSeason[] = [];
  for (const season of due) {
    const status = seasonStatusAt(
      {
        status: season.status,
        endsAt: season.endsAt,
        hasOpenClaims: await seasonHasOpenClaims(db, season.id, now),
      },
      now,
    );
    const winner =
      status === "closed" ? await seasonWinner(db, season) : undefined;
    if (winner === undefined || !winner.ok) {
      if (season.status === "closing") continue;
      await db
        .update(seasons)
        .set({ status: "closing" })
        .where(and(eq(seasons.id, season.id), eq(seasons.status, "active")));
      moved.push({
        seasonId: season.id,
        year: season.year,
        status: "closing",
        winnerMemberId: null,
      });
      continue;
    }
    await db
      .update(seasons)
      .set({
        status: "closed",
        winnerMemberId: winner.winnerMemberId,
        finalizedAt: now,
      })
      .where(and(eq(seasons.id, season.id), ne(seasons.status, "closed")));
    moved.push({
      seasonId: season.id,
      year: season.year,
      status: "closed",
      winnerMemberId: winner.winnerMemberId,
    });
  }
  return moved;
}

/** The winner of a season's standings, as `get_standings` ranks them. */
async function seasonWinner(
  db: Queryable,
  season: SeasonRow,
): Promise<{ ok: true; winnerMemberId: string | null } | { ok: false }> {
  const all = await listMembers(db, season.householdId);
  const scored = await listSeasonScores(db, season.id);
  const ranked = seasonStandings({
    prizeMode: season.prizeMode,
    memberIds: all.filter((m) => m.deactivatedAt === null).map((m) => m.id),
    completions: scored.map((c) => ({
      doneBy: c.doneBy,
      occurredAt: c.occurredAt,
      totalPts: c.totalPts,
      verified: isVerified(c),
    })),
    adjustments: await listSeasonAdjustments(db, season.id),
  });
  return ranked.ok
    ? { ok: true, winnerMemberId: ranked.winnerMemberId }
    : { ok: false };
}

export interface PrunablePhoto {
  completionId: string;
  pathname: string;
}

const RETENTION_MS = PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * Proof photos due for deletion at `now` (`photoPruneAt`): 90 days after
 * their claim's verification ended. No claim settles before it was logged,
 * so only rows logged at least 90 days ago are read.
 */
export async function listPhotosToPrune(
  db: Queryable,
  now: Date,
  scope: Scope = {},
): Promise<PrunablePhoto[]> {
  const lastRuling = db
    .select({
      completionId: disputes.completionId,
      resolvedAt: max(disputes.resolvedAt).as("last_resolved_at"),
    })
    .from(disputes)
    .groupBy(disputes.completionId)
    .as("last_ruling");
  const rows = await db
    .select({
      completion: completions,
      confirmMode: chores.confirmMode,
      lastResolvedAt: lastRuling.resolvedAt,
    })
    .from(completions)
    .innerJoin(chores, eq(chores.id, completions.choreId))
    .leftJoin(lastRuling, eq(lastRuling.completionId, completions.id))
    .where(
      and(
        isNotNull(completions.photoPathname),
        lte(completions.loggedAt, new Date(now.getTime() - RETENTION_MS)),
        scope.householdId
          ? eq(completions.householdId, scope.householdId)
          : undefined,
      ),
    )
    .orderBy(asc(completions.loggedAt), asc(completions.id));
  const due: PrunablePhoto[] = [];
  for (const { completion: c, confirmMode, lastResolvedAt } of rows) {
    const pruneAt = photoPruneAt(
      { ...c, confirmMode, disputedBy: null },
      now,
      lastResolvedAt,
    );
    if (pruneAt && pruneAt.getTime() <= now.getTime()) {
      due.push({ completionId: c.id, pathname: c.photoPathname! });
    }
  }
  return due;
}

/**
 * Forget a pruned photo's pathname, once its file is deleted: a
 * compare-and-set on the pathname, claimed with `FOR UPDATE SKIP LOCKED`.
 * `photo_attached_at` stays, since the dispute timeout was judged on it.
 * False when another run got there first (or holds the row).
 */
export async function clearPrunedPhoto(
  db: Queryable,
  photo: PrunablePhoto,
): Promise<boolean> {
  const [claimed] = await db
    .select({ id: completions.id })
    .from(completions)
    .where(
      and(
        eq(completions.id, photo.completionId),
        eq(completions.photoPathname, photo.pathname),
      ),
    )
    .for("update", { skipLocked: true });
  if (!claimed) return false;
  const [cleared] = await db
    .update(completions)
    .set({ photoPathname: null })
    .where(
      and(
        eq(completions.id, photo.completionId),
        eq(completions.photoPathname, photo.pathname),
      ),
    )
    .returning({ id: completions.id });
  return Boolean(cleared);
}
