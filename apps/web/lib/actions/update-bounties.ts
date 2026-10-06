import { z } from "zod";
import {
  choreNameTaken,
  lockChoreRow,
  setChoreArchived,
  type ChoreRow,
} from "@baumy/db/chores";
import {
  BOUNTY_EDITS_MAX,
  BasePoints,
  ChoreKind,
  ChoreName,
  CooldownHours,
  EffortFactorPct,
  ProofMode,
} from "@baumy/types";
import { applyBountyEdit, type BountyEdit } from "./bounties";
import { defineAction } from "./define";
import { nameTaken, type ManageChoreData } from "./manage-chore";
import { fail } from "./result";

// Mass editing of bounties (issue #175, SPEC §12 decision 31): one editable
// row per bounty, many rows changed, one Save. Owner: "All save in one
// transaction or none." So every row is locked first (in id order, so two
// saves never deadlock), each change is applied in turn, and the names are
// checked once everything is applied: a swap of two names, or two rows given
// the same name, is judged on the end state. Any failure returns
// `{ok: false}` and runAction rolls the whole batch back.
//
// Admin only, on the admin page and on the kitchen screen for a picked admin
// with their PIN (the kiosk admin gate, decision 28). Not on the AI command,
// MCP or brain: not ruled.

/** Which bounty a change is for, and what to change about it. */
const change = z
  .strictObject({
    choreId: z.uuid("Pick a bounty."),
    name: ChoreName.optional(),
    kind: ChoreKind.optional(),
    points: BasePoints.optional(),
    cooldownHours: CooldownHours.optional(),
    proofMode: ProofMode.optional(),
    effortFactorPct: EffortFactorPct.optional(),
    /** True archives it, false restores it. */
    archived: z.boolean({ error: "Archived is yes or no." }).optional(),
  })
  .refine((c) => Object.keys(c).some((k) => k !== "choreId"), {
    error: "Say what to change about each bounty.",
  });

export type BountyChange = z.output<typeof change>;

const input = z.strictObject({
  changes: z
    .array(change, { error: "Say which bounties to change." })
    .min(1, "Change at least one bounty.")
    .max(BOUNTY_EDITS_MAX, `Change at most ${BOUNTY_EDITS_MAX} at once.`)
    .superRefine((list, issue) => {
      const seen = new Set<string>();
      list.forEach((c, index) => {
        if (seen.has(c.choreId)) {
          issue.addIssue({
            code: "custom",
            path: [index, "choreId"],
            message: "Each bounty may be changed only once per save.",
          });
        }
        seen.add(c.choreId);
      });
    }),
});

export interface UpdateBountiesData {
  /** One per change, in the order given. */
  changed: ManageChoreData[];
}

/** A change's edits besides archiving, or null when it only (un)archives. */
function editOf(c: BountyChange): BountyEdit | null {
  const { choreId: _id, archived: _archived, ...edit } = c;
  return Object.keys(edit).length > 0 ? edit : null;
}

const NOT_FOUND = fail(
  "NOT_FOUND",
  "One of those bounties was not found. Reload the page and try again.",
);

export const updateBounties = defineAction({
  name: "update_bounties",
  title: "Edit many bounties",
  description:
    "Edits several bounties at once, all or none: for each, any of its name, kind, base points, cooldown in hours, proof mode and effort factor, and archiving or restoring it. New points count from now; nothing already scored changes. Only a household admin may do this.",
  consent: "Edit many bounties at once",
  kind: "write",
  risk: "confirm",
  // The kiosk too, for a picked admin with their PIN (issue #175).
  surfaces: ["ui", "kiosk"],
  requires: "admin",
  input,
  async execute(ctx, { changes }) {
    // Lock every row first, in one stable order.
    const rows = new Map<string, ChoreRow>();
    for (const id of changes.map((c) => c.choreId).sort()) {
      const row = await lockChoreRow(ctx.db, ctx.householdId, id);
      if (!row) return NOT_FOUND;
      rows.set(id, row);
    }

    const changed: ManageChoreData[] = [];
    const edited: string[] = [];
    for (const c of changes) {
      let chore = rows.get(c.choreId)!;
      const edit = editOf(c);
      if (edit) {
        if (chore.archivedAt !== null && c.archived !== false) {
          return fail(
            "ARCHIVED_CHORE",
            `${chore.name} is archived. Restore it to edit it.`,
          );
        }
        const r = await applyBountyEdit(ctx, chore, edit);
        if (!r.ok) return r;
        chore = r.chore;
        edited.push(chore.id);
        changed.push({
          choreId: chore.id,
          name: chore.name,
          archived: chore.archivedAt !== null,
          weightChanged: r.weightChanged,
        });
      } else {
        changed.push({
          choreId: chore.id,
          name: chore.name,
          archived: chore.archivedAt !== null,
          weightChanged: false,
        });
      }
      if (c.archived !== undefined) {
        chore = await setChoreArchived(ctx.db, {
          chore,
          archived: c.archived,
          now: ctx.now,
        });
        changed[changed.length - 1]!.archived = chore.archivedAt !== null;
      }
      rows.set(chore.id, chore);
    }

    // The names, on the end state: no two active bounties share one.
    for (const c of changes) {
      const chore = rows.get(c.choreId)!;
      if (chore.archivedAt !== null) continue;
      if (c.name === undefined && c.archived !== false) continue;
      if (
        await choreNameTaken(ctx.db, {
          householdId: ctx.householdId,
          name: chore.name,
          exceptId: chore.id,
        })
      ) {
        return nameTaken(chore.name);
      }
    }

    const data: UpdateBountiesData = { changed };
    return {
      ok: true,
      data,
      // One row for the save. `edited` names the bounties whose settings
      // changed, so the activity log lists each (packages/db activity.ts).
      audit: { entity: "chore", entityId: null, payload: { changes, edited } },
    };
  },
});
