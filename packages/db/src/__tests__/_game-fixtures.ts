import { HOUSEHOLD_ID } from "../household";
import type { Queryable } from "../index";
import { choreRuleVersions, chores, members } from "../schema";

// Arrangements for the game tests (PGlite and Docker Postgres, db and web).

const HOUR_MIN = 60;

/** SPEC §4.7 seed values, which the E-examples in §4.6 are written against. */
export const SEED_CHORES = {
  trash: { name: "Trash", basePoints: 20, cooldownMinutes: 48 * HOUR_MIN },
  dishes: { name: "Dishes", basePoints: 10, cooldownMinutes: 12 * HOUR_MIN },
  bathroom: {
    name: "Bathroom",
    basePoints: 26,
    cooldownMinutes: 84 * HOUR_MIN,
  },
} as const;

/** Long before any test's clock, so the version is in effect throughout. */
export const RULES_FROM = new Date("2020-01-01T00:00:00Z");

let seq = 0;

export async function seedPlayer(
  db: Queryable,
  displayName = "Player",
): Promise<string> {
  seq += 1;
  const [row] = await db
    .insert(members)
    .values({
      householdId: HOUSEHOLD_ID,
      authUserId: `game_${seq}_${Math.random().toString(36).slice(2)}`,
      displayName,
      avatarSprite: "cat",
      color: "#336699",
    })
    .returning({ id: members.id });
  return row!.id;
}

export interface SeedChoreInput {
  name: string;
  basePoints: number;
  cooldownMinutes: number;
  confirmMode?: "optimistic" | "partner";
  proofMode?: "none" | "optional" | "required";
  archivedAt?: Date | null;
  effectiveFrom?: Date;
  householdId?: string;
}

/** A chore with one `seed` rule version. */
export async function seedChore(
  db: Queryable,
  input: SeedChoreInput,
): Promise<{ choreId: string; ruleVersionId: string }> {
  const [chore] = await db
    .insert(chores)
    .values({
      householdId: input.householdId ?? HOUSEHOLD_ID,
      name: input.name,
      sprite: input.name.toLowerCase(),
      confirmMode: input.confirmMode ?? "optimistic",
      proofMode: input.proofMode ?? "none",
      archivedAt: input.archivedAt ?? null,
    })
    .returning({ id: chores.id });
  const [rule] = await db
    .insert(choreRuleVersions)
    .values({
      choreId: chore!.id,
      effectiveFrom: input.effectiveFrom ?? RULES_FROM,
      basePoints: input.basePoints,
      cooldownMinutes: input.cooldownMinutes,
      source: "seed",
    })
    .returning({ id: choreRuleVersions.id });
  return { choreId: chore!.id, ruleVersionId: rule!.id };
}
