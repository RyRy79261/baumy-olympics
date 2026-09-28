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
 * Urgent: due now, or falling due before Berlin midnight. A chore that
 * cannot be scored (archived, or no weight yet) is never urgent.
 */
export function isUrgent(
  c: Pick<ChoreView, "state" | "dueAt">,
  now: Date,
): boolean {
  if (c.state === "due") return true;
  if (c.state === "unavailable" || c.dueAt === null) return false;
  return Date.parse(c.dueAt) < berlinMidnightAfter(now).getTime();
}

/** New: created less than `NEW_BOUNTY_MS` before `now`. */
export function isNewChore(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < NEW_BOUNTY_MS;
}
