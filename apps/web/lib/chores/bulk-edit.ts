import type { ChoreKind, ProofMode } from "@baumy/types";
import type { ActionResult } from "@/lib/actions/result";
import { hoursField } from "@/lib/weights/view";

// The mass bounty editor's pure half (issue #175): each bounty's editable
// draft, the changes a save sends (only the fields that differ, only the
// rows that changed), and the action's per-field errors mapped back onto
// their rows. Client-safe: no server imports.

/** A bounty as the editor shows it (a `list_chores` row). */
export interface BulkBounty {
  id: string;
  name: string;
  kind: ChoreKind;
  proofMode: ProofMode;
  effortFactorPct: number;
  /** Null while it has no points yet. */
  basePoints: number | null;
  cooldownMinutes: number | null;
  archived: boolean;
}

/** What a row's controls hold; numbers stay text until they are sent. */
export interface BountyDraft {
  name: string;
  kind: ChoreKind;
  points: string;
  cooldownHours: string;
  proofMode: ProofMode;
  effortFactorPct: string;
  archived: boolean;
}

/** The fields one change may carry, as `update_bounties` names them. */
export type BountyField = keyof BountyDraft;

/** One row's change: its id, and each field that differs. */
export type BountyChangeInput = { choreId: string } & Partial<
  Record<BountyField, string | number | boolean>
>;

/** The hidden field the form sends the changes in, as JSON. */
export const CHANGES_FIELD = "changes";

export function draftOf(b: BulkBounty): BountyDraft {
  return {
    name: b.name,
    kind: b.kind,
    points: b.basePoints === null ? "" : String(b.basePoints),
    cooldownHours:
      b.cooldownMinutes === null ? "" : hoursField(b.cooldownMinutes),
    proofMode: b.proofMode,
    effortFactorPct: String(b.effortFactorPct),
    archived: b.archived,
  };
}

/**
 * A number field's value to send, or undefined when it says what the
 * bounty already has. Text that is not a number is sent as it is, so the
 * action's own check names the field.
 */
function numberChange(
  text: string,
  was: number | null,
  same: (n: number) => boolean = (n) => n === was,
): number | string | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return was === null ? undefined : trimmed;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return trimmed;
  return was !== null && same(n) ? undefined : n;
}

/** The change a row's draft makes, or null when it makes none. */
export function changeOf(
  b: BulkBounty,
  d: BountyDraft,
): BountyChangeInput | null {
  const change: BountyChangeInput = { choreId: b.id };
  if (d.name.trim() !== b.name) change.name = d.name;
  if (d.kind !== b.kind) change.kind = d.kind;
  const points = numberChange(d.points, b.basePoints);
  if (points !== undefined) change.points = points;
  const hours = numberChange(
    d.cooldownHours,
    b.cooldownMinutes,
    // The minutes it would store, so 1.5 and 1.50 are the same 90.
    (h) => Math.round(h * 60) === b.cooldownMinutes,
  );
  if (hours !== undefined) change.cooldownHours = hours;
  if (d.proofMode !== b.proofMode) change.proofMode = d.proofMode;
  const effort = numberChange(d.effortFactorPct, b.effortFactorPct);
  if (effort !== undefined) change.effortFactorPct = effort;
  if (d.archived !== b.archived) change.archived = d.archived;
  return Object.keys(change).length > 1 ? change : null;
}

/** Every row's change, in the bounties' order; untouched rows are left out. */
export function changesOf(
  bounties: readonly BulkBounty[],
  drafts: Readonly<Record<string, BountyDraft>>,
): BountyChangeInput[] {
  const out: BountyChangeInput[] = [];
  for (const b of bounties) {
    const d = drafts[b.id];
    const c = d ? changeOf(b, d) : null;
    if (c) out.push(c);
  }
  return out;
}

/**
 * The server action's `mapInput`: the form's JSON field becomes the
 * action's `changes`. Anything that is not JSON becomes no changes at all,
 * which the action's schema refuses with its own sentence.
 */
export function changesFromForm(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const raw = input[CHANGES_FIELD];
  if (typeof raw !== "string") return {};
  try {
    return { changes: JSON.parse(raw) as unknown };
  } catch {
    return {};
  }
}

/**
 * The action's per-field errors, by bounty id and field. `changes` is the
 * list that was sent, so an issue's index finds its row.
 */
export function rowErrors(
  result: ActionResult<unknown> | null,
  changes: readonly BountyChangeInput[],
): Record<string, Partial<Record<BountyField, string[]>>> {
  const out: Record<string, Partial<Record<BountyField, string[]>>> = {};
  if (!result || result.ok || !result.issues) return out;
  for (const issue of result.issues) {
    const [top, index, field] = issue.path;
    if (top !== CHANGES_FIELD || typeof index !== "number") continue;
    const id = changes[index]?.choreId;
    if (!id || typeof field !== "string" || field === "choreId") continue;
    const row = (out[id] ??= {});
    (row[field as BountyField] ??= []).push(issue.message);
  }
  return out;
}

/** "Save 1 change", "Save 3 changes". */
export function saveLabel(count: number): string {
  if (count === 0) return "Save changes";
  return `Save ${count} change${count === 1 ? "" : "s"}`;
}
