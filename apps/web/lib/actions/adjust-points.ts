import { z } from "zod";
import { seasonYear } from "@baumy/core";
import { findActiveMember } from "@baumy/db/members";
import {
  approveAdjustment,
  createAdjustment,
  lockAdjustment,
} from "@baumy/db/scores";
import {
  ensureSeason,
  lockSeasonShared,
  seasonStatusNow,
} from "@baumy/db/seasons";
import { AdjustmentPoints, AdjustmentReason } from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// A manual change to a member's season total (SPEC §4.5): one admin proposes
// it, a second admin approves it, and only then does it count. Admin only and
// UI only (SPEC §12 decision 10). The database backs the four-eyes rule with
// the `point_adjustments_approver_not_creator` check constraint; this action
// says so in a sentence before the constraint would have to.

const input = z.discriminatedUnion(
  "op",
  [
    z.strictObject({
      op: z.literal("create"),
      memberId: z.uuid("Pick a member."),
      points: AdjustmentPoints,
      reason: AdjustmentReason,
    }),
    z.strictObject({
      op: z.literal("approve"),
      adjustmentId: z.uuid("Pick an adjustment."),
    }),
  ],
  { error: "Pick create or approve." },
);

export interface AdjustPointsData {
  adjustmentId: string;
  memberId: string;
  points: number;
  approved: boolean;
}

export const adjustPoints = defineAction({
  name: "adjust_points",
  title: "Adjust points",
  description:
    "Proposes a change to a member's season points (op create, with a reason), or approves one another admin proposed (op approve). An adjustment counts only once a second admin approves it.",
  consent: "Change a member's season points",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input,
  async execute(ctx, change) {
    const admin = ctx.actor.memberId!;
    if (change.op === "create") {
      const member = await findActiveMember(
        ctx.db,
        ctx.householdId,
        change.memberId,
      );
      if (!member) return fail("NOT_FOUND", "That member was not found.");
      const season = await ensureSeason(ctx.db, {
        householdId: ctx.householdId,
        year: seasonYear(ctx.now),
        now: ctx.now,
      });
      const row = await createAdjustment(ctx.db, {
        seasonId: season.id,
        memberId: member.id,
        points: change.points,
        reason: change.reason,
        createdBy: admin,
        now: ctx.now,
      });
      const data: AdjustPointsData = {
        adjustmentId: row.id,
        memberId: row.memberId,
        points: row.points,
        approved: false,
      };
      return {
        ok: true,
        data,
        audit: { entity: "point_adjustment", entityId: row.id },
      };
    }

    const locked = await lockAdjustment(
      ctx.db,
      ctx.householdId,
      change.adjustmentId,
    );
    if (!locked) return fail("NOT_FOUND", "That adjustment was not found.");
    const { adjustment, season } = locked;
    if (adjustment.approvedBy !== null) {
      return fail("INVALID_STATE", "That adjustment is already approved.");
    }
    if (adjustment.createdBy === admin) {
      return fail(
        "SELF_APPROVAL",
        "You proposed this adjustment, so a second admin has to approve it.",
      );
    }
    // Held until this transaction ends, so the daily job cannot write the
    // winner in between (it skips a season someone holds). Closed is judged
    // at `now`, whether or not the job has written it yet.
    const held = (await lockSeasonShared(ctx.db, season.id)) ?? season;
    if ((await seasonStatusNow(ctx.db, held, ctx.now)) === "closed") {
      return fail(
        "SEASON_CLOSED",
        `The ${season.year} season is closed, so its points can no longer change.`,
      );
    }
    const row = await approveAdjustment(ctx.db, {
      adjustmentId: adjustment.id,
      approvedBy: admin,
      now: ctx.now,
    });
    // Unreachable while the row lock holds; kept as the compare-and-set.
    if (!row) {
      return fail("INVALID_STATE", "That adjustment is already approved.");
    }
    const data: AdjustPointsData = {
      adjustmentId: row.id,
      memberId: row.memberId,
      points: row.points,
      approved: true,
    };
    return {
      ok: true,
      data,
      audit: { entity: "point_adjustment", entityId: row.id },
    };
  },
});
