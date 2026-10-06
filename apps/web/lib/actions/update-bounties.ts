import { z } from "zod";
import {
  choreNameTaken,
  lockChoreRow,
  setChoreArchived,
  type ChoreRow,
} from "@baumy/db/chores";
import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  BOUNTY_EDITS_MAX,
  COOLDOWN_HOURS_MAX,
  ChoreKind,
  ChoreName,
  EFFORT_FACTOR_MAX,
  EFFORT_FACTOR_MIN,
  ProofMode,
} from "@baumy/types";
import { applyBountyEdit, type BountyEdit } from "./bounties";
import { defineAction } from "./define";
import { nameTaken, type ManageChoreData } from "./manage-chore";
import { fail, type ActionFailure } from "./result";

// Mass editing of bounties (issue #175, SPEC §12 decision 31): one editable
// row per bounty (the owner's words), many rows changed, one Save, and the
// rows save in one transaction or not at all. So every row is locked first
// (in id order, so two saves never deadlock), each change is applied in
// turn, and the names are checked once everything is applied: a swap of two
// names, or two rows given the same name, is judged on the end state. Any
// failure returns `{ok: false}` and runAction rolls the whole batch back.
//
// Admin only, on the admin page and on the kitchen screen for a picked admin
// with their PIN (the kiosk admin gate, decision 28). Not on the AI command,
// MCP or brain: not ruled.

/**
 * A number, never coerced: the editor sends numbers in JSON, so a blank
 * field ("" or null) is "Required." rather than the 0 `z.coerce` would make
 * of it (a cooldown of 0 hours is valid, and would be saved).
 */
const number = (what: string) =>
  z.number({
    error: (issue) =>
      issue.input === "" || issue.input === null
        ? "Required."
        : `Enter a number of ${what}.`,
  });

/** Which bounty a change is for, and what to change about it. */
const change = z
  .strictObject({
    choreId: z.uuid("Pick a bounty."),
    name: ChoreName.optional(),
    kind: ChoreKind.optional(),
    points: number("points")
      .int("Use a whole number.")
      .min(BASE_POINTS_MIN, `At least ${BASE_POINTS_MIN}.`)
      .max(BASE_POINTS_MAX, `At most ${BASE_POINTS_MAX}.`)
      .optional(),
    cooldownHours: number("hours")
      .min(0, "Zero or more hours.")
      .max(COOLDOWN_HOURS_MAX, `At most ${COOLDOWN_HOURS_MAX} hours (30 days).`)
      .optional(),
    proofMode: ProofMode.optional(),
    effortFactorPct: number("percent")
      .int("Use a whole number.")
      .min(EFFORT_FACTOR_MIN, `At least ${EFFORT_FACTOR_MIN}%.`)
      .max(EFFORT_FACTOR_MAX, `At most ${EFFORT_FACTOR_MAX}%.`)
      .optional(),
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

/** A failure about one row's field, so the editor shows it on that row. */
function onRow(
  failure: ActionFailure,
  index: number,
  field: string,
): ActionFailure {
  return {
    ...failure,
    issues: [{ path: ["changes", index, field], message: failure.message }],
  };
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
    for (const [index, c] of changes.entries()) {
      let chore = rows.get(c.choreId)!;
      const edit = editOf(c);
      if (edit) {
        if (chore.archivedAt !== null && c.archived !== false) {
          return onRow(
            fail(
              "ARCHIVED_CHORE",
              `${chore.name} is archived. Restore it to edit it.`,
            ),
            index,
            "archived",
          );
        }
        const r = await applyBountyEdit(ctx, chore, edit);
        // Only NO_RULE_VERSION: the half of the weight that is missing.
        if (!r.ok) {
          return onRow(
            r,
            index,
            c.points === undefined ? "points" : "cooldownHours",
          );
        }
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
    for (const [index, c] of changes.entries()) {
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
        // On the name, or on the Status of a restore that clashes.
        return onRow(
          nameTaken(chore.name),
          index,
          c.name !== undefined ? "name" : "archived",
        );
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
