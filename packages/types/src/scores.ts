import { z } from "zod";

// The scoreboard's admin inputs at their boundaries (SPEC §4.5, §5
// `point_adjustments`, `pot_contributions`, `seasons.prize_mode`): the forms
// on /scores and /pot, `adjust_points`, `add_pot_contribution` and
// `set_prize_mode` all parse with these. Numbers are coerced because form
// fields arrive as strings.

/** The same values as the `prize_mode` pg enum. v1 plays only `points`. */
export const PrizeMode = z.enum(
  ["points", "heaviest_streak", "longest_streak"],
  {
    error: "Pick a prize mode.",
  },
);
export type PrizeMode = z.infer<typeof PrizeMode>;

export const ADJUSTMENT_POINTS_MAX = 5000;

/** Points added to (or, negative, taken from) a member's season total. */
export const AdjustmentPoints = z.coerce
  .number({ error: "Enter a number of points." })
  .int("Use a whole number.")
  .min(-ADJUSTMENT_POINTS_MAX, `At least -${ADJUSTMENT_POINTS_MAX}.`)
  .max(ADJUSTMENT_POINTS_MAX, `At most ${ADJUSTMENT_POINTS_MAX}.`)
  .refine((n) => n !== 0, "An adjustment of 0 changes nothing.");

export const ADJUSTMENT_REASON_MAX = 200;

/** Why the points change: required, so the household can see why. */
export const AdjustmentReason = z
  .string({ error: "Say why." })
  .trim()
  .min(1, "Say why.")
  .max(
    ADJUSTMENT_REASON_MAX,
    `Keep it to ${ADJUSTMENT_REASON_MAX} characters.`,
  );

/** A calendar month, "YYYY-MM" (what `<input type="month">` sends). */
export const PotMonth = z
  .string({ error: "Pick a month." })
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month.");

/** At most €10,000 in one go, a typo guard. */
export const POT_AMOUNT_MAX_CENTS = 1_000_000;

/**
 * An amount of euros, "25", "25.5" or "25,50", as whole cents. The pot is a
 * ledger only (SPEC §11): the money moves at the bank.
 */
export const PotAmountCents = z
  .union([z.string(), z.number()], { error: "Enter an amount in euros." })
  .transform((v, ctx) => {
    const s = String(v).trim().replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(s)) {
      ctx.addIssue({
        code: "custom",
        message: "Enter an amount in euros, like 25 or 25.50.",
      });
      return z.NEVER;
    }
    const [whole, frac = ""] = s.split(".");
    return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  })
  .pipe(
    z
      .number()
      .min(1, "Enter more than zero.")
      .max(POT_AMOUNT_MAX_CENTS, "At most €10,000 at once."),
  );

export const POT_NOTE_MAX = 200;

export const PotNote = z
  .string()
  .trim()
  .max(POT_NOTE_MAX, `Keep it to ${POT_NOTE_MAX} characters.`);

/** "2026-09" as the `pot_contributions.month` date, "2026-09-01". */
export function potMonthDate(month: string): string {
  return `${month}-01`;
}
