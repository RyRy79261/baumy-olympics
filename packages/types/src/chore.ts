import { z } from "zod";

// A chore at its boundaries (SPEC §5 `chores`, `chore_rule_versions`): the
// admin chores page, `manage_chore` and `log_completion` all parse with
// these. Numbers are coerced because form fields arrive as strings; the AI
// and MCP send numbers.

export const CHORE_NAME_MAX = 40;

/** What the household calls a chore: trimmed, 1 to 40 characters. */
export const ChoreName = z
  .string()
  .trim()
  .min(1, "Give the chore a name.")
  .max(CHORE_NAME_MAX, `Keep it to ${CHORE_NAME_MAX} characters.`);

/** The same values as the `proof_mode` pg enum. */
export const ProofMode = z.enum(["none", "optional", "required"], {
  error: "Pick none, optional or required.",
});
export type ProofMode = z.infer<typeof ProofMode>;

/**
 * What kind of bounty a chore is (ADR 0005): something to buy or refill, or
 * something to clean or fix. The same values as the `chore_kind` pg enum.
 */
export const CHORE_KINDS = ["consumable", "maintenance"] as const;

export const ChoreKind = z.enum(CHORE_KINDS, {
  error: "Pick consumable or maintenance.",
});
export type ChoreKind = z.infer<typeof ChoreKind>;

/**
 * The icons an admin can give a chore (issue #106): what `chores.sprite`
 * stores when one is picked. Each is a glyph of the same name in the pixel
 * kit (packages/ui pixel/glyphs.ts), which draws it.
 */
export const CHORE_ICONS = [
  "bin",
  "soap",
  "tp",
  "plant",
  "vacuum",
  "litter",
  "catfood",
  "fridge",
  "kettle",
  "coffee",
  "cart",
  "wrench",
] as const;

export const ChoreIcon = z.enum(CHORE_ICONS, {
  error: "Pick one of the icons.",
});
export type ChoreIcon = z.infer<typeof ChoreIcon>;

export const BASE_POINTS_MIN = 1;
export const BASE_POINTS_MAX = 200;

/** Points for one completion before streaks and breaks (the db check). */
export const BasePoints = z.coerce
  .number({ error: "Enter a number of points." })
  .int("Use a whole number.")
  .min(BASE_POINTS_MIN, `At least ${BASE_POINTS_MIN}.`)
  .max(BASE_POINTS_MAX, `At most ${BASE_POINTS_MAX}.`);

export const EFFORT_FACTOR_MIN = 50;
export const EFFORT_FACTOR_MAX = 300;

/** How hard a chore is, in percent, for weight suggestions (the db check). */
export const EffortFactorPct = z.coerce
  .number({ error: "Enter a percentage." })
  .int("Use a whole number.")
  .min(EFFORT_FACTOR_MIN, `At least ${EFFORT_FACTOR_MIN}%.`)
  .max(EFFORT_FACTOR_MAX, `At most ${EFFORT_FACTOR_MAX}%.`);

export const COOLDOWN_HOURS_MAX = 30 * 24;

/**
 * How long after a completion nobody may log the chore again, in hours
 * (fractions allowed: 3.5 days is 84). Stored in minutes.
 */
export const CooldownHours = z.coerce
  .number({ error: "Enter a number of hours." })
  .min(0, "Zero or more hours.")
  .max(COOLDOWN_HOURS_MAX, `At most ${COOLDOWN_HOURS_MAX} hours (30 days).`);

/** Hours as the whole minutes `chore_rule_versions.cooldown_minutes` holds. */
export function cooldownMinutesFromHours(hours: number): number {
  return Math.round(hours * 60);
}

export const COMPLETION_NOTE_MAX = 280;

/** An optional note on a completion. */
export const CompletionNote = z
  .string()
  .trim()
  .max(COMPLETION_NOTE_MAX, `Keep it to ${COMPLETION_NOTE_MAX} characters.`);

export const DISPUTE_REASON_MAX = 280;

/** Why a housemate disputes a claim: required, trimmed (the db check). */
export const DisputeReason = z
  .string({ error: "Say why you are disputing it." })
  .trim()
  .min(1, "Say why you are disputing it.")
  .max(DISPUTE_REASON_MAX, `Keep it to ${DISPUTE_REASON_MAX} characters.`);

export const WEIGHT_CHANGE_REASON_MAX = 280;

/**
 * Why an admin changes a bounty's points (issue #115): optional and trimmed,
 * so a blank one is no reason at all. Shown in the points history.
 */
export const WeightChangeReason = z
  .string()
  .trim()
  .max(
    WEIGHT_CHANGE_REASON_MAX,
    `Keep it to ${WEIGHT_CHANGE_REASON_MAX} characters.`,
  );
