import { z } from "zod";
import { berlinMonthKey, seasonYear } from "@baumy/core";
import { findActiveMember } from "@baumy/db/members";
import { addPotContribution as insertPotContribution } from "@baumy/db/scores";
import { ensureSeason } from "@baumy/db/seasons";
import { PotAmountCents, PotMonth, PotNote, potMonthDate } from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// A month's money into the year-end pot (SPEC §4.5). The pot is a ledger
// only: the money moves at the bank. Admin only and UI only (SPEC §12
// decision 10). The month picks the season: this year's pot, or last year's
// until that season closes (a December payment logged in January).

export interface AddPotContributionData {
  contributionId: string;
  month: string;
  amountCents: number;
  contributedBy: string;
}

export const addPotContribution = defineAction({
  name: "add_pot_contribution",
  title: "Add to the pot",
  description:
    "Records a monthly contribution to the season's savings pot: the month (YYYY-MM), the amount in euros, who paid it (default: you) and an optional note.",
  consent: "Record money paid into the pot",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input: z.strictObject({
    month: PotMonth,
    amount: PotAmountCents,
    contributedBy: z.uuid("Pick a member.").optional(),
    note: PotNote.optional(),
  }),
  async execute(ctx, input) {
    const payer = input.contributedBy ?? ctx.actor.memberId!;
    const member = await findActiveMember(ctx.db, ctx.householdId, payer);
    if (!member) return fail("NOT_FOUND", "That member was not found.");

    // "YYYY-MM" strings order like the months they name.
    if (input.month > berlinMonthKey(ctx.now)) {
      return fail(
        "FUTURE",
        "That month has not started yet. Record it once it has.",
      );
    }
    const current = seasonYear(ctx.now);
    const year = Number(input.month.slice(0, 4));
    if (year < current - 1) {
      return fail(
        "SEASON_CLOSED",
        `The ${year} pot is closed. Record money for this year's pot.`,
      );
    }
    const season = await ensureSeason(ctx.db, {
      householdId: ctx.householdId,
      year,
      now: ctx.now,
    });
    if (season.status === "closed") {
      return fail(
        "SEASON_CLOSED",
        `The ${year} pot is closed. Record money for this year's pot.`,
      );
    }
    const note = input.note && input.note !== "" ? input.note : null;
    const row = await insertPotContribution(ctx.db, {
      seasonId: season.id,
      month: potMonthDate(input.month),
      amountCents: input.amount,
      contributedBy: member.id,
      note,
      now: ctx.now,
    });
    const data: AddPotContributionData = {
      contributionId: row.id,
      month: input.month,
      amountCents: row.amountCents,
      contributedBy: row.contributedBy,
    };
    return {
      ok: true,
      data,
      audit: { entity: "pot_contribution", entityId: row.id },
    };
  },
});
