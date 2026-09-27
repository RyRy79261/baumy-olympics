import type { PrizeMode } from "@baumy/core";
import type {
  DisputeCountView,
  RecentCompletionView,
} from "@/lib/actions/scoreboard";

// What the scoreboard and the pot say (SPEC §3.2, §4.5). Pure and
// client-safe: the pages render from `get_standings`, `get_streaks` and
// `get_pot`, the same reads the AI and MCP get.

/** Euro cents as "€80.50". The pot is a ledger only; no rounding happens. */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}€${euros.toLocaleString("en-GB")}.${rest}`;
}

/** Points with their sign, for adjustments: "+15", "-7". */
export function signedPoints(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

export const PRIZE_MODES: readonly {
  mode: PrizeMode;
  label: string;
  playable: boolean;
}[] = [
  {
    mode: "points",
    label: "Points: winner takes the whole pot",
    playable: true,
  },
  {
    mode: "heaviest_streak",
    label: "Heaviest streak (coming later)",
    playable: false,
  },
  {
    mode: "longest_streak",
    label: "Longest streak (coming later)",
    playable: false,
  },
];

export function prizeModeLabel(mode: PrizeMode): string {
  return PRIZE_MODES.find((m) => m.mode === mode)!.label;
}

/** "3 behind", or "Leader" for the top of the table. */
export function gapLabel(gap: number): string {
  return gap === 0 ? "Leader" : `${gap} behind`;
}

/** "1 raised · 2 against", or "None". */
export function disputeLabel(
  d: Pick<DisputeCountView, "raised" | "against"> | undefined,
): string {
  if (!d || (d.raised === 0 && d.against === 0)) return "None";
  return `${d.raised} raised · ${d.against} against`;
}

/** "20 base + 5 streak (×2) + 8 break (Ryan's 2)". */
export function breakdownLabel(
  c: Pick<
    RecentCompletionView,
    | "basePts"
    | "streakBonusPts"
    | "streakLen"
    | "breakPts"
    | "brokenMemberName"
    | "brokenLen"
  >,
): string {
  const parts = [`${c.basePts} base`];
  if (c.streakBonusPts !== 0) {
    parts.push(`${c.streakBonusPts} streak (${c.streakLen} in a row)`);
  }
  if (c.breakPts !== 0) {
    parts.push(
      `${c.breakPts} break (${c.brokenMemberName ?? "someone"}'s ${c.brokenLen})`,
    );
  }
  return parts.join(" + ");
}
