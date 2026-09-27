import { seasonBounds } from "@baumy/core";
import { and, eq } from "drizzle-orm";
import type { Queryable } from "./index";
import { seasons } from "./schema";

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
