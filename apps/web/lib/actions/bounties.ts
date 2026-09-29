import { z } from "zod";
import {
  choreNameTaken,
  findChoreWithWeight,
  lockChoreRow,
  updateChore,
} from "@baumy/db/chores";
import {
  BasePoints,
  ChoreKind,
  ChoreName,
  ConfirmMode,
  CooldownHours,
  EffortFactorPct,
  ProofMode,
  cooldownMinutesFromHours,
} from "@baumy/types";
import { defineAction } from "./define";
import { createChoreBy, nameTaken, type ManageChoreData } from "./manage-chore";
import { fail } from "./result";

// Baumy's bounty writes (issue #107, SPEC §12 decision 10 as amended
// 2026-09-29): add a bounty or edit one, from the AI command (a proposal an
// admin approves) or brain (behind its confirm button, in the admin's own
// name only). Flat inputs an LLM fills easily; archiving stays in the admin
// page's manage_chore. Both are admin only, like manage_chore.

/** 24h, the admin form's default cooldown. */
export const DEFAULT_COOLDOWN_HOURS = 24;

const fields = {
  name: ChoreName.describe("What the bounty is called, e.g. Recycling."),
  kind: ChoreKind.describe(
    "consumable (something to buy or refill) or maintenance (something to clean or fix).",
  ),
  points: BasePoints.describe("Base points for doing it, 1 to 200."),
  cooldownHours: CooldownHours.describe(
    "Hours before it scores again (0 to 720).",
  ),
  proofMode: ProofMode.describe(
    "Whether a proof photo is none, optional or required.",
  ),
  confirmMode: ConfirmMode.describe(
    "optimistic (counts at once) or partner (counts once a housemate confirms).",
  ),
  effortFactorPct: EffortFactorPct.describe(
    "The effort factor in percent (100 is normal).",
  ),
};

/** "Recycling · maintenance · 15 pts", plus what is not the default. */
function describeBounty(b: {
  name?: string;
  kind?: string;
  points?: number;
  cooldownHours?: number;
  proofMode?: string;
  confirmMode?: string;
  effortFactorPct?: number;
}): string[] {
  const parts: string[] = [];
  if (b.name !== undefined) parts.push(b.name);
  if (b.kind !== undefined) parts.push(b.kind);
  if (b.points !== undefined) parts.push(`${b.points} pts`);
  if (b.cooldownHours !== undefined) {
    parts.push(`every ${b.cooldownHours} h`);
  }
  if (b.proofMode !== undefined) parts.push(`photo ${b.proofMode}`);
  if (b.confirmMode !== undefined) {
    parts.push(
      b.confirmMode === "partner" ? "a housemate confirms" : "counts at once",
    );
  }
  if (b.effortFactorPct !== undefined) {
    parts.push(`effort ${b.effortFactorPct}%`);
  }
  return parts;
}

export const createBounty = defineAction({
  name: "create_bounty",
  title: "Add a bounty",
  description:
    "Adds a bounty (a household chore that scores points) to the board: its name, kind (consumable or maintenance, default maintenance), base points, cooldown in hours (default 24), proof mode (default none), confirm mode (default optimistic) and effort factor (default 100). Only a household admin may do this, in their own name.",
  consent: "Add bounties to the board",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "ai", "brain"],
  requires: "admin",
  ownWordOnly: true,
  input: z.strictObject({
    name: fields.name,
    kind: fields.kind.default("maintenance"),
    points: fields.points,
    cooldownHours: fields.cooldownHours.default(DEFAULT_COOLDOWN_HOURS),
    proofMode: fields.proofMode.default("none"),
    confirmMode: fields.confirmMode.default("optimistic"),
    effortFactorPct: fields.effortFactorPct.default(100),
  }),
  async preview(_ctx, i) {
    const extras = describeBounty({
      ...(i.cooldownHours !== DEFAULT_COOLDOWN_HOURS
        ? { cooldownHours: i.cooldownHours }
        : {}),
      ...(i.proofMode !== "none" ? { proofMode: i.proofMode } : {}),
      ...(i.confirmMode !== "optimistic" ? { confirmMode: i.confirmMode } : {}),
      ...(i.effortFactorPct !== 100
        ? { effortFactorPct: i.effortFactorPct }
        : {}),
    });
    return `New bounty: ${[i.name, i.kind, `${i.points} pts`, ...extras].join(" · ")}`;
  },
  async execute(ctx, i) {
    return createChoreBy(ctx, {
      name: i.name,
      kind: i.kind,
      basePoints: i.points,
      cooldownHours: i.cooldownHours,
      proofMode: i.proofMode,
      confirmMode: i.confirmMode,
      effortFactorPct: i.effortFactorPct,
    });
  },
});

const updateInput = z
  .strictObject({
    choreId: z.uuid("Pick a bounty."),
    name: fields.name.optional(),
    kind: fields.kind.optional(),
    points: fields.points.optional(),
    cooldownHours: fields.cooldownHours.optional(),
    proofMode: fields.proofMode.optional(),
    confirmMode: fields.confirmMode.optional(),
    effortFactorPct: fields.effortFactorPct.optional(),
  })
  .refine((i) => Object.keys(i).some((k) => k !== "choreId"), {
    error: "Say what to change about the bounty.",
  });

const NOT_FOUND = fail("NOT_FOUND", "That bounty was not found.");
const archived = (name: string) =>
  fail(
    "ARCHIVED_CHORE",
    `${name} is archived. Restore it on the admin page first.`,
  );

export const updateBounty = defineAction({
  name: "update_bounty",
  title: "Edit a bounty",
  description:
    "Edits a bounty on the board (choreId from the context or list_chores): only the fields given change (name, kind, base points, cooldown in hours, proof mode, confirm mode, effort factor). A new weight counts from now; nothing already scored changes. Only a household admin may do this, in their own name.",
  consent: "Edit the bounties on the board",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "ai", "brain"],
  requires: "admin",
  ownWordOnly: true,
  input: updateInput,
  async preview(ctx, i) {
    const found = await findChoreWithWeight(ctx.db, {
      householdId: ctx.householdId,
      choreId: i.choreId,
      now: ctx.now,
    });
    // What execute would refuse, said on the card instead (never run).
    if (!found) return { invalid: NOT_FOUND.message };
    if (found.chore.archivedAt !== null) {
      return { invalid: archived(found.chore.name).message };
    }
    const { choreId: _id, name, ...rest } = i;
    const changes = describeBounty(rest);
    if (name !== undefined && name !== found.chore.name) {
      changes.unshift(`rename to ${name}`);
    }
    return `Edit bounty: ${found.chore.name} → ${changes.join(", ") || "no change"}`;
  },
  async execute(ctx, i) {
    const chore = await lockChoreRow(ctx.db, ctx.householdId, i.choreId);
    if (!chore) return NOT_FOUND;
    if (chore.archivedAt !== null) return archived(chore.name);
    if (
      i.name !== undefined &&
      (await choreNameTaken(ctx.db, {
        householdId: ctx.householdId,
        name: i.name,
        exceptId: chore.id,
      }))
    ) {
      return nameTaken(i.name);
    }

    // Half a weight keeps the other half as it is now.
    let weight: { basePoints: number; cooldownMinutes: number } | undefined;
    if (i.points !== undefined || i.cooldownHours !== undefined) {
      const current = await findChoreWithWeight(ctx.db, {
        householdId: ctx.householdId,
        choreId: chore.id,
        now: ctx.now,
      });
      const was = current?.weight;
      const basePoints = i.points ?? was?.basePoints;
      const cooldownMinutes =
        i.cooldownHours !== undefined
          ? cooldownMinutesFromHours(i.cooldownHours)
          : was?.cooldownMinutes;
      if (basePoints === undefined || cooldownMinutes === undefined) {
        return fail(
          "NO_RULE_VERSION",
          `${chore.name} has no points yet. Give both its points and its cooldown.`,
        );
      }
      weight = { basePoints, cooldownMinutes };
    }

    const r = await updateChore(ctx.db, {
      householdId: ctx.householdId,
      chore,
      settings: {
        ...(i.name !== undefined ? { name: i.name } : {}),
        ...(i.kind !== undefined ? { kind: i.kind } : {}),
        ...(i.proofMode !== undefined ? { proofMode: i.proofMode } : {}),
        ...(i.confirmMode !== undefined ? { confirmMode: i.confirmMode } : {}),
        ...(i.effortFactorPct !== undefined
          ? { effortFactorPct: i.effortFactorPct }
          : {}),
      },
      ...(weight ? { weight } : {}),
      createdBy: ctx.actor.memberId!,
      now: ctx.now,
    });
    const data: ManageChoreData = {
      choreId: r.chore.id,
      name: r.chore.name,
      archived: false,
      weightChanged: r.weightChanged,
    };
    return {
      ok: true,
      data,
      audit: { entity: "chore", entityId: chore.id },
    };
  },
});
