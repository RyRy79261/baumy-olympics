// Which chores are new (ADR 0005 §2): what the kitchen screen's New icon and
// the hub's New tile count. `list_chores` computes `isNew` with this, so
// every surface agrees. Pure and client-safe.
//
// There is no "urgent" any more (SPEC §12 decision 35, issue #189): a chore
// has no due date, only ready or cooling down.

/** How long a chore counts as new after it was created (ADR 0005 §2). */
export const NEW_BOUNTY_MS = 3 * 24 * 60 * 60_000;

/** New: created less than `NEW_BOUNTY_MS` before `now`. */
export function isNewChore(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() < NEW_BOUNTY_MS;
}
