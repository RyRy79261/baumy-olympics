import { z } from "zod";
import {
  berlinMonthBounds,
  berlinMonthKey,
  berlinParts,
  effectiveStatus,
  isVerified,
  seasonStandings,
  seasonYear,
  streakRuns,
  type PrizeMode,
  type SeasonStatus,
  type StreakRun,
} from "@baumy/core";
import type { Queryable } from "@baumy/db";
import { listMembers } from "@baumy/db/members";
import {
  countDisputes,
  listPotContributions,
  listSeasonAdjustments,
  listSeasonScores,
  seasonHasCompletions,
  type AdjustmentListing,
  type ScoredCompletion,
} from "@baumy/db/scores";
import {
  findSeason,
  seasonStatusNow,
  type SeasonRow,
} from "@baumy/db/seasons";
import { defineAction, type ActionCtx } from "./define";
import { fail } from "./result";

// The scoreboard, the streak board and the pot (SPEC §3.2, §4.5), read on
// every surface: `get_standings`, `get_streaks` and `get_pot`. Each reads the
// stored scores of one season (the current one by default) and ranks them
// with packages/core, so every surface sees the same numbers the year-end
// prize will be decided on.

const ALL_SURFACES = ["ui", "kiosk", "ai", "mcp", "brain"] as const;

const year = z
  .number()
  .int()
  .min(2000)
  .max(2100)
  .optional()
  .describe(
    "The season (Berlin calendar year). Defaults to the current season.",
  );

/** A season as the boards describe it, whether or not it has a row yet. */
export interface SeasonView {
  year: number;
  prizeMode: PrizeMode;
  status: SeasonStatus;
}

interface SeasonScope {
  view: SeasonView;
  row: SeasonRow | null;
}

/**
 * The season for `year` (default: the one `now` is in). A season nobody has
 * logged anything in yet has no row; it reads as active, `points`, and empty.
 * Reads never create one. The status is the one at `now`
 * (`seasonStatusNow`), whether or not the daily job has written it.
 */
async function seasonScope(
  ctx: ActionCtx,
  year: number | undefined,
): Promise<SeasonScope> {
  const y = year ?? seasonYear(ctx.now);
  const row = await findSeason(ctx.db, ctx.householdId, y);
  return {
    row,
    view: {
      year: y,
      prizeMode: row?.prizeMode ?? "points",
      status: row ? await seasonStatusNow(ctx.db, row, ctx.now) : "active",
    },
  };
}

type NameOf = (memberId: string) => string;

async function memberNames(
  db: Queryable,
  householdId: string,
): Promise<{ activeIds: string[]; nameOf: NameOf }> {
  const all = await listMembers(db, householdId);
  const names = new Map(all.map((m) => [m.id, m.displayName]));
  return {
    activeIds: all.filter((m) => m.deactivatedAt === null).map((m) => m.id),
    nameOf: (id) => names.get(id) ?? "Someone",
  };
}

/** Counted now, but still able to be disputed or undone: shown dimmed. */
function isProvisional(row: ScoredCompletion, now: Date): boolean {
  return effectiveStatus(row, now) === "pending";
}

export interface StandingView {
  memberId: string;
  displayName: string;
  /** 1-based; members tied on every tie-break share a rank. */
  rank: number;
  /** Completions plus approved adjustments. */
  points: number;
  completionPts: number;
  adjustmentPts: number;
  /** The part of `points` from claims that may still be disputed. */
  provisionalPts: number;
  completions: number;
  verifiedCount: number;
  /** How far behind the top of the table; 0 for the leader. */
  gapToLeader: number;
}

type Ranked =
  | {
      ok: true;
      standings: StandingView[];
      leaderId: string | null;
      scored: ScoredCompletion[];
      adjustments: AdjustmentListing[];
      nameOf: NameOf;
    }
  | { ok: false };

/**
 * The season's standings (SPEC §4.5): `completion_scores` of the season plus
 * approved adjustments, ranked by `seasonStandings`. `ok: false` for a prize
 * mode v1 does not play.
 */
async function rankSeason(ctx: ActionCtx, scope: SeasonScope): Promise<Ranked> {
  const { activeIds, nameOf } = await memberNames(ctx.db, ctx.householdId);
  const scored = scope.row ? await listSeasonScores(ctx.db, scope.row.id) : [];
  const adjustments = scope.row
    ? await listSeasonAdjustments(ctx.db, scope.row.id)
    : [];
  const ranked = seasonStandings({
    prizeMode: scope.view.prizeMode,
    memberIds: activeIds,
    completions: scored.map((c) => ({
      doneBy: c.doneBy,
      occurredAt: c.occurredAt,
      totalPts: c.totalPts,
      verified: isVerified(c),
    })),
    adjustments,
  });
  if (!ranked.ok) return { ok: false };

  const provisional = new Map<string, number>();
  const done = new Map<string, number>();
  for (const c of scored) {
    done.set(c.doneBy, (done.get(c.doneBy) ?? 0) + 1);
    if (isProvisional(c, ctx.now)) {
      provisional.set(c.doneBy, (provisional.get(c.doneBy) ?? 0) + c.totalPts);
    }
  }
  const top = ranked.standings[0]?.points ?? 0;
  return {
    ok: true,
    scored,
    adjustments,
    nameOf,
    leaderId: ranked.winnerMemberId,
    standings: ranked.standings.map((s) => ({
      memberId: s.memberId,
      displayName: nameOf(s.memberId),
      rank: s.rank,
      points: s.points,
      completionPts: s.completionPts,
      adjustmentPts: s.adjustmentPts,
      provisionalPts: provisional.get(s.memberId) ?? 0,
      completions: done.get(s.memberId) ?? 0,
      verifiedCount: s.verifiedCount,
      gapToLeader: top - s.points,
    })),
  };
}

const notSupported = (mode: PrizeMode) =>
  fail(
    "PRIZE_MODE_NOT_SUPPORTED",
    `This season's prize mode (${mode}) is not played yet. Ask an admin to set it to points.`,
  );

// ---------------------------------------------------------------------------
// get_standings
// ---------------------------------------------------------------------------

export interface RecentCompletionView {
  completionId: string;
  choreName: string;
  doneBy: string;
  doneByName: string;
  /** ISO 8601. */
  occurredAt: string;
  basePts: number;
  streakLen: number;
  /** What the streak added on top of the base. */
  streakBonusPts: number;
  breakPts: number;
  brokenMemberName: string | null;
  brokenLen: number | null;
  totalPts: number;
  provisional: boolean;
}

export interface AdjustmentView {
  id: string;
  memberId: string;
  memberName: string;
  points: number;
  reason: string;
  createdBy: string;
  createdByName: string;
  approvedByName: string | null;
  /** ISO 8601; null while it waits for a second admin. */
  approvedAt: string | null;
}

export interface DisputeCountView {
  memberId: string;
  displayName: string;
  raised: number;
  against: number;
}

export interface GetStandingsData {
  season: SeasonView & {
    /** The season has a completion, so its prize mode is fixed. */
    prizeLocked: boolean;
    nextSeason: SeasonView;
  };
  /** Who would take the pot now; null when nobody leads outright. */
  leaderId: string | null;
  standings: StandingView[];
  disputesThisMonth: { month: string; members: DisputeCountView[] };
  /** The season's latest scored completions, newest first. */
  recent: RecentCompletionView[];
  /** Newest first, approved or waiting. */
  adjustments: AdjustmentView[];
}

const RECENT_DEFAULT = 10;

export const getStandings = defineAction({
  name: "get_standings",
  title: "Get the standings",
  description:
    "Returns the season scoreboard: each member's rank and points (scored completions plus approved adjustments), the part of those points that is still provisional (claims that can still be disputed), how far each member is behind the leader, the leader (who would take the pot now, or null on a tie), the prize mode, dispute counts this month, the latest scored completions with their breakdown (base, streak bonus, break bonus) and the point adjustments. Times are ISO 8601 in UTC; the household lives in Europe/Berlin.",
  consent: "See the season scoreboard",
  kind: "read",
  risk: "safe",
  surfaces: ALL_SURFACES,
  requires: "member",
  input: z.strictObject({
    year,
    recent: z
      .number()
      .int()
      .min(0)
      .max(50)
      .optional()
      .describe("How many recent completions to include. Default 10."),
  }),
  async execute(ctx, input) {
    const scope = await seasonScope(ctx, input.year);
    const ranked = await rankSeason(ctx, scope);
    if (!ranked.ok) return notSupported(scope.view.prizeMode);
    const { nameOf } = ranked;

    const next = await seasonScope(ctx, scope.view.year + 1);
    const nowParts = berlinParts(ctx.now);
    const month = berlinMonthBounds(nowParts.year, nowParts.month);
    const disputes = await countDisputes(ctx.db, {
      householdId: ctx.householdId,
      since: month.startsAt,
      until: month.endsAt,
    });
    const data: GetStandingsData = {
      season: {
        ...scope.view,
        prizeLocked: scope.row
          ? await seasonHasCompletions(ctx.db, scope.row.id)
          : false,
        nextSeason: next.view,
      },
      leaderId: ranked.leaderId,
      standings: ranked.standings,
      disputesThisMonth: {
        month: berlinMonthKey(ctx.now),
        members: disputes
          .map((d) => ({ ...d, displayName: nameOf(d.memberId) }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName)),
      },
      recent: ranked.scored
        .slice(
          Math.max(0, ranked.scored.length - (input.recent ?? RECENT_DEFAULT)),
        )
        .reverse()
        .map((c) => ({
          completionId: c.id,
          choreName: c.choreName,
          doneBy: c.doneBy,
          doneByName: nameOf(c.doneBy),
          occurredAt: c.occurredAt.toISOString(),
          basePts: c.basePts,
          streakLen: c.streakLen,
          streakBonusPts: c.streakPts - c.basePts,
          breakPts: c.breakPts,
          brokenMemberName: c.brokenMemberId ? nameOf(c.brokenMemberId) : null,
          brokenLen: c.brokenLen,
          totalPts: c.totalPts,
          provisional: isProvisional(c, ctx.now),
        })),
      adjustments: ranked.adjustments.map((a) => ({
        id: a.id,
        memberId: a.memberId,
        memberName: a.memberName,
        points: a.points,
        reason: a.reason,
        createdBy: a.createdBy,
        createdByName: a.createdByName,
        approvedByName: a.approvedByName,
        approvedAt: a.approvedAt?.toISOString() ?? null,
      })),
    };
    return { ok: true, data };
  },
});

// ---------------------------------------------------------------------------
// get_streaks
// ---------------------------------------------------------------------------

export interface StreakView {
  choreId: string;
  choreName: string;
  memberId: string;
  memberName: string;
  length: number;
  /** The run's weight: its base points added up. */
  basePts: number;
  /** ISO 8601. */
  startedAt: string;
  lastAt: string;
  /** Still running: this member holds the chore's streak now. */
  current: boolean;
}

export interface GetStreaksData {
  year: number;
  /** Who holds each chore's streak now, longest first. */
  current: StreakView[];
  /** The season's best runs, current or over, longest first. */
  best: StreakView[];
}

export const getStreaks = defineAction({
  name: "get_streaks",
  title: "Get the streaks",
  description:
    "Returns the season's streak board: who holds each chore's streak now and how long it is, and the season's best runs (current or already broken), longest first, each with its chore, member, length, weight (base points added up) and dates. Times are ISO 8601 in UTC.",
  consent: "See the season's streaks",
  kind: "read",
  risk: "safe",
  surfaces: ALL_SURFACES,
  requires: "member",
  input: z.strictObject({
    year,
    best: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("How many best runs to return. Default 5."),
  }),
  async execute(ctx, input) {
    const scope = await seasonScope(ctx, input.year);
    const { nameOf } = await memberNames(ctx.db, ctx.householdId);
    const scored = scope.row
      ? await listSeasonScores(ctx.db, scope.row.id)
      : [];
    const choreName = new Map(scored.map((c) => [c.choreId, c.choreName]));
    const view = (r: StreakRun): StreakView => ({
      choreId: r.choreId,
      choreName: choreName.get(r.choreId)!,
      memberId: r.memberId,
      memberName: nameOf(r.memberId),
      length: r.length,
      basePts: r.basePts,
      startedAt: r.startedAt.toISOString(),
      lastAt: r.lastAt.toISOString(),
      current: r.current,
    });
    const runs = streakRuns(scored);
    const data: GetStreaksData = {
      year: scope.view.year,
      current: runs.filter((r) => r.current).map(view),
      best: runs.slice(0, input.best ?? 5).map(view),
    };
    return { ok: true, data };
  },
});

// ---------------------------------------------------------------------------
// get_pot
// ---------------------------------------------------------------------------

export interface PotContributionView {
  id: string;
  amountCents: number;
  contributedBy: string;
  contributedByName: string;
  note: string | null;
}

export interface PotMonthView {
  /** "YYYY-MM". */
  month: string;
  totalCents: number;
  /** The pot after this month. */
  runningTotalCents: number;
  contributions: PotContributionView[];
}

export interface GetPotData {
  year: number;
  prizeMode: PrizeMode;
  totalCents: number;
  /** Oldest month first. */
  months: PotMonthView[];
  /** Who would take the pot now; null when nobody leads outright. */
  leader: { memberId: string; displayName: string; points: number } | null;
}

export const getPot = defineAction({
  name: "get_pot",
  title: "Get the pot",
  description:
    "Returns the season's savings pot: each month's contributions (amounts in euro cents, who paid, notes), the running total after each month, the total, and the current leader who would take the whole pot at the end of the season (null when nobody leads outright). The pot is a ledger only; money moves at the bank.",
  consent: "See the savings pot",
  kind: "read",
  risk: "safe",
  surfaces: ALL_SURFACES,
  requires: "member",
  input: z.strictObject({ year }),
  async execute(ctx, input) {
    const scope = await seasonScope(ctx, input.year);
    const ranked = await rankSeason(ctx, scope);
    if (!ranked.ok) return notSupported(scope.view.prizeMode);
    const rows = scope.row
      ? await listPotContributions(ctx.db, scope.row.id)
      : [];

    const months: PotMonthView[] = [];
    let running = 0;
    for (const r of rows) {
      const key = r.month.slice(0, 7);
      let m = months.at(-1);
      if (!m || m.month !== key) {
        m = {
          month: key,
          totalCents: 0,
          runningTotalCents: running,
          contributions: [],
        };
        months.push(m);
      }
      m.totalCents += r.amountCents;
      running += r.amountCents;
      m.runningTotalCents = running;
      m.contributions.push({
        id: r.id,
        amountCents: r.amountCents,
        contributedBy: r.contributedBy,
        contributedByName: r.contributedByName,
        note: r.note,
      });
    }
    const leader = ranked.standings.find((s) => s.memberId === ranked.leaderId);
    const data: GetPotData = {
      year: scope.view.year,
      prizeMode: scope.view.prizeMode,
      totalCents: running,
      months,
      leader: leader
        ? {
            memberId: leader.memberId,
            displayName: leader.displayName,
            points: leader.points,
          }
        : null,
    };
    return { ok: true, data };
  },
});
