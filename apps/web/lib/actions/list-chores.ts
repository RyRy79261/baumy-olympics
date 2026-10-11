import { z } from "zod";
import { choreTiming, nextScore, type ChoreState } from "@baumy/core";
import { listChoreBoard } from "@baumy/db/chores";
import type { ChoreKind, ProofMode } from "@baumy/types";
import { defineAction } from "./define";

// The chore grid (SPEC §3.1, §3.2), on every surface: each chore with its
// points, who holds its streak and for how long, whether it is ready or
// cooling down, and what logging it now would score for the member asking.
// A chore has no due date (SPEC §12 decision 35, issue #189). The AI reads it to find
// chore ids; the grid builds its tiles and previews from it.
//
// The kitchen screen shows chores as bounties (ADR 0005), each with a kind.
// There is no "new" bounty (SPEC §12 decision 36, issue #193).

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
  effortFactorPct: number;
  archived: boolean;
  /** Null only while no weight is in effect yet. */
  basePoints: number | null;
  cooldownMinutes: number | null;
  streak: { holderId: string; holderName: string; length: number } | null;
  /** ISO 8601 instants. */
  lastDoneAt: string | null;
  /** Ready to log, cooling down, or not scorable (archived, no weight). */
  state: ChoreState | "unavailable";
  /** While cooling down: when it can be logged again. */
  availableAt: string | null;
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
    "Lists the household's chores with their ids, kind (consumable: buy or refill; maintenance: clean or fix), base points, cooldown, who holds each chore's streak this season and how long it is, its `state`: ready (it can be logged now), cooldown (done recently; it can be logged again from availableAt) or unavailable (no points set, or archived); chores have no due date. Also `createdAt`, and `next`: what logging it right now would score for you (total points, streak length, break bonus). Times are ISO 8601 in UTC; the household lives in Europe/Berlin. Archived chores are left out unless includeArchived is true.",
  consent: "See the household's chores, streaks and points",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  // The kitchen screen shows the bounties before anyone taps in.
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
        const timing = c.rule
          ? choreTiming({
              lastDoneAt: c.lastDoneAt,
              cooldownMinutes: c.rule.cooldownMinutes,
              now: ctx.now,
            })
          : null;
        const scorable = c.rule !== null && c.archivedAt === null;
        const next =
          scorable && me ? nextScore(c.rule!.basePoints, c.streak, me) : null;
        const state = scorable && timing ? timing.state : "unavailable";
        return {
          id: c.id,
          name: c.name,
          sprite: c.sprite,
          kind: c.kind,
          proofMode: c.proofMode,
          effortFactorPct: c.effortFactorPct,
          archived: c.archivedAt !== null,
          basePoints: c.rule?.basePoints ?? null,
          cooldownMinutes: c.rule?.cooldownMinutes ?? null,
          streak: c.streak,
          lastDoneAt: iso(c.lastDoneAt),
          state,
          availableAt: iso(timing?.availableAt ?? null),
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
