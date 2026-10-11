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

/**
 * The tile's status line, in Berlin time: "Ready", or "Again from <time>"
 * while it cools down. A chore has no due date (SPEC §12 decision 35).
 */
export function statusLabel(
  c: Pick<ChoreView, "state" | "availableAt" | "archived">,
): string {
  switch (c.state) {
    case "ready":
      return "Ready";
    case "cooldown":
      return `Again from ${formatBerlinDateTime(new Date(c.availableAt!))}`;
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
}

/**
 * What logging `c` for `doneBy` would score, from the grid's data: one more
 * step of the season's replay (`nextScore`), which is also what the server
 * stores unless someone logs the chore in between.
 */
export function previewFor(
  c: Pick<ChoreView, "basePoints" | "streak">,
  doneBy: string,
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
  };
}

// Bounties (ADR 0005 §2): the board shows every chore as a bounty, and one
// row of tabs narrows it to the new ones or one kind. The hub's New tile
// links straight to its tab (`?show=`).

/** What the bounty board can narrow itself to. */
export const BOUNTY_FILTERS = [
  "all",
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

type BountyFields = Pick<ChoreView, "kind" | "isNew">;

function matches(c: BountyFields, filter: BountyFilter): boolean {
  switch (filter) {
    case "all":
      return true;
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
 * The board's order: the bounties ready to log first, then those cooling
 * down, the soonest ready again first, then those that cannot be scored;
 * ties by name. There is no due date to sort by (SPEC §12 decision 35).
 */
export function sortBounties<
  C extends Pick<ChoreView, "state" | "availableAt" | "name">,
>(chores: readonly C[]): C[] {
  const rank = (c: C) =>
    c.state === "ready" ? 0 : c.state === "cooldown" ? 1 : 2;
  const again = (c: C) =>
    c.state === "cooldown" && c.availableAt ? Date.parse(c.availableAt) : 0;
  return [...chores].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      again(a) - again(b) ||
      a.name.localeCompare(b.name),
  );
}
