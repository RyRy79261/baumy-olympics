import { z } from "zod";
import { createChore, lockChoreRow, setChoreArchived } from "@baumy/db/chores";
import {
  BasePoints,
  ChoreIcon,
  ChoreKind,
  ChoreName,
  CooldownHours,
  EffortFactorPct,
  ProofMode,
  cooldownMinutesFromHours,
} from "@baumy/types";
import { editBounty, editScope, nameFree } from "@/lib/chores/edit";
import { defineAction, type ActionCtx, type ExecuteResult } from "./define";
import { fail } from "./result";

// /admin/chores (SPEC §4.4, §12 decision 10): create a chore, edit its
// settings and weight, archive it or bring it back. Admin only and UI only,
// never the AI command, MCP or brain: those create and edit bounties with
// create_bounty and update_bounty (bounties.ts, issue #107) and never archive. A weight change is a new `manual` rule
// version in effect from now, so no completion already scored changes.

const choreId = z.uuid("Pick a chore.");

const settings = {
  name: ChoreName,
  basePoints: BasePoints,
  cooldownHours: CooldownHours,
  proofMode: ProofMode,
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
      effortFactorPct: EffortFactorPct.default(100),
      // Without one, the chore's sprite is its name's slug (spriteFor).
      sprite: ChoreIcon.optional(),
    }),
    // A kind or an icon left out is kept as it is. The weight is kept only
    // with `weight: "keep"` and neither points nor cooldown: the Bounties
    // page changes points only through a scheduled change (issues #109 and
    // #115). Without it both are required, so a form whose two fields were
    // cleared says so instead of quietly keeping the old weight.
    z.strictObject({
      op: z.literal("update"),
      choreId,
      ...settings,
      basePoints: BasePoints.optional(),
      cooldownHours: CooldownHours.optional(),
      weight: z.literal("keep").optional(),
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

/** A new chore's parsed settings, with its first weight. */
export interface NewChore {
  name: string;
  kind: ChoreKind;
  basePoints: number;
  cooldownHours: number;
  proofMode: ProofMode;
  effortFactorPct: number;
  /** Without one, the chore's sprite is its name's slug (spriteFor). */
  sprite?: string;
}

/**
 * Create a chore by the acting admin, unless another active chore has its
 * name. Shared by manage_chore and create_bounty (issue #107).
 */
export async function createChoreBy(
  ctx: ActionCtx,
  change: NewChore,
): Promise<ExecuteResult<ManageChoreData>> {
  const taken = await nameFree(ctx, change.name);
  if (taken) return taken;
  const chore = await createChore(ctx.db, {
    householdId: ctx.householdId,
    name: change.name,
    kind: change.kind,
    sprite: change.sprite ?? spriteFor(change.name),
    proofMode: change.proofMode,
    effortFactorPct: change.effortFactorPct,
    basePoints: change.basePoints,
    cooldownMinutes: cooldownMinutesFromHours(change.cooldownHours),
    createdBy: ctx.actor.memberId!,
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

export const manageChore = defineAction({
  name: "manage_chore",
  title: "Manage chores",
  description:
    "Creates a household chore, edits its name, kind (consumable or maintenance), icon, points, cooldown, proof mode and effort factor, or archives or restores it.",
  consent: "Manage the household's chores",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui"],
  requires: "admin",
  input,
  async execute(ctx, change) {
    if (change.op === "create") return createChoreBy(ctx, change);

    const chore = await lockChoreRow(ctx.db, ctx.householdId, change.choreId);
    if (!chore) return fail("NOT_FOUND", "That chore was not found.");

    let data: ManageChoreData;
    if (change.op === "update") {
      // Whether this form carries a weight at all is the input's own rule;
      // half of one is the edit rules' (lib/chores/edit.ts).
      const noWeight =
        change.basePoints === undefined && change.cooldownHours === undefined;
      if (change.weight === "keep" ? !noWeight : noWeight) {
        const message =
          change.weight === "keep"
            ? "Leave the points and the cooldown out to keep them."
            : "Required: give the points and the cooldown.";
        return fail("INVALID_INPUT", message, {
          issues: [
            { path: ["basePoints"], message },
            { path: ["cooldownHours"], message },
          ],
        });
      }
      // The admin chores page edits an archived chore too, and refuses half
      // a weight rather than keeping the other half.
      const r = await editBounty(
        editScope(ctx),
        chore,
        {
          name: change.name,
          kind: change.kind,
          sprite: change.sprite,
          proofMode: change.proofMode,
          effortFactorPct: change.effortFactorPct,
          points: change.basePoints,
          cooldownHours: change.cooldownHours,
        },
        { halves: "together", archived: "edit", names: "now" },
      );
      if (!r.ok) return r;
      data = {
        choreId: r.chore.id,
        name: r.chore.name,
        archived: r.chore.archivedAt !== null,
        weightChanged: r.weightChanged,
      };
    } else {
      const restoring = change.op === "restore";
      if (restoring && chore.archivedAt !== null) {
        const taken = await nameFree(ctx, chore.name, chore.id);
        if (taken) return taken;
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
