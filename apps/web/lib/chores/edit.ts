import type { Queryable } from "@baumy/db";
import {
  choreNameTaken,
  findChoreWithWeight,
  updateChore,
  type ChoreRow,
} from "@baumy/db/chores";
import {
  cooldownMinutesFromHours,
  type ChoreKind,
  type ProofMode,
} from "@baumy/types";
import type { ActionCtx } from "@/lib/actions/define";
import { fail, type ActionFailure } from "@/lib/actions/result";

// The rules for editing a bounty (issue #214), in one place: half a weight,
// an archived bounty and a name another bounty has. Every write that changes
// a bounty's settings comes here (manage_chore's update, update_bounty,
// update_bounties) and schedule_points_change uses its archived rule; the
// actions only turn their input into a patch and pick
// the options below. Server only: it takes the caller's transaction and the
// chore row the caller locked (FOR UPDATE). The mass editor's client half
// (bulk-edit.ts) only flags blank fields before a save; these rules decide.

/** Who edits, where and when: the caller's transaction and its actor. */
export interface EditScope {
  db: Queryable;
  householdId: string;
  /** The member making the change (a new weight's `createdBy`). */
  by: string;
  now: Date;
}

/** What an edit may change; a field left out is kept as it is. */
export interface BountyPatch {
  name?: string;
  kind?: ChoreKind;
  /** The icon (`chores.sprite`); only the admin chores page picks one. */
  sprite?: string;
  proofMode?: ProofMode;
  effortFactorPct?: number;
  points?: number;
  cooldownHours?: number;
}

/**
 * Half a weight (points without the cooldown, or the other way round):
 * - `together` refuses it ("Give the points and the cooldown together."),
 *   so a form whose field was cleared says so (manage_chore);
 * - `keepOther` keeps the missing half as it is now, and refuses only a
 *   bounty with no weight yet (NO_RULE_VERSION) (update_bounty,
 *   update_bounties).
 */
export type WeightHalves = "together" | "keepOther";

/**
 * An archived bounty: `edit` changes it anyway (manage_chore, and a mass
 * edit that restores it in the same change); `refuse` returns
 * ARCHIVED_CHORE with the caller's sentence, which says where to restore it.
 */
export type ArchivedPolicy = "edit" | { refuse: (name: string) => string };

/**
 * The new name: `now` checks it against the other active bounties before
 * anything is written; `afterBatch` leaves it to the caller, which checks
 * every name once a whole batch is applied (`nameFree`), so a swap of two
 * names is judged on the end state (update_bounties).
 */
export type NameCheck = "now" | "afterBatch";

export interface EditOptions {
  halves: WeightHalves;
  archived: ArchivedPolicy;
  names: NameCheck;
}

export type EditResult =
  { ok: true; chore: ChoreRow; weightChanged: boolean } | ActionFailure;

/** CHORE_NAME_TAKEN, the sentence every bounty write uses. */
export const nameTaken = (name: string) =>
  fail(
    "CHORE_NAME_TAKEN",
    `There is already a chore called ${name}. Pick another name.`,
  );

/**
 * The unique-name rule: no two active bounties share a name (any case).
 * Null when `name` is free for the bounty `exceptId` (or a new one).
 */
export async function nameFree(
  scope: Pick<EditScope, "db" | "householdId">,
  name: string,
  exceptId?: string,
): Promise<ActionFailure | null> {
  const taken = await choreNameTaken(scope.db, {
    householdId: scope.householdId,
    name,
    ...(exceptId ? { exceptId } : {}),
  });
  return taken ? nameTaken(name) : null;
}

/** The archived rule: null when the policy lets this row be changed. */
export function archivedRefusal(
  chore: ChoreRow,
  policy: ArchivedPolicy,
): ActionFailure | null {
  if (chore.archivedAt === null || policy === "edit") return null;
  return fail("ARCHIVED_CHORE", policy.refuse(chore.name));
}

/** `together`: the half that is missing, as an issue on that field. */
function halfAWeight(patch: BountyPatch): ActionFailure | null {
  if ((patch.points === undefined) === (patch.cooldownHours === undefined)) {
    return null;
  }
  const message = "Give the points and the cooldown together.";
  return fail("INVALID_INPUT", message, {
    issues: [
      {
        path: [patch.points === undefined ? "basePoints" : "cooldownHours"],
        message,
      },
    ],
  });
}

/** `keepOther`: the weight with its missing half filled from the current one. */
async function filledWeight(
  scope: EditScope,
  chore: ChoreRow,
  patch: BountyPatch,
): Promise<{ basePoints: number; cooldownMinutes: number } | ActionFailure> {
  let was: { basePoints: number; cooldownMinutes: number } | undefined;
  if (patch.points === undefined || patch.cooldownHours === undefined) {
    const current = await findChoreWithWeight(scope.db, {
      householdId: scope.householdId,
      choreId: chore.id,
      now: scope.now,
    });
    was = current?.weight ?? undefined;
  }
  const basePoints = patch.points ?? was?.basePoints;
  const cooldownMinutes =
    patch.cooldownHours !== undefined
      ? cooldownMinutesFromHours(patch.cooldownHours)
      : was?.cooldownMinutes;
  if (basePoints === undefined || cooldownMinutes === undefined) {
    return fail(
      "NO_RULE_VERSION",
      `${chore.name} has no points yet. Give both its points and its cooldown.`,
    );
  }
  return { basePoints, cooldownMinutes };
}

/**
 * Edit a bounty the caller has locked: check the rules in this order
 * (archived, half a weight, the name, a missing weight), then write its
 * settings and, when the points or the cooldown are given, a new weight from
 * now (nothing already scored changes). A refusal writes nothing.
 */
export async function editBounty(
  scope: EditScope,
  chore: ChoreRow,
  patch: BountyPatch,
  options: EditOptions,
): Promise<EditResult> {
  const archived = archivedRefusal(chore, options.archived);
  if (archived) return archived;

  if (options.halves === "together") {
    const half = halfAWeight(patch);
    if (half) return half;
  }

  if (options.names === "now" && patch.name !== undefined) {
    const taken = await nameFree(scope, patch.name, chore.id);
    if (taken) return taken;
  }

  let weight: { basePoints: number; cooldownMinutes: number } | undefined;
  if (patch.points !== undefined || patch.cooldownHours !== undefined) {
    const w =
      options.halves === "keepOther"
        ? await filledWeight(scope, chore, patch)
        : {
            basePoints: patch.points!,
            cooldownMinutes: cooldownMinutesFromHours(patch.cooldownHours!),
          };
    if ("ok" in w) return w;
    weight = w;
  }

  const r = await updateChore(scope.db, {
    householdId: scope.householdId,
    chore,
    settings: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.sprite !== undefined ? { sprite: patch.sprite } : {}),
      ...(patch.proofMode !== undefined ? { proofMode: patch.proofMode } : {}),
      ...(patch.effortFactorPct !== undefined
        ? { effortFactorPct: patch.effortFactorPct }
        : {}),
    },
    ...(weight ? { weight } : {}),
    createdBy: scope.by,
    now: scope.now,
  });
  return { ok: true, chore: r.chore, weightChanged: r.weightChanged };
}

/** An action's context as an edit scope (the acting member edits). */
export function editScope(ctx: ActionCtx): EditScope {
  return {
    db: ctx.db,
    householdId: ctx.householdId,
    by: ctx.actor.memberId!,
    now: ctx.now,
  };
}
