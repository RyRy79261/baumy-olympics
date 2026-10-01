// @vitest-environment node
import { describe, expect, it } from "vitest";
import { choreTiming, expectedIntervalMinutes } from "@baumy/core";
import { starterChore } from "@baumy/db/chores";
import { FIXED_NOW } from "@/test-utils/actions";
import { berlinMidnightAfter, isUrgent } from "./urgency";

// Urgent = overdue on the chore's own rhythm (SPEC §12 decision 22, owner
// ruling 2026-10-01). Each case builds the chore the way list_chores does:
// the rhythm from its weight (`expectedIntervalMinutes`), its state and
// `dueAt` from `choreTiming`, with SPEC §4.7's starter values.

const HOUR = 3_600_000;
// 10:00Z on 27 Sep 2026 is 12:00 in Berlin; midnight is 22:00Z, 10h away.
const NOW = FIXED_NOW;

const DISHES = starterChore("Dishes");
const TRASH = starterChore("Trash");

/** A chore as list_chores sees it, last done `hoursAgo` (or never). */
function chore(
  starter: ReturnType<typeof starterChore>,
  hoursAgo: number | null,
) {
  const intervalMinutes = expectedIntervalMinutes(starter.basePoints, 100);
  const timing = choreTiming({
    lastDoneAt:
      hoursAgo === null ? null : new Date(NOW.getTime() - hoursAgo * HOUR),
    cooldownMinutes: starter.cooldownMinutes,
    intervalMinutes,
    now: NOW,
  });
  return {
    state: timing.state,
    dueAt: timing.dueAt?.toISOString() ?? null,
    intervalMinutes,
  };
}

describe("isUrgent", () => {
  it("reads the rhythm the starter chores were weighted from", () => {
    // The fixtures' rhythm is SPEC §4.7's expected interval, not a new one.
    expect(expectedIntervalMinutes(DISHES.basePoints, 100)).toBe(
      DISHES.intervalDays * 24 * 60,
    );
    expect(expectedIntervalMinutes(TRASH.basePoints, 100)).toBe(
      TRASH.intervalDays * 24 * 60,
    );
    expect(berlinMidnightAfter(NOW).toISOString()).toBe(
      "2026-09-27T22:00:00.000Z",
    );
  });

  it("never calls a chore never done urgent", () => {
    const never = chore(DISHES, null);
    // choreTiming says it may be done now, but there is no rhythm to be
    // overdue on yet: it is only available (or new).
    expect(never).toMatchObject({ state: "due", dueAt: null });
    expect(isUrgent(never, NOW)).toBe(false);
  });

  it("is not urgent while the chore is within its rhythm", () => {
    // Trash, done an hour ago: due again in 4 days less an hour.
    const fresh = chore(TRASH, 1);
    expect(fresh.state).toBe("cooldown");
    expect(isUrgent(fresh, NOW)).toBe(false);
    // Dishes, done 11h ago: due at 01:00 tomorrow, after midnight.
    const tonight = chore(DISHES, 11);
    expect(Date.parse(tonight.dueAt!)).toBeGreaterThan(
      berlinMidnightAfter(NOW).getTime(),
    );
    expect(isUrgent(tonight, NOW)).toBe(false);
  });

  it("is urgent once its last completion plus its interval has passed", () => {
    // Dishes, done 25h ago: a day is its rhythm, so it is an hour overdue.
    const overdue = chore(DISHES, DISHES.intervalDays * 24 + 1);
    expect(overdue.state).toBe("due");
    expect(isUrgent(overdue, NOW)).toBe(true);
    // Trash, done 5 days ago.
    expect(isUrgent(chore(TRASH, 5 * 24), NOW)).toBe(true);
  });

  it("is urgent when it falls due before Berlin midnight", () => {
    // Dishes, done 20h ago: due at 16:00 today.
    const later = chore(DISHES, 20);
    expect(later.state).toBe("done");
    expect(isUrgent(later, NOW)).toBe(true);
    // The edge: due a moment before midnight is urgent, at midnight is not.
    const midnight = berlinMidnightAfter(NOW).getTime();
    const dueAt = (ms: number) => ({
      state: "done" as const,
      dueAt: new Date(ms).toISOString(),
      intervalMinutes: DISHES.intervalDays * 24 * 60,
    });
    expect(isUrgent(dueAt(midnight - 1), NOW)).toBe(true);
    expect(isUrgent(dueAt(midnight), NOW)).toBe(false);
  });

  it("is never urgent when the chore is unavailable or has no rhythm", () => {
    const overdue = chore(DISHES, 48);
    expect(isUrgent(overdue, NOW)).toBe(true);
    // Archived, or no weight in effect yet.
    expect(isUrgent({ ...overdue, state: "unavailable" }, NOW)).toBe(false);
    // No interval at all: nothing to be overdue on.
    expect(isUrgent({ ...overdue, intervalMinutes: null }, NOW)).toBe(false);
    expect(isUrgent({ ...overdue, intervalMinutes: 0 }, NOW)).toBe(false);
  });

  it("finds midnight on the day the clocks go back (25 hours long)", () => {
    expect(
      berlinMidnightAfter(new Date("2026-10-25T10:00:00Z")).toISOString(),
    ).toBe("2026-10-25T23:00:00.000Z");
  });
});
