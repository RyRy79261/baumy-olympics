// SPEC §4.5: season standings and the year-end prize. v1 has one prize mode,
// `points`: the season total of `total_pts` plus approved adjustments, winner
// takes all. Ties are broken by points, then verified completions, then who
// reached their points first.

/** `seasons.prize_mode`. Only `points` is implemented in v1. */
export type PrizeMode = "points" | "heaviest_streak" | "longest_streak";

/** A scored (counted) completion of the season: a `completion_scores` row. */
export interface StandingsCompletion {
  doneBy: string;
  occurredAt: Date;
  totalPts: number;
  /** `isVerified` from verification.ts. */
  verified: boolean;
}

/** A `point_adjustments` row. Only approved ones count. */
export interface PointAdjustment {
  memberId: string;
  /** May be negative. */
  points: number;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: Date | null;
}

export interface StandingsInput {
  prizeMode: PrizeMode;
  /** Members to rank even if they have scored nothing. */
  memberIds: readonly string[];
  completions: readonly StandingsCompletion[];
  adjustments: readonly PointAdjustment[];
}

export interface Standing {
  memberId: string;
  /** 1-based. Members tied on every tie-break share a rank. */
  rank: number;
  points: number;
  completionPts: number;
  adjustmentPts: number;
  verifiedCount: number;
  /**
   * When the running total first reached `points`; `null` means it was
   * reached at the start of the season (a total of zero or less).
   */
  reachedAt: Date | null;
}

export type StandingsResult =
  | {
      ok: true;
      standings: Standing[];
      /**
       * The member who takes the pot, or `null` when nobody has a positive
       * total or the top two are tied on every tie-break.
       */
      winnerMemberId: string | null;
    }
  | { ok: false; code: "PRIZE_MODE_NOT_SUPPORTED" };

/**
 * Approved (SPEC §5): `approved_by` is set and is not the creator. The DB
 * checks the second half too; this keeps a bad row from ever counting.
 */
export function isApproved(a: PointAdjustment): a is PointAdjustment & {
  approvedBy: string;
  approvedAt: Date;
} {
  return (
    a.approvedBy !== null &&
    a.approvedAt !== null &&
    a.approvedBy !== a.createdBy
  );
}

interface Tally {
  completionPts: number;
  adjustmentPts: number;
  verifiedCount: number;
  events: { at: number; points: number }[];
}

function reachedAt(tally: Tally, points: number): Date | null {
  const events = [...tally.events].sort((x, y) => x.at - y.at);
  let running = 0;
  let at: Date | null = null;
  for (const e of events) {
    // Already there (a total of zero or less is there from the start).
    if (running >= points) break;
    running += e.points;
    at = new Date(e.at);
  }
  return at;
}

/**
 * Earlier is better. Only compared between equal totals, so either both are
 * `null` (a total of zero or less) or neither is.
 */
function compareReached(a: Date | null, b: Date | null): number {
  return (a?.getTime() ?? 0) - (b?.getTime() ?? 0);
}

function compareStandings(a: Standing, b: Standing): number {
  return (
    b.points - a.points ||
    b.verifiedCount - a.verifiedCount ||
    compareReached(a.reachedAt, b.reachedAt)
  );
}

export function seasonStandings(input: StandingsInput): StandingsResult {
  if (input.prizeMode !== "points") {
    return { ok: false, code: "PRIZE_MODE_NOT_SUPPORTED" };
  }

  const tallies = new Map<string, Tally>();
  const tally = (memberId: string): Tally => {
    let t = tallies.get(memberId);
    if (!t) {
      t = { completionPts: 0, adjustmentPts: 0, verifiedCount: 0, events: [] };
      tallies.set(memberId, t);
    }
    return t;
  };

  for (const id of input.memberIds) tally(id);
  for (const c of input.completions) {
    const t = tally(c.doneBy);
    t.completionPts += c.totalPts;
    if (c.verified) t.verifiedCount += 1;
    t.events.push({ at: c.occurredAt.getTime(), points: c.totalPts });
  }
  for (const a of input.adjustments) {
    if (!isApproved(a)) continue;
    const t = tally(a.memberId);
    t.adjustmentPts += a.points;
    t.events.push({ at: a.approvedAt.getTime(), points: a.points });
  }

  const standings: Standing[] = [...tallies].map(([memberId, t]) => {
    const points = t.completionPts + t.adjustmentPts;
    return {
      memberId,
      rank: 0,
      points,
      completionPts: t.completionPts,
      adjustmentPts: t.adjustmentPts,
      verifiedCount: t.verifiedCount,
      reachedAt: reachedAt(t, points),
    };
  });

  // Fully tied members keep a stable order by id (ids are unique).
  standings.sort(
    (a, b) => compareStandings(a, b) || (a.memberId < b.memberId ? -1 : 1),
  );
  standings.forEach((s, i) => {
    const prev = standings[i - 1];
    s.rank = prev && compareStandings(prev, s) === 0 ? prev.rank : i + 1;
  });

  const [first, second] = standings;
  const winnerMemberId =
    first && first.points > 0 && (!second || second.rank !== first.rank)
      ? first.memberId
      : null;

  return { ok: true, standings, winnerMemberId };
}
