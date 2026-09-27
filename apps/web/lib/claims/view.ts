import { formatBerlinDateTime } from "@baumy/core";
import type {
  ClaimView,
  SettledClaimView,
} from "@/lib/actions/get-pending-confirmations";

// What "Needs your OK" says about a claim (SPEC §4.3). Pure and client-safe:
// the phone's inbox and the kiosk banner both render from
// `get_pending_confirmations`. Times are Berlin wall time.

const at = (iso: string) => formatBerlinDateTime(new Date(iso));

/** "Ryan did Trash", plus who logged it when that was someone else. */
export function claimTitle(
  c: Pick<
    ClaimView,
    "doneBy" | "doneByName" | "loggedBy" | "loggedByName" | "choreName"
  >,
): string {
  const title = `${c.doneByName} did ${c.choreName}`;
  return c.loggedBy === c.doneBy
    ? title
    : `${title} (logged by ${c.loggedByName})`;
}

/** Where the claim stands and what happens next if nobody acts. */
export function claimStatusLine(
  c: Pick<
    ClaimView,
    | "status"
    | "confirmMode"
    | "finalizesAt"
    | "expiresAt"
    | "windowEndsAt"
    | "dispute"
    | "photoUrl"
    | "totalPts"
  >,
): string {
  if (c.status === "disputed") {
    const who = c.dispute?.raisedByName ?? "Someone";
    const reason = c.dispute ? `: "${c.dispute.reason}"` : "";
    const next = c.photoUrl
      ? "It has a photo, so it stays disputed until the dispute is withdrawn, conceded or ruled on."
      : `Without a photo it is voided at ${at(c.windowEndsAt)}.`;
    return `Disputed by ${who}${reason}. ${next}`;
  }
  if (c.confirmMode === "partner") {
    return `Counts once someone else confirms it. Voided at ${at(c.expiresAt!)} if nobody does.`;
  }
  const points = c.totalPts !== null ? `+${c.totalPts}, ` : "";
  return `${points}final at ${at(c.finalizesAt!)} unless someone disputes it.`;
}

const VOID_REASONS: Record<string, string> = {
  undone: "undone",
  conceded: "conceded",
  disputed: "disputed",
  unconfirmed: "nobody confirmed it",
};

/** "Trash: finalized, +20" or "Trash: voided (undone)". */
export function settledLabel(s: SettledClaimView): string {
  if (s.status === "voided") {
    const why = s.voidReason
      ? (VOID_REASONS[s.voidReason] ?? s.voidReason)
      : null;
    return `${s.choreName}: voided${why ? ` (${why})` : ""}`;
  }
  const points = s.totalPts !== null ? `, +${s.totalPts}` : "";
  return `${s.choreName}: ${s.status}${points}`;
}

/** "1 claim needs your OK", "3 claims need your OK". */
export function needsOkLabel(count: number): string {
  return count === 1 ? "1 claim needs your OK" : `${count} claims need your OK`;
}
