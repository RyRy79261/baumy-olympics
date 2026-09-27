import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { replayChore } from "../replay";
import {
  isApproved,
  seasonStandings,
  type PointAdjustment,
  type StandingsCompletion,
  type StandingsInput,
} from "../standings";
import {
  DAY,
  DISHES,
  HOUR,
  PARTNER,
  RYAN,
  TRASH,
  berlin,
  series,
} from "./fixtures";

const ADMIN = "member-admin";
const jan = (day: number, hour = 12) => berlin(2026, 1, day, hour);

function done(
  doneBy: string,
  totalPts: number,
  occurredAt: Date,
  verified = false,
): StandingsCompletion {
  return { doneBy, totalPts, occurredAt, verified };
}

function adjustment(
  memberId: string,
  points: number,
  approvedAt: Date | null,
  approvedBy: string | null = ADMIN,
): PointAdjustment {
  return { memberId, points, createdBy: PARTNER, approvedBy, approvedAt };
}

function standings(input: Partial<StandingsInput>) {
  const r = seasonStandings({
    prizeMode: "points",
    memberIds: [RYAN, PARTNER],
    completions: [],
    adjustments: [],
    ...input,
  });
  if (!r.ok) throw new Error(r.code);
  return r;
}

describe("SPEC §4.6 worked example E10", () => {
  it("points (v1): Ryan's 3020 beat the partner's 2850; run length and weight do not matter", () => {
    // Ryan's best run: 9 trash (9 × 20 = 180 of base points).
    const ryanRun = replayChore(
      series(Array(9).fill(RYAN), berlin(2026, 2, 2, 8)),
      [TRASH],
    );
    // The partner's best run: 21 dishes (21 × 10 = 210), a heavier run.
    const partnerRun = replayChore(
      series(Array(21).fill(PARTNER), berlin(2026, 3, 2, 8), DAY),
      [DISHES],
    );
    expect(ryanRun.reduce((a, s) => a + s.basePts, 0)).toBe(180);
    expect(partnerRun.reduce((a, s) => a + s.basePts, 0)).toBe(210);
    expect(partnerRun.at(-1)!.streakLen).toBeGreaterThan(
      ryanRun.at(-1)!.streakLen,
    );

    const runPts = (run: typeof ryanRun) =>
      run.reduce((a, s) => a + s.totalPts, 0);
    const completions = [
      ...ryanRun.map((s) => done(RYAN, s.totalPts, berlin(2026, 2, 2))),
      ...partnerRun.map((s) => done(PARTNER, s.totalPts, berlin(2026, 3, 2))),
      // The rest of each member's season.
      done(RYAN, 3020 - runPts(ryanRun), berlin(2026, 6, 1)),
      done(PARTNER, 2850 - runPts(partnerRun), berlin(2026, 6, 1)),
    ];

    const r = standings({ completions });
    expect(r.winnerMemberId).toBe(RYAN);
    expect(r.standings.map((s) => [s.memberId, s.rank, s.points])).toEqual([
      [RYAN, 1, 3020],
      [PARTNER, 2, 2850],
    ]);
  });
});

describe("seasonStandings", () => {
  it("only the points mode is implemented in v1", () => {
    for (const prizeMode of ["heaviest_streak", "longest_streak"] as const) {
      expect(
        seasonStandings({
          prizeMode,
          memberIds: [RYAN],
          completions: [],
          adjustments: [],
        }),
      ).toEqual({ ok: false, code: "PRIZE_MODE_NOT_SUPPORTED" });
    }
  });

  it("adds approved adjustments, including negative ones, and nothing else", () => {
    const r = standings({
      completions: [done(RYAN, 100, jan(2)), done(PARTNER, 90, jan(3))],
      adjustments: [
        adjustment(PARTNER, 25, jan(5)),
        adjustment(RYAN, -10, jan(6)),
        // Unapproved, or approved by its own creator: ignored.
        adjustment(RYAN, 500, null, null),
        adjustment(RYAN, 500, jan(7), PARTNER),
      ],
    });
    expect(r.standings).toEqual([
      {
        memberId: PARTNER,
        rank: 1,
        points: 115,
        completionPts: 90,
        adjustmentPts: 25,
        verifiedCount: 0,
        reachedAt: jan(5),
      },
      {
        memberId: RYAN,
        rank: 2,
        points: 90,
        completionPts: 100,
        adjustmentPts: -10,
        verifiedCount: 0,
        // Ryan first had 90 or more on Jan 2.
        reachedAt: jan(2),
      },
    ]);
    expect(r.winnerMemberId).toBe(PARTNER);
  });

  it("isApproved needs an approver other than the creator, and a time", () => {
    expect(isApproved(adjustment(RYAN, 1, jan(1)))).toBe(true);
    expect(isApproved(adjustment(RYAN, 1, null))).toBe(false);
    expect(isApproved(adjustment(RYAN, 1, jan(1), null))).toBe(false);
    expect(isApproved(adjustment(RYAN, 1, jan(1), PARTNER))).toBe(false);
  });

  it("tie-break 1: season points", () => {
    const r = standings({
      completions: [done(RYAN, 10, jan(9)), done(PARTNER, 11, jan(10))],
    });
    expect(r.standings.map((s) => s.memberId)).toEqual([PARTNER, RYAN]);
    expect(r.winnerMemberId).toBe(PARTNER);
  });

  it("tie-break 2: verified completions", () => {
    const r = standings({
      completions: [
        done(RYAN, 20, jan(2), false),
        done(PARTNER, 10, jan(3), true),
        done(PARTNER, 10, jan(4), false),
      ],
    });
    expect(r.standings.map((s) => [s.memberId, s.verifiedCount])).toEqual([
      [PARTNER, 1],
      [RYAN, 0],
    ]);
    expect(r.winnerMemberId).toBe(PARTNER);
  });

  it("tie-break 3: who reached the value first", () => {
    const r = standings({
      completions: [
        done(PARTNER, 10, jan(2)),
        done(PARTNER, 10, jan(8)),
        done(RYAN, 20, jan(5)),
      ],
    });
    expect(r.standings.map((s) => [s.memberId, s.rank, s.reachedAt])).toEqual([
      [RYAN, 1, jan(5)],
      [PARTNER, 2, jan(8)],
    ]);
    expect(r.winnerMemberId).toBe(RYAN);
  });

  it("a total of zero or less was reached at the season start", () => {
    const r = standings({
      memberIds: [RYAN, PARTNER, ADMIN],
      completions: [done(PARTNER, 5, jan(2))],
      adjustments: [
        adjustment(PARTNER, -5, jan(3)),
        adjustment(ADMIN, -1, jan(3)),
      ],
    });
    expect(
      r.standings.map((s) => [s.memberId, s.rank, s.points, s.reachedAt]),
    ).toEqual([
      // Both at 0 and reached at the start: tied, ordered by id.
      [PARTNER, 1, 0, null],
      [RYAN, 1, 0, null],
      [ADMIN, 3, -1, null],
    ]);
    expect(r.winnerMemberId).toBeNull();
  });

  it("no winner when the top two tie on every tie-break", () => {
    const r = standings({
      completions: [
        done(RYAN, 10, jan(2), true),
        done(PARTNER, 10, jan(2), true),
      ],
    });
    expect(r.standings.map((s) => s.rank)).toEqual([1, 1]);
    expect(r.winnerMemberId).toBeNull();
  });

  it("a lone scorer wins, and members outside memberIds still rank", () => {
    const r = standings({
      memberIds: [],
      completions: [done(RYAN, 10, jan(2))],
    });
    expect(r.standings.map((s) => s.memberId)).toEqual([RYAN]);
    expect(r.winnerMemberId).toBe(RYAN);
    expect(standings({ memberIds: [] })).toEqual({
      ok: true,
      standings: [],
      winnerMemberId: null,
    });
  });
});

// ---- properties -----------------------------------------------------------

const MEMBERS = [RYAN, PARTNER, ADMIN] as const;
const START = jan(1, 0).getTime();

const completionsArb = fc.array(
  fc.record({
    doneBy: fc.constantFrom(...MEMBERS),
    totalPts: fc.integer({ min: 1, max: 120 }),
    hours: fc.integer({ min: 0, max: 24 * 30 }),
    verified: fc.boolean(),
  }),
  { maxLength: 30 },
);

describe("standings properties", () => {
  it("ranks by points, then verified count, then reachedAt, and the input order does not matter", () => {
    fc.assert(
      fc.property(completionsArb, (rows) => {
        const completions = rows.map((r) =>
          done(
            r.doneBy,
            r.totalPts,
            new Date(START + r.hours * HOUR),
            r.verified,
          ),
        );
        const a = standings({ memberIds: MEMBERS, completions });
        const b = standings({
          memberIds: [...MEMBERS].reverse(),
          completions: [...completions].reverse(),
        });
        expect(b).toEqual(a);

        const total = (m: string) =>
          completions
            .filter((c) => c.doneBy === m)
            .reduce((x, c) => x + c.totalPts, 0);
        for (const s of a.standings) expect(s.points).toBe(total(s.memberId));
        a.standings.slice(1).forEach((s, i) => {
          const prev = a.standings[i]!;
          const key = (x: typeof s) => [
            -x.points,
            -x.verifiedCount,
            x.reachedAt?.getTime() ?? -Infinity,
          ];
          const [p, q] = [key(prev), key(s)];
          const cmp =
            p[0]! - q[0]! ||
            p[1]! - q[1]! ||
            (p[2]! < q[2]! ? -1 : p[2]! > q[2]! ? 1 : 0);
          expect(cmp).toBeLessThanOrEqual(0);
          expect(s.rank === prev.rank).toBe(cmp === 0);
        });
        if (a.winnerMemberId !== null) {
          expect(a.standings[0]!.memberId).toBe(a.winnerMemberId);
        }
      }),
    );
  });
});
