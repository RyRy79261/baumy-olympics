import { formatBerlinDateTime } from "@baumy/core";
import type { WeightRowView } from "@/lib/actions/weights";

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

/** The sparkline's words: "Gaps between completions: 6, 7, 7 days". */
export function intervalsLabel(intervals: readonly number[]): string {
  if (intervals.length === 0) return "No gaps measured yet.";
  const days = intervals.map((m) => short(m / DAY_MIN)).join(", ");
  return `Gaps between completions, in days: ${days}.`;
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
