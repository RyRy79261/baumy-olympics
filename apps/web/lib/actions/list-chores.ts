import { z } from "zod";
import {
  choreTiming,
  expectedIntervalMinutes,
  nextScore,
  type ChoreDueState,
} from "@baumy/core";
import { listChoreBoard } from "@baumy/db/chores";
import type { ChoreKind, ConfirmMode, ProofMode } from "@baumy/types";
import { isNewChore, isUrgent } from "@/lib/chores/urgency";
import { defineAction } from "./define";

// The chore grid (SPEC §3.1, §3.2), on every surface: each chore with its
// points, who holds its streak and for how long, whether it is due, and what
// logging it now would score for the member asking. The AI reads it to find
// chore ids; the grid builds its tiles and previews from it.
//
// The kitchen screen shows chores as bounties (ADR 0005): each has a kind,
// and `urgent` and `isNew` (lib/chores/urgency.ts) are what its Urgent and
// New icons count.

/** What logging a chore now would score (`nextScore` in packages/core). */
export interface NextScoreView {
  totalPts: number;
  streakLen: number;
  streakPts: number;
  breakPts: number;
  brokenMemberId: string | null;
  brokenLen: number | null;
}

export interface ChoreView {
  id: string;
  name: string;
  sprite: string;
  /** Consumable (buy or refill) or maintenance (clean or fix). */
  kind: ChoreKind;
  proofMode: ProofMode;
  confirmMode: ConfirmMode;
  effortFactorPct: number;
  archived: boolean;
  /** Null only while no weight is in effect yet. */
  basePoints: number | null;
  cooldownMinutes: number | null;
  /** The interval the weight implies (`expectedIntervalMinutes`). */
  intervalMinutes: number | null;
  streak: { holderId: string; holderName: string; length: number } | null;
  /** ISO 8601 instants. */
  lastDoneAt: string | null;
  state: ChoreDueState | "unavailable";
  availableAt: string | null;
  dueAt: string | null;
  /**
   * Overdue on its own rhythm: its last completion plus the larger of
   * `intervalMinutes` and `cooldownMinutes` has passed or falls before
   * Berlin midnight (`isUrgent`). Never for a chore never done.
   */
  urgent: boolean;
  /** Created in the last 3 days (`NEW_BOUNTY_MS`). */
  isNew: boolean;
  /** When it was added, ISO 8601. */
  createdAt: string;
  /**
   * For the member asking; null when the chore cannot be scored now, or when
   * nobody is asking (the kitchen screen before anyone taps in).
   */
  next: NextScoreView | null;
}

export interface ListChoresData {
  chores: ChoreView[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const listChores = defineAction({
  name: "list_chores",
  title: "List chores",
  description:
    "Lists the household's chores with their ids, kind (consumable: buy or refill; maintenance: clean or fix), base points, cooldown, who holds each chore's streak this season and how long it is, whether each is due, cooling down (with availableAt) or done for now, `urgent` (overdue on its own rhythm: its last completion plus the larger of its interval and its cooldown has passed, or falls before midnight in Berlin; a chore never done is never urgent), `isNew` (added in the last 3 days), `createdAt`, and `next`: what logging it right now would score for you (total points, streak length, break bonus). Times are ISO 8601 in UTC; the household lives in Europe/Berlin. Archived chores are left out unless includeArchived is true.",
  consent: "See the household's chores, streaks and points",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  // The kitchen screen shows the due chores before anyone taps in.
  requires: "display",
  input: z.strictObject({
    includeArchived: z
      .boolean()
      .optional()
      .describe("Also list archived chores. Default false."),
  }),
  async execute(ctx, input) {
    // Nobody, on the kiosk before anyone taps their avatar: no `next` then.
    const me = ctx.actor.memberId;
    const board = await listChoreBoard(ctx.db, {
      householdId: ctx.householdId,
      now: ctx.now,
      includeArchived: input.includeArchived ?? false,
    });
    const data: ListChoresData = {
      chores: board.map((c): ChoreView => {
        const interval = c.rule
          ? expectedIntervalMinutes(c.rule.basePoints, c.effortFactorPct)
          : null;
        const timing = c.rule
          ? choreTiming({
              lastDoneAt: c.lastDoneAt,
              cooldownMinutes: c.rule.cooldownMinutes,
              intervalMinutes: interval!,
              now: ctx.now,
            })
          : null;
        const scorable = c.rule !== null && c.archivedAt === null;
        const next =
          scorable && me ? nextScore(c.rule!.basePoints, c.streak, me) : null;
        const state = scorable && timing ? timing.state : "unavailable";
        const dueAt = iso(timing?.dueAt ?? null);
        return {
          id: c.id,
          name: c.name,
          sprite: c.sprite,
          kind: c.kind,
          proofMode: c.proofMode,
          confirmMode: c.confirmMode,
          effortFactorPct: c.effortFactorPct,
          archived: c.archivedAt !== null,
          basePoints: c.rule?.basePoints ?? null,
          cooldownMinutes: c.rule?.cooldownMinutes ?? null,
          intervalMinutes: interval,
          streak: c.streak,
          lastDoneAt: iso(c.lastDoneAt),
          state,
          availableAt: iso(timing?.availableAt ?? null),
          dueAt,
          urgent: isUrgent(
            { state, dueAt, intervalMinutes: interval },
            ctx.now,
          ),
          isNew: isNewChore(c.createdAt, ctx.now),
          createdAt: c.createdAt.toISOString(),
          next: next
            ? {
                totalPts: next.totalPts,
                streakLen: next.streakLen,
                streakPts: next.streakPts,
                breakPts: next.breakPts,
                brokenMemberId: next.brokenMemberId,
                brokenLen: next.brokenLen,
              }
            : null,
        };
      }),
    };
    return { ok: true, data };
  },
});
