import {
  addDaysToDateKey,
  berlinDateKey,
  berlinDateTimeToUtc,
} from "@baumy/core";
import type { ChoreView } from "@/lib/actions/list-chores";

// Which chores are urgent and which are new (ADR 0005 §2): what the kitchen
// screen's Urgent and New icons count and what the hub's "due" list shows.
// `list_chores` computes both fields with these, so every surface agrees.
// Pure and client-safe.

/** How long a chore counts as new after it was created (ADR 0005 §2). */
export const NEW_BOUNTY_MS = 3 * 24 * 60 * 60_000;

/** The next Berlin midnight after `now`. */
export function berlinMidnightAfter(now: Date): Date {
  return berlinDateTimeToUtc(addDaysToDateKey(berlinDateKey(now), 1));
}

/**
 * Urgent: overdue on the chore's own rhythm (SPEC §12 decision 22, owner
 * ruling 2026-10-01). Its rhythm is the interval its weight implies
 * (`expectedIntervalMinutes`, here `intervalMinutes`), and `dueAt` is its
 * last completion plus that interval (`choreTiming`). It is urgent once
 * `dueAt` has passed, or when `dueAt` falls before the next Berlin midnight.
 *
 * Never urgent: a chore never done (no `dueAt`: there is nothing to be
 * overdue against, so it is only available, or new), a chore with no rhythm
 * (no interval), and one that cannot be scored (archived, or no weight yet).
 */
export function isUrgent(
  c: Pick<ChoreView, "state" | "dueAt" | "intervalMinutes">,
  now: Date,
): boolean {
  if (c.state === "unavailable") return false;
  if (c.intervalMinutes === null || c.intervalMinutes <= 0) return false;
  if (c.dueAt === null) return false;
  return Date.parse(c.dueAt) < berlinMidnightAfter(now).getTime();
}

/** New: created less than `NEW_BOUNTY_MS` before `now`. */
export function isNewChore(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < NEW_BOUNTY_MS;
}
