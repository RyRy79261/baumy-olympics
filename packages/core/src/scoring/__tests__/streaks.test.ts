import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { replayChore, type ReplayCompletion } from "../replay";
import { streakRuns, type ScoredRun } from "../streaks";
import { DAY, DISHES, PARTNER, RYAN, TRASH, berlin, series } from "./fixtures";

/** Replay one chore and join each score back to its completion. */
function scored(
  choreId: string,
  completions: ReplayCompletion[],
  rule = TRASH,
): ScoredRun[] {
  const byId = new Map(completions.map((c) => [c.id, c]));
  return replayChore(completions, [rule]).map((s) => {
    const c = byId.get(s.completionId)!;
    return {
      id: c.id,
      choreId,
      doneBy: c.doneBy,
      occurredAt: c.occurredAt,
      loggedAt: c.loggedAt,
      streakLen: s.streakLen,
      basePts: s.basePts,
    };
  });
}

describe("streakRuns", () => {
  it("splits a chore into runs where the doer changes, best first", () => {
    const start = berlin(2026, 2, 2, 8);
    const rows = scored(
      "trash",
      series([RYAN, RYAN, RYAN, PARTNER, PARTNER, RYAN], start),
    );
    const runs = streakRuns(rows);
    expect(
      runs.map((r) => [r.memberId, r.length, r.basePts, r.current]),
    ).toEqual([
      [RYAN, 3, 3 * TRASH.basePoints, false],
      [PARTNER, 2, 2 * TRASH.basePoints, false],
      [RYAN, 1, TRASH.basePoints, true],
    ]);
    expect(runs[0]!.startedAt).toEqual(start);
    expect(runs[0]!.lastAt).toEqual(new Date(start.getTime() + 6 * DAY));
  });

  it("keeps a run of the same member apart when someone else broke it in between", () => {
    const rows = scored(
      "trash",
      series([RYAN, PARTNER, RYAN], berlin(2026, 2, 2, 8)),
    );
    expect(streakRuns(rows)).toHaveLength(3);
  });

  it("E10: the partner's 21 dishes outrank Ryan's 9 trash, whichever is heavier", () => {
    const rows = [
      ...scored(
        "trash",
        series(Array(9).fill(RYAN), berlin(2026, 2, 2, 8)),
        TRASH,
      ),
      ...scored(
        "dishes",
        series(Array(21).fill(PARTNER), berlin(2026, 3, 2, 8), DAY),
        DISHES,
      ),
    ];
    const [first, second] = streakRuns(rows);
    expect(first).toMatchObject({
      memberId: PARTNER,
      choreId: "dishes",
      length: 21,
      basePts: 210,
      current: true,
    });
    expect(second).toMatchObject({
      memberId: RYAN,
      length: 9,
      basePts: 180,
      current: true,
    });
  });

  it("orders equal lengths by weight, then by who got there first", () => {
    const early = berlin(2026, 2, 2, 8);
    const late = berlin(2026, 4, 2, 8);
    const rows = [
      ...scored("dishes", series([RYAN, RYAN], early, DAY), DISHES),
      ...scored("trash", series([PARTNER, PARTNER], late), TRASH),
      ...scored("bath", series([RYAN, RYAN], late), TRASH),
      ...scored("attic", series([PARTNER, PARTNER], late), TRASH),
    ];
    const order = (rs: ScoredRun[]) =>
      streakRuns(rs).map((r) => `${r.choreId}:${r.memberId}`);
    expect(order(rows)).toEqual([
      `attic:${PARTNER}`,
      `bath:${RYAN}`,
      `trash:${PARTNER}`,
      `dishes:${RYAN}`,
    ]);
    // The rows' order does not matter.
    expect(order([...rows].reverse())).toEqual([
      `attic:${PARTNER}`,
      `bath:${RYAN}`,
      `trash:${PARTNER}`,
      `dishes:${RYAN}`,
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(streakRuns([])).toEqual([]);
  });

  it("property: run lengths add up to the completions, and one run per chore is current", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(RYAN, PARTNER), {
          minLength: 1,
          maxLength: 40,
        }),
        (doers) => {
          const rows = scored("trash", series(doers, berlin(2026, 2, 2, 8)));
          const runs = streakRuns(rows);
          expect(runs.reduce((a, r) => a + r.length, 0)).toBe(doers.length);
          expect(runs.filter((r) => r.current)).toHaveLength(1);
          const last = runs.find((r) => r.current)!;
          expect(last.memberId).toBe(doers.at(-1));
          // A run is never longer than the streak the replay stored.
          const max = Math.max(...rows.map((r) => r.streakLen));
          expect(runs[0]!.length).toBe(max);
        },
      ),
    );
  });
});
