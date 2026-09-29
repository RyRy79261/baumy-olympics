import { z } from "zod";
import {
  choreNameTaken,
  createChore,
  lockChoreRow,
  setChoreArchived,
  updateChore,
} from "@baumy/db/chores";
import {
  BasePoints,
  ChoreIcon,
  ChoreKind,
  ChoreName,
  ConfirmMode,
  CooldownHours,
  EffortFactorPct,
  ProofMode,
  cooldownMinutesFromHours,
} from "@baumy/types";
import { defineAction } from "./define";
import { fail } from "./result";

// /admin/chores (SPEC §4.4, §12 decision 10): create a chore, edit its
// settings and weight, archive it or bring it back. Admin only and UI only,
// never the AI command, MCP or brain. A weight change is a new `manual` rule
// version in effect from now, so no completion already scored changes.

const choreId = z.uuid("Pick a chore.");

const settings = {
  name: ChoreName,
  basePoints: BasePoints,
  cooldownHours: CooldownHours,
  proofMode: ProofMode,
  confirmMode: ConfirmMode,
  effortFactorPct: EffortFactorPct,
};

const input = z.discriminatedUnion(
  "op",
  [
    z.strictObject({
      op: z.literal("create"),
      ...settings,
      kind: ChoreKind.default("maintenance"),
      proofMode: ProofMode.default("none"),
      confirmMode: ConfirmMode.default("optimistic"),
      effortFactorPct: EffortFactorPct.default(100),
      // Without one, the chore's sprite is its name's slug (spriteFor).
      sprite: ChoreIcon.optional(),
    }),
    // A kind or an icon left out is kept as it is. So is the weight when
    // both points and cooldown are left out: the Bounties page changes
    // points only through a scheduled weight change (issue #109).
    z.strictObject({
      op: z.literal("update"),
      choreId,
      ...settings,
      basePoints: BasePoints.optional(),
      cooldownHours: CooldownHours.optional(),
      kind: ChoreKind.optional(),
      sprite: ChoreIcon.optional(),
    }),
    z.strictObject({ op: z.literal("archive"), choreId }),
    z.strictObject({ op: z.literal("restore"), choreId }),
  ],
  { error: "Pick what to change." },
);

export interface ManageChoreData {
  choreId: string;
  name: string;
  archived: boolean;
  /** True when a new rule version was added. */
  weightChanged: boolean;
}

/** A sprite id for a new chore: its name as a lowercase slug. */
export function spriteFor(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "chore";
}

const nameTaken = (name: string) =>
  fail(
    "CHORE_NAME_TAKEN",
    `There is already a chore called ${name}. Pick another name.`,
  );

export const manageChore = defineAction({
  name: "manage_chore",
  title: "Manage chores",
  description:
    "Creates a household chore, edits its name, kind (consumable or maintenance), icon, points, cooldown, proof mode, confirm mode and effort factor, or archives or restores it.",
  consent: "Manage the household's chores",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input,
  async execute(ctx, change) {
    const admin = ctx.actor.memberId!;
    if (change.op === "create") {
      if (
        await choreNameTaken(ctx.db, {
          householdId: ctx.householdId,
          name: change.name,
        })
      ) {
        return nameTaken(change.name);
      }
      const chore = await createChore(ctx.db, {
        householdId: ctx.householdId,
        name: change.name,
        kind: change.kind,
        sprite: change.sprite ?? spriteFor(change.name),
        proofMode: change.proofMode,
        confirmMode: change.confirmMode,
        effortFactorPct: change.effortFactorPct,
        basePoints: change.basePoints,
        cooldownMinutes: cooldownMinutesFromHours(change.cooldownHours),
        createdBy: admin,
        now: ctx.now,
      });
      const data: ManageChoreData = {
        choreId: chore.id,
        name: chore.name,
        archived: false,
        weightChanged: true,
      };
      return {
        ok: true,
        data,
        audit: { entity: "chore", entityId: chore.id, payload: change },
      };
    }

    const chore = await lockChoreRow(ctx.db, ctx.householdId, change.choreId);
    if (!chore) return fail("NOT_FOUND", "That chore was not found.");

    let data: ManageChoreData;
    if (change.op === "update") {
      if (
        (change.basePoints === undefined) !==
        (change.cooldownHours === undefined)
      ) {
        const message =
          "Give the points and the cooldown together, or leave both out.";
        return fail("INVALID_INPUT", message, {
          issues: [
            {
              path: [
                change.basePoints === undefined
                  ? "basePoints"
                  : "cooldownHours",
              ],
              message,
            },
          ],
        });
      }
      if (
        await choreNameTaken(ctx.db, {
          householdId: ctx.householdId,
          name: change.name,
          exceptId: chore.id,
        })
      ) {
        return nameTaken(change.name);
      }
      const r = await updateChore(ctx.db, {
        householdId: ctx.householdId,
        chore,
        settings: {
          name: change.name,
          ...(change.kind ? { kind: change.kind } : {}),
          ...(change.sprite ? { sprite: change.sprite } : {}),
          proofMode: change.proofMode,
          confirmMode: change.confirmMode,
          effortFactorPct: change.effortFactorPct,
        },
        weight:
          change.basePoints !== undefined && change.cooldownHours !== undefined
            ? {
                basePoints: change.basePoints,
                cooldownMinutes: cooldownMinutesFromHours(change.cooldownHours),
              }
            : undefined,
        createdBy: admin,
        now: ctx.now,
      });
      data = {
        choreId: r.chore.id,
        name: r.chore.name,
        archived: r.chore.archivedAt !== null,
        weightChanged: r.weightChanged,
      };
    } else {
      const restoring = change.op === "restore";
      if (
        restoring &&
        chore.archivedAt !== null &&
        (await choreNameTaken(ctx.db, {
          householdId: ctx.householdId,
          name: chore.name,
          exceptId: chore.id,
        }))
      ) {
        return nameTaken(chore.name);
      }
      const row = await setChoreArchived(ctx.db, {
        chore,
        archived: !restoring,
        now: ctx.now,
      });
      data = {
        choreId: row.id,
        name: row.name,
        archived: row.archivedAt !== null,
        weightChanged: false,
      };
    }
    return {
      ok: true,
      data,
      audit: { entity: "chore", entityId: chore.id, payload: change },
    };
  },
});
