import { formatBerlinDateTime } from "@baumy/core";
import type { PointsHistoryView, WeightRowView } from "@/lib/actions/weights";

// What the weights panel and the veto list say (SPEC §4.4). Pure and
// client-safe: the pages render from `get_weights`.

const HOUR_MIN = 60;
const DAY_MIN = 24 * HOUR_MIN;

/** Up to one decimal, without a trailing ".0". */
function short(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/**
 * A length of time for people: "7 days", "3.5 days", "12 h", "45 min".
 * Days from a day up, hours from an hour up.
 */
export function formatMinutes(minutes: number): string {
  if (minutes >= DAY_MIN) {
    const days = short(minutes / DAY_MIN);
    return `${days} ${days === "1" ? "day" : "days"}`;
  }
  if (minutes >= HOUR_MIN) return `${short(minutes / HOUR_MIN)} h`;
  return `${minutes} min`;
}

/** Whole minutes as hours for a form field: 5040 → "84", 90 → "1.5". */
export function hoursField(minutes: number): string {
  return String(Math.round((minutes / HOUR_MIN) * 100) / 100);
}

/** The raw weight as the panel shows it, to two decimals: "26.46". */
export function formatRaw(raw: number | null): string {
  return raw === null ? "–" : raw.toFixed(2);
}

/** What the live measurement says, in a sentence. */
export function verdictLabel(live: WeightRowView["live"]): string {
  if (!live) return "No points set yet.";
  switch (live.verdict) {
    case "insufficient_data":
      return `Not enough data yet: ${live.sampleSize} of 6 gaps.`;
    case "no_change":
      return "The points fit how often it is done.";
    default:
      return `The formula says ${live.suggestedPoints} pts.`;
  }
}

/** The sparkline's words: "Gaps between completions: 6 days, 12 h." */
export function intervalsLabel(intervals: readonly number[]): string {
  if (intervals.length === 0) return "No gaps measured yet.";
  return `Gaps between completions: ${intervals.map(formatMinutes).join(", ")}.`;
}

/** "Applies Mon 5 Oct, 00:00 (Berlin time) unless someone vetoes it." */
export function appliesLabel(appliesAt: string): string {
  return `Applies ${formatBerlinDateTime(new Date(appliesAt))} (Berlin time) unless someone vetoes it.`;
}

/** "35 → 26 pts, cooldown 3.5 days → 3.5 days". */
export function changeLabel(input: {
  fromPoints: number;
  toPoints: number;
  fromCooldownMinutes: number;
  toCooldownMinutes: number;
}): string {
  return `${input.fromPoints} → ${input.toPoints} pts, cooldown ${formatMinutes(input.fromCooldownMinutes)} → ${formatMinutes(input.toCooldownMinutes)}`;
}

// The points history (issue #115): each change in words.

type HistoryEntry = Pick<
  PointsHistoryView,
  | "source"
  | "proposedBy"
  | "proposedAt"
  | "fromPoints"
  | "fromCooldownMinutes"
  | "toPoints"
  | "toCooldownMinutes"
  | "appliesAt"
  | "outcome"
  | "decidedBy"
  | "decidedAt"
>;

/** How the change was made. */
export const HISTORY_SOURCE: Record<PointsHistoryView["source"], string> = {
  seed: "Starting points",
  manual: "Set at once",
  measured: "Baumy's weekly suggestion",
  admin: "Set by an admin",
};

/** "35 → 50 pts, cooldown 3.5 days → 2 days"; a first one "20 pts, …". */
export function historyChangeLabel(e: HistoryEntry): string {
  if (e.fromPoints === null || e.fromCooldownMinutes === null) {
    return `${e.toPoints} pts, cooldown ${formatMinutes(e.toCooldownMinutes)}`;
  }
  return changeLabel({
    fromPoints: e.fromPoints,
    toPoints: e.toPoints,
    fromCooldownMinutes: e.fromCooldownMinutes,
    toCooldownMinutes: e.toCooldownMinutes,
  });
}

/**
 * "Set by an admin · Ryan, Mon 28 Sep, 04:00": how, who and when. A
 * bounty's first points are its starting points, however they were set.
 */
export function historyByLabel(e: HistoryEntry): string {
  const who = e.proposedBy ? `${e.proposedBy.displayName}, ` : "";
  const how =
    e.fromPoints === null ? HISTORY_SOURCE.seed : HISTORY_SOURCE[e.source];
  return `${how} · ${who}${formatBerlinDateTime(new Date(e.proposedAt))}`;
}

/** What became of it, and when (Berlin time). */
export function historyOutcomeLabel(e: HistoryEntry): string {
  const at = (iso: string) => formatBerlinDateTime(new Date(iso));
  const by = e.decidedBy ? ` by ${e.decidedBy.displayName}` : "";
  switch (e.outcome) {
    case "landed":
      return `In effect from ${at(e.appliesAt)}.`;
    case "vetoed":
      return `Vetoed${by}, ${at(e.decidedAt!)}. It never applied.`;
    case "cancelled":
      return `Cancelled${by}, ${at(e.decidedAt!)}. It never applied.`;
    default:
      return `Waiting: applies ${at(e.appliesAt)} (Berlin time) unless someone vetoes it.`;
  }
}
