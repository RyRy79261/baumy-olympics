import { formatBerlinDateTime } from "@baumy/core";
import type {
  ActivityChoreView,
  ActivityView,
} from "@/lib/actions/get-activity";
import { changeLabel } from "@/lib/weights/view";

// What the activity log says about each entry (issue #150, SPEC §4.3). Pure
// and client-safe: the phone's /activity and the kitchen screen's
// /kiosk/activity both render from `get_activity`. Times are Berlin wall
// time.

const at = (iso: string) => formatBerlinDateTime(new Date(iso));

/** When it happened, in Berlin time. */
export function entryTime(e: Pick<ActivityView, "at">): string {
  return at(e.at);
}

/** "Ryan did Trash", plus who logged it when that was someone else. */
export function choreTitle(
  c: Pick<ActivityChoreView, "doneBy" | "loggedBy" | "choreName">,
): string {
  const title = `${c.doneBy.displayName} did ${c.choreName}`;
  return c.loggedBy.memberId === c.doneBy.memberId
    ? title
    : `${title} (logged by ${c.loggedBy.displayName})`;
}

const VOID_REASONS: Record<string, string> = {
  undone: "undone",
  conceded: "conceded",
  disputed: "disputed",
  // History only: the partner confirm mode is gone (§12 decision 29).
  unconfirmed: "expired",
};

/** Where a logged chore stands, and what happens next if nobody acts. */
export function choreStatusLine(
  c: Pick<
    ActivityChoreView,
    | "status"
    | "voidReason"
    | "windowEndsAt"
    | "dispute"
    | "photoUrl"
    | "totalPts"
  >,
): string {
  const points = c.totalPts !== null ? `+${c.totalPts}. ` : "";
  switch (c.status) {
    case "pending":
      return `${points}Final at ${at(c.windowEndsAt)} unless someone disputes it.`;
    case "disputed": {
      const who = c.dispute?.raisedBy.displayName ?? "Someone";
      const reason = c.dispute ? `: "${c.dispute.reason}"` : "";
      const next = c.photoUrl
        ? "It has a photo, so it stays disputed until the dispute is withdrawn, conceded or ruled on."
        : `Without a photo it is voided at ${at(c.windowEndsAt)}.`;
      return `Disputed by ${who}${reason}. ${next}`;
    }
    case "voided": {
      const why = c.voidReason
        ? (VOID_REASONS[c.voidReason] ?? c.voidReason)
        : null;
      return `Voided${why ? ` (${why})` : ""}.`;
    }
    default:
      return `${points}Settled.`;
  }
}

/** "10 → 14 pts", plus the cooldown only when it changes. */
function pointsChange(e: {
  fromPoints: number;
  toPoints: number;
  fromCooldownMinutes: number;
  toCooldownMinutes: number;
}): string {
  return e.fromCooldownMinutes === e.toCooldownMinutes
    ? `${e.fromPoints} → ${e.toPoints} pts`
    : changeLabel(e);
}

const OUTCOMES: Record<string, string> = {
  withdrawn: "Withdrawn.",
  conceded: "Conceded.",
  undone: "Undone.",
  upheld: "Upheld by an admin.",
  overruled: "Voided by an admin.",
  expired: "Expired with no photo, so the chore was voided.",
};

/** One line for every entry that is not a logged chore. */
export function entryLine(e: Exclude<ActivityView, ActivityChoreView>): string {
  switch (e.kind) {
    case "dispute": {
      const outcome = e.resolution
        ? (OUTCOMES[e.resolution] ?? e.resolution)
        : "Still open.";
      return `${e.raisedBy.displayName} disputed ${e.doneBy.displayName}'s ${e.choreName}: "${e.reason}". ${outcome}`;
    }
    case "bounty": {
      const who = e.by?.displayName ?? "Someone";
      return `${who} ${e.change} the bounty ${e.choreName}.`;
    }
    case "points": {
      const change = pointsChange(e);
      const reason = e.reason ? ` Reason: ${e.reason}` : "";
      switch (e.event) {
        case "scheduled": {
          // Said by what became of it: only a waiting change can be vetoed.
          const when = at(e.appliesAt);
          const next =
            e.outcome === "pending"
              ? `from ${when} unless someone vetoes it.`
              : e.outcome === "cancelled"
                ? `for ${when}, then cancelled.`
                : `for ${when}.`;
          return `${e.by?.displayName ?? "Someone"} scheduled new points for ${e.choreName}: ${change}, ${next}${reason}`;
        }
        case "applied":
          return `New points for ${e.choreName} applied: ${change}.`;
        case "vetoed":
          return `${e.by?.displayName ?? "Someone"} vetoed new points for ${e.choreName}: ${change}.`;
      }
    }
  }
}
