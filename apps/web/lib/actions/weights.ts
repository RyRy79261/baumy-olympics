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
  lastAppliedAt,
  listWeightPanel,
  lockSuggestion,
  scheduleSuggestion,
  vetoSuggestion,
  type WeightSuggestionRow,
} from "@baumy/db/weights";
import { lockChoreRow } from "@baumy/db/chores";
import {
  BasePoints,
  CooldownHours,
  cooldownMinutesFromHours,
} from "@baumy/types";
import { defineAction, type ActionCtx } from "./define";
import { fail } from "./result";

// Frequency-derived weights (SPEC §4.4, issue #17). The daily job computes a
// suggestion per chore each week (packages/db weights.ts); here an admin
// schedules it (as suggested, or edited) or dismisses it, and any other
// member may veto a scheduled change until it applies, at the next Monday
// 00:00 Berlin at least 48h ahead. Weights change only in the UI (SPEC §12
// decision 10): every action here is `surfaces: ["ui"]`.

const suggestionId = z.uuid("Pick a suggestion.");

/** A stored suggestion as the pages show it. Times are ISO 8601. */
export interface SuggestionView {
  id: string;
  choreId: string;
  status: WeightSuggestionStatus;
  computedAt: string;
  sampleIntervals: number[];
  medianIntervalMinutes: number;
  rawPoints: number;
  currentPoints: number;
  currentCooldownMinutes: number;
  suggestedPoints: number;
  suggestedCooldownMinutes: number;
  scheduledPoints: number | null;
  scheduledCooldownMinutes: number | null;
  appliesAt: string | null;
  scheduledBy: string | null;
}

function suggestionView(s: WeightSuggestionRow): SuggestionView {
  return {
    id: s.id,
    choreId: s.choreId,
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
  surfaces: ["ui"],
  requires: "member",
  input: z.strictObject({}),
  async execute(ctx) {
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
    const me = ctx.actor.memberId!;
    const scheduled = rows
      .filter((r) => r.active?.status === "scheduled")
      .map((r) => ({
        ...suggestionView(r.active!),
        choreName: r.choreName,
        canVeto: r.active!.scheduledBy !== me,
      }))
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
      basePoints: input.basePoints ?? s.suggestedPoints,
      cooldownMinutes:
        input.cooldownHours === undefined
          ? s.suggestedCooldownMinutes
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
  surfaces: ["ui"],
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
