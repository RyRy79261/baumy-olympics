import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { nextScore } from "../next";
import { replayChore } from "../replay";
import { RULESET_V1 } from "../ruleset";
import {
  DISHES,
  PARTNER,
  RYAN,
  TRASH,
  berlin,
  completion,
  series,
} from "./fixtures";

// nextScore is the preview of one more completion; it must agree with what
// the replay stores once that completion is logged.

describe("nextScore", () => {
  it("starts a streak at 1 when nobody holds one", () => {
    expect(nextScore(TRASH.basePoints, null, RYAN)).toEqual({
      multiplierPct: 100,
      streakPts: TRASH.basePoints,
      breakPts: 0,
      totalPts: TRASH.basePoints,
      streakLen: 1,
      brokenMemberId: null,
      brokenLen: null,
    });
  });

  it("extends the holder's own streak (E1: the second trash run is 25)", () => {
    expect(
      nextScore(TRASH.basePoints, { holderId: RYAN, length: 1 }, RYAN),
    ).toMatchObject({ streakLen: 2, totalPts: 25, brokenMemberId: null });
  });

  it("breaks someone else's streak (E4: breaking a dishes 3-streak is 16)", () => {
    expect(
      nextScore(DISHES.basePoints, { holderId: RYAN, length: 3 }, PARTNER),
    ).toEqual({
      multiplierPct: 100,
      streakPts: 10,
      breakPts: 6,
      totalPts: 16,
      streakLen: 1,
      brokenMemberId: RYAN,
      brokenLen: 3,
    });
  });

  it("equals the replay's score for the completion appended last", () => {
    const doer = fc.constantFrom(RYAN, PARTNER, "member-third");
    fc.assert(
      fc.property(
        fc.array(doer, { maxLength: 15 }),
        doer,
        fc.integer({ min: 1, max: 200 }),
        (history, next, base) => {
          const rule = { ...TRASH, basePoints: base };
          const start = berlin(2026, 2, 2, 8);
          const rows = series(history, start);
          const before = replayChore(rows, [rule]);
          const last = before.at(-1);
          const lastRow = rows.at(-1);
          const streak =
            last && lastRow
              ? { holderId: lastRow.doneBy, length: last.streakLen }
              : null;
          const at = new Date(
            start.getTime() + (history.length + 1) * 3 * 86_400_000,
          );
          const after = replayChore([...rows, completion(next, at)], [rule]);
          const {
            completionId: _c,
            ruleVersionId: _r,
            rulesetVersion: _v,
            basePts: _b,
            ...stored
          } = after.at(-1)!;
          expect(nextScore(base, streak, next, RULESET_V1)).toEqual(stored);
        },
      ),
    );
  });
});
