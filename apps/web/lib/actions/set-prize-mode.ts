import { z } from "zod";
import { seasonYear } from "@baumy/core";
import { setPrizeMode as writePrizeMode } from "@baumy/db/scores";
import { ensureSeason } from "@baumy/db/seasons";
import { PrizeMode } from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// How the year-end pot is won (SPEC §4.5). v1 plays only `points`, winner
// takes all; the other modes are reserved and refused. The current season's
// mode locks at its first completion; next year's season (created here if
// nobody has yet) can always be set. Admin only and UI only (SPEC §12
// decision 10).

export interface SetPrizeModeData {
  year: number;
  prizeMode: PrizeMode;
}

export const setPrizeMode = defineAction({
  name: "set_prize_mode",
  title: "Set the prize mode",
  description:
    "Sets how the season's pot is won, for the current season (only before its first completion) or next year's. Only points (winner takes all) is played in v1.",
  consent: "Change how the season's pot is won",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({
    season: z.enum(["current", "next"], {
      error: "Pick this season or next.",
    }),
    mode: PrizeMode,
  }),
  async execute(ctx, input) {
    if (input.mode !== "points") {
      return fail(
        "PRIZE_MODE_NOT_SUPPORTED",
        "Only points (winner takes all) is played for now.",
      );
    }
    const current = input.season === "current";
    const year = seasonYear(ctx.now) + (current ? 0 : 1);
    const season = await ensureSeason(ctx.db, {
      householdId: ctx.householdId,
      year,
      now: ctx.now,
    });
    const r = await writePrizeMode(ctx.db, {
      seasonId: season.id,
      mode: input.mode,
      lockOnFirstCompletion: current,
    });
    if (!r.ok) {
      return fail(
        "PRIZE_MODE_LOCKED",
        `The ${year} season has started, so its prize mode is fixed. You can still set next year's.`,
      );
    }
    const data: SetPrizeModeData = { year, prizeMode: r.season.prizeMode };
    return {
      ok: true,
      data,
      audit: { entity: "season", entityId: season.id },
    };
  },
});
