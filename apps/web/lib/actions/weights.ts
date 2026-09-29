import { z } from "zod";
import {
  formatBerlinDateTime,
  weightChangeAppliesAt,
  type WeightSuggestionStatus,
} from "@baumy/core";
import {
  currentRule,
  dismissSuggestion,
  findSuggestion,
  insertAdminChange,
  lastAppliedAt,
  listPointsHistory,
  listScheduledChanges,
  listWeightPanel,
  lockActiveSuggestion,
  lockSuggestion,
  scheduleSuggestion,
  supersedeSuggestion,
  vetoSuggestion,
  type HistoryMember,
  type PointsChangeOutcome,
  type PointsHistoryEntry,
  type WeightSuggestionRow,
} from "@baumy/db/weights";
import { lockChoreRow } from "@baumy/db/chores";
import {
  BasePoints,
  CooldownHours,
  WeightChangeReason,
  cooldownMinutesFromHours,
} from "@baumy/types";
import { defineAction, type ActionCtx } from "./define";
import { fail } from "./result";

// Frequency-derived weights (SPEC §4.4, issue #17). The daily job computes a
// suggestion per chore each week (packages/db weights.ts); here an admin
// schedules it (as suggested, or edited) or dismisses it, and any other
// member may veto a scheduled change until it applies, at the next Monday
// 00:00 Berlin at least 48h ahead. Scheduling and dismissing are admin
// actions, so UI only (SPEC §12 decision 10); reading the weights and a
// member's veto are also offered to brain (issue #70).
//
// An admin may also set any bounty's points by hand at any time
// (`schedule_points_change`, issue #115, SPEC §12 decision 20): the same
// Monday at least 48h ahead, the same veto and cancel, but no measurement and
// no 28-day spacing. `get_points_history` is every change, for every member
// (in the UI and brain).

const suggestionId = z.uuid("Pick a suggestion.");

/** A stored suggestion as the pages show it. Times are ISO 8601. */
export interface SuggestionView {
  id: string;
  choreId: string;
  /** `measured` (the weekly suggestion) or `admin` (set by hand). */
  origin: "measured" | "admin";
  status: WeightSuggestionStatus;
  computedAt: string;
  /** The measurement: null on an admin's change. */
  sampleIntervals: number[] | null;
  medianIntervalMinutes: number | null;
  rawPoints: number | null;
  currentPoints: number;
  currentCooldownMinutes: number;
  suggestedPoints: number | null;
  suggestedCooldownMinutes: number | null;
  scheduledPoints: number | null;
  scheduledCooldownMinutes: number | null;
  /** Why an admin set these points, if they said. */
  reason: string | null;
  appliesAt: string | null;
  scheduledBy: string | null;
}

export function suggestionView(s: WeightSuggestionRow): SuggestionView {
  return {
    id: s.id,
    choreId: s.choreId,
    origin: s.origin,
    status: s.status,
    computedAt: s.computedAt.toISOString(),
    sampleIntervals: s.sampleIntervals,
    medianIntervalMinutes: s.medianIntervalMinutes,
    rawPoints: s.rawPoints,
    currentPoints: s.currentPoints,
    currentCooldownMinutes: s.currentCooldownMinutes,
    suggestedPoints: s.suggestedPoints,
    suggestedCooldownMinutes: s.suggestedCooldownMinutes,
    scheduledPoints: s.scheduledPoints,
    scheduledCooldownMinutes: s.scheduledCooldownMinutes,
    reason: s.reason,
    appliesAt: s.appliesAt?.toISOString() ?? null,
    scheduledBy: s.scheduledBy,
  };
}

/** One chore on the weights panel. */
export interface WeightRowView {
  choreId: string;
  choreName: string;
  effortFactorPct: number;
  /** The weight in effect now; null before the chore's first version. */
  current: { basePoints: number; cooldownMinutes: number } | null;
  /** Measured at `now`, whether or not a suggestion was stored. */
  live: {
    sampleSize: number;
    /** The winsorised gaps in minutes, oldest first (the sparkline). */
    intervals: number[];
    medianMinutes: number | null;
    rawPoints: number | null;
    /** What the formula says now; null when it says leave it. */
    suggestedPoints: number | null;
    suggestedCooldownMinutes: number | null;
    verdict: "insufficient_data" | "no_change" | "suggest";
  } | null;
  /** The suggestion waiting on people (open or scheduled). */
  suggestion: SuggestionView | null;
  lastAppliedAt: string | null;
}

export interface GetWeightsData {
  chores: WeightRowView[];
  /** Scheduled changes, soonest first, with who may still veto them. */
  scheduled: (SuggestionView & {
    choreName: string;
    /** The asker may veto it (they did not schedule it). */
    canVeto: boolean;
  })[];
}

export const getWeights = defineAction({
  name: "get_weights",
  title: "Weights",
  description:
    "Lists each chore's points and cooldown, how often it is really done (the median gap and the sample), the weight change the frequency formula suggests, and the changes scheduled to apply next Monday.",
  consent: "See the chores' weights and suggested changes",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "brain"],
  requires: "member",
  input: z.strictObject({
    scheduledOnly: z
      .boolean()
      .optional()
      .describe("Only the scheduled changes, without measuring every chore."),
  }),
  async execute(ctx, input) {
    const me = ctx.actor.memberId!;
    const vetoable = (s: WeightSuggestionRow, choreName: string) => ({
      ...suggestionView(s),
      choreName,
      canVeto: s.scheduledBy !== me,
    });
    if (input.scheduledOnly) {
      const rows = await listScheduledChanges(ctx.db, ctx.householdId);
      const data: GetWeightsData = {
        chores: [],
        scheduled: rows.map((r) => vetoable(r, r.choreName)),
      };
      return { ok: true, data };
    }
    const rows = await listWeightPanel(ctx.db, {
      householdId: ctx.householdId,
      now: ctx.now,
    });
    const chores: WeightRowView[] = rows.map((r) => {
      const v = r.live?.verdict;
      return {
        choreId: r.choreId,
        choreName: r.choreName,
        effortFactorPct: r.effortFactorPct,
        current: r.rule,
        live: r.live
          ? {
              sampleSize: r.live.measurement.intervals.length,
              intervals: r.live.measurement.intervals,
              medianMinutes: r.live.measurement.medianMinutes,
              rawPoints:
                v && v.kind !== "insufficient_data" ? v.rawPoints : null,
              suggestedPoints: v?.kind === "suggest" ? v.suggestedPoints : null,
              suggestedCooldownMinutes:
                v?.kind === "suggest" ? v.cooldownMinutes : null,
              verdict: v!.kind,
            }
          : null,
        suggestion: r.active ? suggestionView(r.active) : null,
        lastAppliedAt: r.lastAppliedAt?.toISOString() ?? null,
      };
    });
    const scheduled = rows
      .filter((r) => r.active?.status === "scheduled")
      .map((r) => vetoable(r.active!, r.choreName))
      .sort((a, b) => a.appliesAt!.localeCompare(b.appliesAt!));
    const data: GetWeightsData = { chores, scheduled };
    return { ok: true, data };
  },
});

/** Why a suggestion cannot take a decision, in words. */
function notOpen(s: WeightSuggestionRow) {
  switch (s.status) {
    case "scheduled":
      return "That change is already scheduled.";
    case "applied":
      return "That change has already applied.";
    case "vetoed":
      return "That change was vetoed.";
    case "dismissed":
      return "That suggestion was dismissed.";
    default:
      return "A newer suggestion replaced that one.";
  }
}

async function locked(ctx: ActionCtx, id: string) {
  return lockSuggestion(ctx.db, ctx.householdId, id);
}

export interface WeightDecisionData {
  suggestionId: string;
  choreId: string;
  status: WeightSuggestionStatus;
  /** When a scheduled change applies (ISO 8601), or null. */
  appliesAt: string | null;
  basePoints: number | null;
  cooldownMinutes: number | null;
}

function decision(s: WeightSuggestionRow): WeightDecisionData {
  return {
    suggestionId: s.id,
    choreId: s.choreId,
    status: s.status,
    appliesAt: s.appliesAt?.toISOString() ?? null,
    basePoints: s.scheduledPoints,
    cooldownMinutes: s.scheduledCooldownMinutes,
  };
}

export const scheduleWeight = defineAction({
  name: "schedule_weight",
  title: "Schedule a weight change",
  description:
    "Schedules a suggested weight change, as suggested or edited (points, cooldown in hours). It applies at the next Monday 00:00 Berlin at least 48h ahead, and at least 28 days after the chore's last change, unless another member vetoes it first.",
  consent: "Change how many points a chore is worth",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({
    suggestionId,
    basePoints: BasePoints.optional(),
    cooldownHours: CooldownHours.optional(),
  }),
  async execute(ctx, input) {
    // Chore first, then the suggestion: the weekly compute locks in that
    // order too, so the two cannot deadlock.
    const found = await findSuggestion(
      ctx.db,
      ctx.householdId,
      input.suggestionId,
    );
    if (!found) return fail("NOT_FOUND", "That suggestion was not found.");
    const chore = await lockChoreRow(ctx.db, ctx.householdId, found.choreId);
    const s = (await locked(ctx, found.id))!;
    if (s.status !== "open") return fail("INVALID_STATE", notOpen(s));
    if (chore!.archivedAt) {
      return fail("ARCHIVED_CHORE", "That chore is archived.");
    }
    const rule = await currentRule(ctx.db, s.choreId, ctx.now);
    if (
      !rule ||
      rule.basePoints !== s.currentPoints ||
      rule.cooldownMinutes !== s.currentCooldownMinutes
    ) {
      return fail(
        "INVALID_STATE",
        "The chore's points changed since this was suggested. Next Monday's suggestion will start from the new points.",
      );
    }
    const appliesAt = weightChangeAppliesAt({
      now: ctx.now,
      lastAppliedAt: await lastAppliedAt(ctx.db, s.choreId),
    });
    const row = await scheduleSuggestion(ctx.db, {
      suggestionId: s.id,
      // An open suggestion is always a measured one, with its numbers.
      basePoints: input.basePoints ?? s.suggestedPoints!,
      cooldownMinutes:
        input.cooldownHours === undefined
          ? s.suggestedCooldownMinutes!
          : cooldownMinutesFromHours(input.cooldownHours),
      appliesAt,
      scheduledBy: ctx.actor.memberId!,
      now: ctx.now,
    });
    // Unreachable while the row lock holds; kept as the compare-and-set.
    if (!row) return fail("INVALID_STATE", "Someone else just changed this.");
    return {
      ok: true,
      data: decision(row),
      audit: { entity: "weight_suggestion", entityId: row.id },
    };
  },
});

export const schedulePointsChange = defineAction({
  name: "schedule_points_change",
  title: "Change a bounty's points",
  description:
    "Schedules new points and a new cooldown (in hours) for any bounty, with an optional reason. It applies at the next Monday 00:00 Berlin at least 48h ahead, unless another member vetoes it first. A bounty has one change waiting at a time; this one replaces the week's open suggestion.",
  consent: "Change how many points a chore is worth",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({
    choreId: z.uuid("Pick a bounty."),
    basePoints: BasePoints,
    cooldownHours: CooldownHours,
    reason: WeightChangeReason.optional(),
  }),
  async execute(ctx, input) {
    // The chore's lock first, then its waiting suggestion: the order the
    // weekly compute and the other weight writes keep.
    const chore = await lockChoreRow(ctx.db, ctx.householdId, input.choreId);
    if (!chore) return fail("NOT_FOUND", "That bounty was not found.");
    if (chore.archivedAt) {
      return fail(
        "ARCHIVED_CHORE",
        "That bounty is archived. Restore it on Edit chores first.",
      );
    }
    const rule = await currentRule(ctx.db, chore.id, ctx.now);
    if (!rule) {
      return fail(
        "NO_RULE_VERSION",
        "That bounty has no points yet. Give it some on Edit chores.",
      );
    }
    const cooldownMinutes = cooldownMinutesFromHours(input.cooldownHours);
    if (
      rule.basePoints === input.basePoints &&
      rule.cooldownMinutes === cooldownMinutes
    ) {
      return fail(
        "NO_CHANGE",
        `${chore.name} is already worth ${rule.basePoints} pts with that cooldown.`,
      );
    }
    const active = await lockActiveSuggestion(ctx.db, chore.id);
    if (active?.status === "scheduled") {
      return fail(
        "CHANGE_PENDING",
        `A change to ${chore.name} is already scheduled (${active.currentPoints} → ${active.scheduledPoints} pts, ${formatBerlinDateTime(active.appliesAt!)} Berlin time). Cancel it first, or let it land.`,
      );
    }
    // An admin's numbers replace the week's open suggestion.
    if (active) await supersedeSuggestion(ctx.db, active.id);
    const reason = input.reason ? input.reason : null;
    const row = await insertAdminChange(ctx.db, {
      householdId: ctx.householdId,
      choreId: chore.id,
      currentPoints: rule.basePoints,
      currentCooldownMinutes: rule.cooldownMinutes,
      basePoints: input.basePoints,
      cooldownMinutes,
      reason,
      // No 28-day spacing for an admin's change (issue #115).
      appliesAt: weightChangeAppliesAt({ now: ctx.now, lastAppliedAt: null }),
      scheduledBy: ctx.actor.memberId!,
      now: ctx.now,
    });
    return {
      ok: true,
      data: decision(row),
      audit: {
        entity: "weight_suggestion",
        entityId: row.id,
        payload: {
          choreId: chore.id,
          fromPoints: rule.basePoints,
          toPoints: input.basePoints,
          fromCooldownMinutes: rule.cooldownMinutes,
          toCooldownMinutes: cooldownMinutes,
          reason,
          appliesAt: row.appliesAt!.toISOString(),
        },
      },
    };
  },
});

export const dismissWeight = defineAction({
  name: "dismiss_weight",
  title: "Dismiss a weight suggestion",
  description:
    "Dismisses a suggested weight change, or cancels a scheduled one before it applies.",
  consent: "Dismiss a suggested weight change",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({ suggestionId }),
  async execute(ctx, input) {
    const s = await locked(ctx, input.suggestionId);
    if (!s) return fail("NOT_FOUND", "That suggestion was not found.");
    if (s.status !== "open" && s.status !== "scheduled") {
      return fail("INVALID_STATE", notOpen(s));
    }
    if (s.status === "scheduled" && s.appliesAt! <= ctx.now) {
      return fail(
        "WINDOW_CLOSED",
        "That change is due now, so it can no longer be cancelled.",
      );
    }
    const row = await dismissSuggestion(ctx.db, {
      suggestionId: s.id,
      dismissedBy: ctx.actor.memberId!,
      now: ctx.now,
    });
    if (!row) return fail("INVALID_STATE", "Someone else just changed this.");
    return {
      ok: true,
      data: decision(row),
      audit: { entity: "weight_suggestion", entityId: row.id },
    };
  },
});

export const vetoWeight = defineAction({
  name: "veto_weight",
  title: "Veto a weight change",
  description:
    "Vetoes a scheduled weight change before it applies. Only a member other than the one who scheduled it can veto it; a vetoed change never applies.",
  consent: "Veto a scheduled weight change",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "brain"],
  requires: "member",
  input: z.strictObject({ suggestionId }),
  async execute(ctx, input) {
    const s = await locked(ctx, input.suggestionId);
    if (!s) return fail("NOT_FOUND", "That change was not found.");
    if (s.status !== "scheduled") {
      return fail(
        "INVALID_STATE",
        s.status === "open" ? "That change is not scheduled." : notOpen(s),
      );
    }
    if (s.appliesAt! <= ctx.now) {
      return fail(
        "WINDOW_CLOSED",
        `The veto window closed at ${formatBerlinDateTime(s.appliesAt!)} (Berlin time).`,
      );
    }
    const me = ctx.actor.memberId!;
    if (s.scheduledBy === me) {
      return fail(
        "SELF_VETO",
        "You scheduled this change, so another member has to veto it. You can cancel it on the weights page instead.",
      );
    }
    const row = await vetoSuggestion(ctx.db, {
      suggestionId: s.id,
      vetoedBy: me,
      now: ctx.now,
    });
    if (!row) return fail("INVALID_STATE", "Someone else just changed this.");
    return {
      ok: true,
      data: decision(row),
      audit: { entity: "weight_suggestion", entityId: row.id },
    };
  },
});

/** One change on a bounty's points history. Times are ISO 8601. */
export interface PointsHistoryView {
  key: string;
  choreId: string;
  choreName: string;
  source: PointsHistoryEntry["source"];
  suggestionId: string | null;
  proposedBy: HistoryMember | null;
  proposedAt: string;
  fromPoints: number | null;
  fromCooldownMinutes: number | null;
  toPoints: number;
  toCooldownMinutes: number;
  reason: string | null;
  appliesAt: string;
  outcome: PointsChangeOutcome;
  decidedBy: HistoryMember | null;
  decidedAt: string | null;
}

export function historyView(e: PointsHistoryEntry): PointsHistoryView {
  return {
    ...e,
    proposedAt: e.proposedAt.toISOString(),
    appliesAt: e.appliesAt.toISOString(),
    decidedAt: e.decidedAt?.toISOString() ?? null,
  };
}

export interface GetPointsHistoryData {
  /** Newest first. */
  changes: PointsHistoryView[];
}

export const getPointsHistory = defineAction({
  name: "get_points_history",
  title: "Points history",
  description:
    "Lists every change to the bounties' points, newest first, or one bounty's: who made or scheduled it, the points and cooldown before and after, the reason, when it was proposed and when it applies, and whether it landed, is waiting, was vetoed (by whom, when) or was cancelled.",
  consent: "See how the bounties' points have changed",
  kind: "read",
  risk: "safe",
  // Brain gets every member action (SPEC §12 decision 15).
  surfaces: ["ui", "brain"],
  requires: "member",
  input: z.strictObject({
    choreId: z.uuid("Pick a bounty.").optional(),
  }),
  async execute(ctx, input) {
    const rows = await listPointsHistory(ctx.db, {
      householdId: ctx.householdId,
      ...(input.choreId ? { choreId: input.choreId } : {}),
    });
    const data: GetPointsHistoryData = { changes: rows.map(historyView) };
    return { ok: true, data };
  },
});
