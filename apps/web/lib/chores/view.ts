import { formatBerlinDateTime, nextScore } from "@baumy/core";
import type { ChoreView } from "@/lib/actions/list-chores";

// What the chore grid and its sheet say about a chore (SPEC §3.2). Pure and
// client-safe: the grid runs it in the browser, on `list_chores` data.

/** "Ryan · streak 3", or "No streak yet". */
export function streakLabel(c: Pick<ChoreView, "streak">): string {
  return c.streak
    ? `${c.streak.holderName} · streak ${c.streak.length}`
    : "No streak yet";
}

/** The tile's status line, in Berlin time. */
export function statusLabel(
  c: Pick<ChoreView, "state" | "availableAt" | "dueAt" | "archived">,
): string {
  switch (c.state) {
    case "due":
      return c.dueAt
        ? `Due since ${formatBerlinDateTime(new Date(c.dueAt))}`
        : "Due";
    case "cooldown":
      return `Again from ${formatBerlinDateTime(new Date(c.availableAt!))}`;
    case "done":
      return `Due ${formatBerlinDateTime(new Date(c.dueAt!))}`;
    case "unavailable":
      return c.archived ? "Archived" : "No points set yet";
  }
}

export interface PreviewView {
  /** "+25, streak 2". */
  headline: string;
  totalPts: number;
  /** "Breaks Ryan's streak of 3: +12 bonus", or null. */
  breaks: string | null;
  /** Set when the points only count once someone else confirms. */
  pending: string | null;
}

/**
 * What logging `c` for `doneBy` would score, from the grid's data: one more
 * step of the season's replay (`nextScore`), which is also what the server
 * stores unless someone logs the chore in between.
 */
export function previewFor(
  c: Pick<ChoreView, "basePoints" | "streak" | "confirmMode">,
  doneBy: string,
  actorId: string,
): PreviewView | null {
  if (c.basePoints === null) return null;
  const s = nextScore(c.basePoints, c.streak, doneBy);
  return {
    headline: `+${s.totalPts}, streak ${s.streakLen}`,
    totalPts: s.totalPts,
    breaks:
      s.brokenLen !== null && c.streak
        ? `Breaks ${c.streak.holderName}'s streak of ${s.brokenLen}: +${s.breakPts} bonus`
        : null,
    pending:
      c.confirmMode === "partner" && doneBy === actorId
        ? "Counts once someone else confirms it."
        : null,
  };
}

// Bounties (ADR 0005 §2): the board shows every chore as a bounty, and one
// row of tabs narrows it to the urgent ones, the new ones, or one kind. The
// hub's Urgent and New tiles link straight to their tab (`?show=`).

/** What the bounty board can narrow itself to. */
export const BOUNTY_FILTERS = [
  "all",
  "urgent",
  "new",
  "consumable",
  "maintenance",
] as const;
export type BountyFilter = (typeof BOUNTY_FILTERS)[number];

/** The `?show=` value as a filter; anything else is "all". */
export function parseBountyFilter(value: unknown): BountyFilter {
  return (BOUNTY_FILTERS as readonly unknown[]).includes(value)
    ? (value as BountyFilter)
    : "all";
}

type BountyFields = Pick<ChoreView, "kind" | "urgent" | "isNew">;

function matches(c: BountyFields, filter: BountyFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "urgent":
      return c.urgent;
    case "new":
      return c.isNew;
    default:
      return c.kind === filter;
  }
}

/** The bounties a filter keeps, in the order given. */
export function filterBounties<C extends BountyFields>(
  chores: readonly C[],
  filter: BountyFilter,
): C[] {
  return chores.filter((c) => matches(c, filter));
}

/** How many bounties each filter keeps, for the tabs' counts. */
export function bountyCounts(
  chores: readonly BountyFields[],
): Record<BountyFilter, number> {
  return Object.fromEntries(
    BOUNTY_FILTERS.map((f) => [f, filterBounties(chores, f).length]),
  ) as Record<BountyFilter, number>;
}

/**
 * The board's order: urgent first, the longest-waiting at the top (never
 * done before anything with a date); then the rest by when they fall due;
 * chores that cannot be scored last; ties by name.
 */
export function sortBounties<
  C extends Pick<ChoreView, "urgent" | "state" | "dueAt" | "name">,
>(chores: readonly C[]): C[] {
  const rank = (c: C) => (c.urgent ? 0 : c.state === "unavailable" ? 2 : 1);
  const due = (c: C) => (c.dueAt === null ? -Infinity : Date.parse(c.dueAt));
  return [...chores].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (due(a) === due(b) ? 0 : due(a) < due(b) ? -1 : 1) ||
      a.name.localeCompare(b.name),
  );
}
