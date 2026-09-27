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
