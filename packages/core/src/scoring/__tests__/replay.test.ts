import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { seasonYear } from "../../time";
import {
  compareCompletions,
  isCounted,
  replayChore,
  type ReplayCompletion,
} from "../replay";
import { NoRuleVersionError, RULESET_V1, type RuleVersion } from "../ruleset";
import {
  DAY,
  DISHES,
  HOUR,
  PARTNER,
  RYAN,
  TRASH,
  berlin,
  completion,
  series,
} from "./fixtures";

const totals = (scores: { totalPts: number }[]) =>
  scores.map((s) => s.totalPts);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("SPEC §4.6 worked examples", () => {
  it("E1: six trash runs in a row score 20…45 with no cap", () => {
    const scores = replayChore(
      series(Array(6).fill(RYAN), berlin(2026, 3, 2, 8)),
      [TRASH],
    );
    expect(totals(scores)).toEqual([20, 25, 30, 35, 40, 45]);
    expect(sum(totals(scores).slice(0, 4))).toBe(110);
    expect(sum(totals(scores))).toBe(195);
    expect(scores.map((s) => s.streakLen)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it.each([
    [1, 24],
    [4, 36],
    [5, 40],
    [10, 60],
    [11, 60],
    [25, 60],
  ])("E2: breaking a trash streak of %i pays %i", (k, expected) => {
    const scores = replayChore(
      series([...Array(k).fill(RYAN), PARTNER], berlin(2026, 2, 2, 8)),
      [TRASH],
    );
    const last = scores.at(-1)!;
    expect(last.totalPts).toBe(expected);
    expect(last.streakLen).toBe(1);
    expect(last.brokenMemberId).toBe(RYAN);
    expect(last.brokenLen).toBe(k);
    expect(last.streakPts).toBe(TRASH.basePoints);
  });

  it("E3: strict alternation of 8 trash runs gives 188, split 92/96", () => {
    const doers = [RYAN, PARTNER, RYAN, PARTNER, RYAN, PARTNER, RYAN, PARTNER];
    const scores = replayChore(series(doers, berlin(2026, 4, 6, 8)), [TRASH]);
    expect(totals(scores)).toEqual([20, 24, 24, 24, 24, 24, 24, 24]);
    expect(sum(totals(scores))).toBe(188);
    const by = (m: string) =>
      sum(scores.filter((_, i) => doers[i] === m).map((s) => s.totalPts));
    expect(by(RYAN)).toBe(92);
    expect(by(PARTNER)).toBe(96);

    const alone = replayChore(
      series(Array(8).fill(RYAN), berlin(2026, 4, 6, 8)),
      [TRASH],
    );
    expect(sum(totals(alone))).toBe(300);
  });

  it("E4: dishes n=2 rounds 12.5 up to 13; breaking a 3-streak gives 16", () => {
    const two = replayChore(series([RYAN, RYAN], berlin(2026, 5, 4, 8), DAY), [
      DISHES,
    ]);
    expect(two.at(-1)!.totalPts).toBe(13);

    const broken = replayChore(
      series([RYAN, RYAN, RYAN, PARTNER], berlin(2026, 5, 4, 8), DAY),
      [DISHES],
    );
    expect(broken.at(-1)).toMatchObject({
      streakPts: 10,
      breakPts: 6,
      totalPts: 16,
      brokenLen: 3,
    });
  });

  it("E6: four days' gap keeps a dishes streak alive (no lapse)", () => {
    const rows = [
      completion(RYAN, berlin(2026, 9, 18, 20)),
      completion(RYAN, berlin(2026, 9, 19, 20)),
      completion(RYAN, berlin(2026, 9, 20, 20)),
      completion(RYAN, berlin(2026, 9, 21, 20)), // Monday 20:00
      completion(RYAN, berlin(2026, 9, 25, 21)), // Friday 21:00
    ];
    const last = replayChore(rows, [DISHES]).at(-1)!;
    expect(last.streakLen).toBe(5);
    expect(last.multiplierPct).toBe(200);
    expect(last.totalPts).toBe(20);
  });

  it("E12: the January streak starts at 1 after a December run", () => {
    const scores = replayChore(
      [
        completion(RYAN, berlin(2026, 12, 30, 20)),
        completion(RYAN, berlin(2026, 12, 31, 23, 50)),
        completion(RYAN, berlin(2027, 1, 1, 12)),
      ],
      [DISHES],
    );
    expect(scores.map((s) => s.streakLen)).toEqual([1, 2, 1]);
    expect(scores.at(-1)).toMatchObject({
      brokenMemberId: null,
      brokenLen: null,
      breakPts: 0,
      totalPts: DISHES.basePoints,
    });
  });
});

describe("counted completions", () => {
  it("counts confirmed, finalized and pending only", () => {
    expect(isCounted({ status: "confirmed" })).toBe(true);
    expect(isCounted({ status: "finalized" })).toBe(true);
    // A self-claim counts from the moment it is logged (§12 decision 29).
    expect(isCounted({ status: "pending" })).toBe(true);
    expect(isCounted({ status: "disputed" })).toBe(false);
    expect(isCounted({ status: "voided" })).toBe(false);
  });

  it("skips uncounted rows without breaking the streak around them", () => {
    const start = berlin(2026, 3, 2, 8);
    const rows = [
      completion(RYAN, start),
      completion(PARTNER, new Date(start.getTime() + 3 * DAY), {
        status: "disputed",
      }),
      completion(PARTNER, new Date(start.getTime() + 6 * DAY), {
        status: "voided",
      }),
      completion(RYAN, new Date(start.getTime() + 9 * DAY), {
        status: "pending",
      }),
    ];
    const scores = replayChore(rows, [TRASH]);
    expect(scores.map((s) => s.completionId)).toEqual([
      rows[0]!.id,
      rows[3]!.id,
    ]);
    expect(scores.at(-1)!.streakLen).toBe(2);
  });
});

describe("replay order", () => {
  it("sorts by occurred_at, then logged_at, then id", () => {
    const at = berlin(2026, 3, 2, 8);
    const a = completion(RYAN, at, {
      id: "b",
      loggedAt: new Date(at.getTime() + HOUR),
    });
    const b = completion(PARTNER, at, { id: "c", loggedAt: at });
    const c = completion(RYAN, at, {
      id: "a",
      loggedAt: new Date(at.getTime() + HOUR),
    });
    expect([a, b, c].sort(compareCompletions).map((x) => x.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(compareCompletions(c, a)).toBeLessThan(0);
    expect(compareCompletions(a, c)).toBeGreaterThan(0);
    expect(compareCompletions(a, a)).toBe(0);
  });
});

describe("rule versions", () => {
  const v1: RuleVersion = { ...TRASH, id: "v1" };
  const v2: RuleVersion = {
    id: "v2",
    effectiveFrom: berlin(2026, 6, 1),
    basePoints: 30,
    cooldownMinutes: TRASH.cooldownMinutes,
  };

  it("scores each completion with the version in effect when it happened", () => {
    const rows = [
      completion(RYAN, berlin(2026, 5, 25, 8)),
      // Logged after the change, but it happened before it.
      completion(RYAN, berlin(2026, 5, 31, 23), {
        loggedAt: berlin(2026, 6, 1, 9),
      }),
      completion(RYAN, berlin(2026, 6, 1)),
    ];
    const scores = replayChore(rows, [v2, v1]);
    expect(scores.map((s) => s.ruleVersionId)).toEqual(["v1", "v1", "v2"]);
    expect(scores.map((s) => s.basePts)).toEqual([20, 20, 30]);
    expect(scores.map((s) => s.rulesetVersion)).toEqual([
      RULESET_V1.version,
      RULESET_V1.version,
      RULESET_V1.version,
    ]);
  });

  it("throws when no version is in effect yet", () => {
    const early = completion(RYAN, berlin(2026, 5, 1));
    expect(() => replayChore([early], [v2])).toThrow(NoRuleVersionError);
    expect(() => replayChore([early], [])).toThrow(/No chore rule version/);
  });
});

// ---- properties -----------------------------------------------------------

const RANGE_START = berlin(2025, 6, 1).getTime();
const RANGE_MS = 2 * 365 * DAY; // crosses two season boundaries
const MEMBERS = ["m-a", "m-b", "m-c"] as const;

const rowArb = fc.record({
  doneBy: fc.constantFrom(...MEMBERS),
  offset: fc.integer({ min: 0, max: RANGE_MS }),
  logDelay: fc.integer({ min: 0, max: 24 * 60 }),
  status: fc.constantFrom(
    "pending",
    "confirmed",
    "finalized",
    "disputed",
    "voided",
  ) as fc.Arbitrary<ReplayCompletion["status"]>,
});

const rowsArb = fc.array(rowArb, { maxLength: 40 }).map((rows) =>
  rows.map((r, i): ReplayCompletion => ({
    id: `id-${String(i).padStart(3, "0")}`,
    doneBy: r.doneBy,
    // Coarse timestamps so ties on occurred_at actually happen.
    occurredAt: new Date(RANGE_START + r.offset - (r.offset % (6 * HOUR))),
    loggedAt: new Date(RANGE_START + r.offset + r.logDelay * 60_000),
    status: r.status,
  })),
);

const EARLIEST: RuleVersion = {
  id: "r-0",
  effectiveFrom: new Date(RANGE_START),
  basePoints: 20,
  cooldownMinutes: 60,
};

describe("replay properties", () => {
  it("does not depend on input order", () => {
    fc.assert(
      fc.property(
        rowsArb.chain((rows) =>
          fc.tuple(
            fc.constant(rows),
            fc.shuffledSubarray(rows, {
              minLength: rows.length,
              maxLength: rows.length,
            }),
          ),
        ),
        ([rows, shuffled]) => {
          expect(replayChore(shuffled, [EARLIEST])).toEqual(
            replayChore(rows, [EARLIEST]),
          );
        },
      ),
    );
  });

  it("voiding the last counted row changes only that row", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const before = replayChore(rows, [EARLIEST]);
        fc.pre(before.length > 0);
        const lastId = before.at(-1)!.completionId;
        const after = replayChore(
          rows.map((r) => (r.id === lastId ? { ...r, status: "voided" } : r)),
          [EARLIEST],
        );
        expect(after).toEqual(before.slice(0, -1));
      }),
    );
  });

  it("resets the streak exactly when the doer changes or a season starts", () => {
    fc.assert(
      fc.property(rowsArb, (rows) => {
        const counted = rows.filter(isCounted).sort(compareCompletions);
        const scores = replayChore(rows, [EARLIEST]);
        expect(scores.map((s) => s.completionId)).toEqual(
          counted.map((c) => c.id),
        );
        scores.forEach((s, i) => {
          const prev = counted[i - 1];
          const cur = counted[i]!;
          const sameSeason =
            prev !== undefined &&
            seasonYear(prev.occurredAt) === seasonYear(cur.occurredAt);
          if (sameSeason && prev.doneBy === cur.doneBy) {
            expect(s.streakLen).toBe(scores[i - 1]!.streakLen + 1);
            expect(s.brokenLen).toBeNull();
          } else if (sameSeason) {
            expect(s.streakLen).toBe(1);
            expect(s.brokenMemberId).toBe(prev.doneBy);
            expect(s.brokenLen).toBe(scores[i - 1]!.streakLen);
          } else {
            expect(s.streakLen).toBe(1);
            expect(s.brokenMemberId).toBeNull();
            expect(s.breakPts).toBe(0);
          }
        });
      }),
    );
  });

  it("uses the rule version in effect at occurred_at", () => {
    const versionsArb = fc
      .array(
        fc.record({
          offset: fc.integer({ min: 1, max: RANGE_MS }),
          basePoints: fc.integer({ min: 1, max: 200 }),
        }),
        { maxLength: 6 },
      )
      .map((vs) => [
        EARLIEST,
        ...vs.map((v, i): RuleVersion => ({
          id: `r-${i + 1}`,
          effectiveFrom: new Date(RANGE_START + v.offset),
          basePoints: v.basePoints,
          cooldownMinutes: 60,
        })),
      ]);
    fc.assert(
      fc.property(rowsArb, versionsArb, (rows, versions) => {
        const byId = new Map(rows.map((r) => [r.id, r]));
        for (const s of replayChore(rows, versions)) {
          const at = byId.get(s.completionId)!.occurredAt.getTime();
          const inEffect = versions
            .filter((v) => v.effectiveFrom.getTime() <= at)
            .reduce((a, b) =>
              b.effectiveFrom.getTime() > a.effectiveFrom.getTime() ? b : a,
            );
          expect(s.ruleVersionId).toBe(inEffect.id);
          expect(s.basePts).toBe(inEffect.basePoints);
        }
      }),
    );
  });
});
