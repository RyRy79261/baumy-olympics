import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  COOLDOWN_HOURS_MAX,
  EFFORT_FACTOR_MAX,
  EFFORT_FACTOR_MIN,
  type ChoreKind,
  type ProofMode,
} from "@baumy/types";
import { stepStops } from "@baumy/ui";
import type { ActionResult } from "@/lib/actions/result";
import { formatMinutes, hoursField } from "@/lib/weights/view";

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

/**
 * What the admin touched on a row: only those fields. Everything else shows
 * the bounty as it is now, so a save never sends back (and so reverts) a
 * field another admin changed after this page loaded.
 */
export type Touched = Partial<BountyDraft>;

/** What a row's controls show: the bounty, with the touched fields over it. */
export function viewOf(b: BulkBounty, t: Touched | undefined): BountyDraft {
  return { ...draftOf(b), ...t };
}

/** The change the touched fields make, or null when they make none. */
export function changeOf(b: BulkBounty, t: Touched): BountyChangeInput | null {
  const change: BountyChangeInput = { choreId: b.id };
  if (t.name !== undefined && t.name.trim() !== b.name) change.name = t.name;
  if (t.kind !== undefined && t.kind !== b.kind) change.kind = t.kind;
  if (t.points !== undefined) {
    const points = numberChange(t.points, b.basePoints);
    if (points !== undefined) change.points = points;
  }
  if (t.cooldownHours !== undefined) {
    const hours = numberChange(
      t.cooldownHours,
      b.cooldownMinutes,
      // The minutes it would store, so 1.5 and 1.50 are the same 90.
      (h) => Math.round(h * 60) === b.cooldownMinutes,
    );
    if (hours !== undefined) change.cooldownHours = hours;
  }
  if (t.proofMode !== undefined && t.proofMode !== b.proofMode) {
    change.proofMode = t.proofMode;
  }
  if (t.effortFactorPct !== undefined) {
    const effort = numberChange(t.effortFactorPct, b.effortFactorPct);
    if (effort !== undefined) change.effortFactorPct = effort;
  }
  if (t.archived !== undefined && t.archived !== b.archived) {
    change.archived = t.archived;
  }
  return Object.keys(change).length > 1 ? change : null;
}

/** What a blank number field that must be filled in says. */
export const REQUIRED = "Required.";

/**
 * The touched number fields left blank that must not be: the effort always,
 * and the points and the cooldown once the bounty has them, or once the
 * other half is given (a bounty with no points may stay without).
 */
export function blankErrors(
  b: BulkBounty,
  t: Touched,
): Partial<Record<BountyField, string[]>> {
  const view = viewOf(b, t);
  const blank = (v: string) => v.trim() === "";
  const out: Partial<Record<BountyField, string[]>> = {};
  // A bounty with points needs both halves kept; one without needs both
  // once either is given.
  const needs = (touched: boolean, other: string, had: boolean) =>
    had ? touched : !blank(other);
  if (
    blank(view.points) &&
    needs(t.points !== undefined, view.cooldownHours, b.basePoints !== null)
  ) {
    out.points = [REQUIRED];
  }
  if (
    blank(view.cooldownHours) &&
    needs(
      t.cooldownHours !== undefined,
      view.points,
      b.cooldownMinutes !== null,
    )
  ) {
    out.cooldownHours = [REQUIRED];
  }
  if (t.effortFactorPct !== undefined && blank(view.effortFactorPct)) {
    out.effortFactorPct = [REQUIRED];
  }
  return out;
}

/** Every row's change, in the bounties' order; untouched rows are left out. */
export function changesOf(
  bounties: readonly BulkBounty[],
  touched: Readonly<Record<string, Touched>>,
): BountyChangeInput[] {
  const out: BountyChangeInput[] = [];
  for (const b of bounties) {
    const t = touched[b.id];
    const c = t ? changeOf(b, t) : null;
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

// The sliders' stops (issue #179). A bounty's own value is added to its
// row's stops (`withStop`), so a value off the scale can be put back.

/** Points: every whole point, since the formula may suggest any of them. */
export const POINT_STOPS = stepStops(BASE_POINTS_MIN, BASE_POINTS_MAX, 1);

/** Effort: fives, from 50% to 300%. */
export const EFFORT_STOPS = stepStops(EFFORT_FACTOR_MIN, EFFORT_FACTOR_MAX, 5);

/**
 * Cooldown hours, finer where the choice is finer: every hour up to a day,
 * every 6 hours up to a week (so 48, 84 and 168 are on it), then every day
 * up to 30 days. 72 stops in all, where hours alone would be 721.
 */
export const COOLDOWN_STOPS = [
  ...stepStops(0, 24, 1),
  ...stepStops(30, 7 * 24, 6),
  ...stepStops(8 * 24, COOLDOWN_HOURS_MAX, 24),
];

/** "1 pt", "26 pts". */
export function pointsText(n: number): string {
  return `${n} ${n === 1 ? "pt" : "pts"}`;
}

/** "100%". */
export function effortText(n: number): string {
  return `${n}%`;
}

/** "12 h", and from a day up its days too: "84 h · 3.5 days". */
export function cooldownText(hours: number): string {
  const h = `${Math.round(hours * 100) / 100} h`;
  return hours >= 24 ? `${h} · ${formatMinutes(hours * 60)}` : h;
}

/** A draft's number for its slider, or null while it has none. */
export function sliderValue(text: string): number | null {
  const t = text.trim();
  return t === "" || !Number.isFinite(Number(t)) ? null : Number(t);
}

/** "Save 1 change", "Save 3 changes". */
export function saveLabel(count: number): string {
  if (count === 0) return "Save changes";
  return `Save ${count} change${count === 1 ? "" : "s"}`;
}
