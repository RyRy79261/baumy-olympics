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

// The rules for editing a bounty (issue #214), in one place: half a weight,
// an archived bounty and a name another bounty has. Every write that changes
// a bounty's settings comes here (manage_chore's update, update_bounty,
// update_bounties) and schedule_points_change uses its archived rule; the
// actions only turn their input into a patch and pick the options below.
// Server only: it takes the caller's transaction and the chore row the
// caller locked (FOR UPDATE). It imports nothing from lib/actions: a refusal
// is a plain value an action returns as its failure as it is. The mass
// editor's client half (bulk-edit.ts) only flags blank fields before a
// save; these rules decide.

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
 * Why an edit was refused: the shape of an action's failure, so an action
 * returns it unchanged. Nothing was written.
 */
export interface EditRefusal {
  ok: false;
  code:
    "ARCHIVED_CHORE" | "INVALID_INPUT" | "CHORE_NAME_TAKEN" | "NO_RULE_VERSION";
  message: string;
  issues?: { path: string[]; message: string }[];
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
 * ARCHIVED_CHORE with the caller's sentence, which says where to restore it
 * (a sentence, or one made from the bounty's name).
 */
export type ArchivedPolicy =
  "edit" | { refuse: string | ((name: string) => string) };

/**
 * The new name: `now` checks it against the other active bounties before
 * anything is written; `afterBatch` leaves it to `batchNamesFree`, which
 * checks every name once a whole batch is applied, so a swap of two names
 * is judged on the end state (update_bounties).
 */
export type NameCheck = "now" | "afterBatch";

export interface EditOptions {
  halves: WeightHalves;
  archived: ArchivedPolicy;
  names: NameCheck;
}

export type EditResult =
  { ok: true; chore: ChoreRow; weightChanged: boolean } | EditRefusal;

function refuse(
  code: EditRefusal["code"],
  message: string,
  issues?: EditRefusal["issues"],
): EditRefusal {
  return { ok: false, code, message, ...(issues ? { issues } : {}) };
}

/** CHORE_NAME_TAKEN, the sentence every bounty write uses. */
export const nameTaken = (name: string) =>
  refuse(
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
): Promise<EditRefusal | null> {
  const taken = await choreNameTaken(scope.db, {
    householdId: scope.householdId,
    name,
    ...(exceptId ? { exceptId } : {}),
  });
  return taken ? nameTaken(name) : null;
}

/** One bounty of a batch, as it stands once the whole batch is applied. */
export interface BatchEntry {
  chore: ChoreRow;
  /** The batch gave it a name. */
  renamed: boolean;
  /** The batch said to restore it (it may not have been archived). */
  restored: boolean;
}

/**
 * The unique-name rule on a batch's end state (`names: "afterBatch"`):
 * every active bounty the batch renamed or restored must have a name no
 * other active bounty has. The first clash, with its entry's index and
 * whether it is on the new name or on the restore; null when all are free.
 */
export async function batchNamesFree(
  scope: Pick<EditScope, "db" | "householdId">,
  entries: readonly BatchEntry[],
): Promise<{
  index: number;
  on: "name" | "restore";
  refusal: EditRefusal;
} | null> {
  for (const [index, e] of entries.entries()) {
    if (e.chore.archivedAt !== null) continue;
    if (!e.renamed && !e.restored) continue;
    const taken = await nameFree(scope, e.chore.name, e.chore.id);
    if (taken) {
      return { index, on: e.renamed ? "name" : "restore", refusal: taken };
    }
  }
  return null;
}

/** The archived rule: null when the policy lets this row be changed. */
export function archivedRefusal(
  chore: ChoreRow,
  policy: ArchivedPolicy,
): EditRefusal | null {
  if (chore.archivedAt === null || policy === "edit") return null;
  const sentence =
    typeof policy.refuse === "string"
      ? policy.refuse
      : policy.refuse(chore.name);
  return refuse("ARCHIVED_CHORE", sentence);
}

/** `together`: the half that is missing, as an issue on that field. */
function halfAWeight(patch: BountyPatch): EditRefusal | null {
  if ((patch.points === undefined) === (patch.cooldownHours === undefined)) {
    return null;
  }
  const message = "Give the points and the cooldown together.";
  return refuse("INVALID_INPUT", message, [
    {
      path: [patch.points === undefined ? "basePoints" : "cooldownHours"],
      message,
    },
  ]);
}

/** `keepOther`: the weight with its missing half filled from the current one. */
async function filledWeight(
  scope: EditScope,
  chore: ChoreRow,
  patch: BountyPatch,
): Promise<{ basePoints: number; cooldownMinutes: number } | EditRefusal> {
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
    return refuse(
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
