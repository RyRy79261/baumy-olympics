import {
  effectiveStatus,
  seasonBounds,
  seasonClosableAt,
  seasonStatusAt,
  type SeasonStatus,
} from "@baumy/core";
import { and, eq, inArray } from "drizzle-orm";
import type { Queryable } from "./index";
import { completions, seasons } from "./schema";

// Seasons (SPEC §4.1, §4.5): one per Berlin calendar year, created lazily the
// first time a write needs it (a completion, an adjustment, a pot contribution
// or a prize mode), never ahead of time by a cron; the scoreboard reads a
// missing season as empty. Every function takes the caller's handle.

export type SeasonRow = typeof seasons.$inferSelect;

/** The season for `year`, if it has been created. */
export async function findSeason(
  db: Queryable,
  householdId: string,
  year: number,
): Promise<SeasonRow | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(and(eq(seasons.householdId, householdId), eq(seasons.year, year)))
    .limit(1);
  return row ?? null;
}

/**
 * The season for `year`, created if missing: `active`, `prize_mode=points`,
 * bounded by 1 Jan 00:00 Berlin on both ends (`seasonBounds`). Safe to race:
 * the insert does nothing on the `(household_id, year)` unique index, and the
 * loser reads the winner's row.
 */
export async function ensureSeason(
  db: Queryable,
  input: { householdId: string; year: number; now: Date },
): Promise<SeasonRow> {
  const { startsAt, endsAt } = seasonBounds(input.year);
  const [created] = await db
    .insert(seasons)
    .values({
      householdId: input.householdId,
      year: input.year,
      startsAt,
      endsAt,
      createdAt: input.now,
    })
    .onConflictDoNothing({ target: [seasons.householdId, seasons.year] })
    .returning();
  if (created) return created;
  const existing = await findSeason(db, input.householdId, input.year);
  if (!existing) {
    // Only reachable if the row was deleted between the two statements.
    throw new Error(`Season ${input.year} vanished while being created.`);
  }
  return existing;
}

/**
 * The season, locked `FOR SHARE` until the caller's transaction ends: a
 * write that must not land after the winner is written (approving a point
 * adjustment) holds it, and `closeDueSeasons`, which claims seasons with
 * `FOR UPDATE SKIP LOCKED`, leaves the season for its next run.
 */
export async function lockSeasonShared(
  db: Queryable,
  seasonId: string,
): Promise<SeasonRow | null> {
  const [row] = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .for("share");
  return row ?? null;
}

/**
 * Whether any of the season's completions is still `pending` or `disputed`
 * at `now` (`effectiveStatus`): one stored as open whose time has run out is
 * not, whether or not the daily job has written that yet.
 */
export async function seasonHasOpenClaims(
  db: Queryable,
  seasonId: string,
  now: Date,
): Promise<boolean> {
  const rows = await db
    .select({
      status: completions.status,
      loggedAt: completions.loggedAt,
      finalizesAt: completions.finalizesAt,
      photoAttachedAt: completions.photoAttachedAt,
    })
    .from(completions)
    .where(
      and(
        eq(completions.seasonId, seasonId),
        inArray(completions.status, ["pending", "disputed"]),
      ),
    );
  return rows.some((r) => {
    const status = effectiveStatus(r, now);
    return status === "pending" || status === "disputed";
  });
}

/**
 * The season's status at `now` (SPEC §4.5, `seasonStatusAt`), whether or not
 * the daily job has persisted it: reads and writes that care whether a season
 * is closed ask this, not the stored column.
 */
export async function seasonStatusNow(
  db: Queryable,
  season: Pick<SeasonRow, "id" | "status" | "endsAt">,
  now: Date,
): Promise<SeasonStatus> {
  // Only a season past its end can have moved on; skip the read otherwise.
  const hasOpenClaims =
    season.status !== "closed" &&
    now.getTime() >= seasonClosableAt(season.endsAt).getTime() &&
    (await seasonHasOpenClaims(db, season.id, now));
  return seasonStatusAt(
    { status: season.status, endsAt: season.endsAt, hasOpenClaims },
    now,
  );
}
