// The review list's rules (SPEC §3.6), pure and client-safe, so the sheet
// (components/baumy) stays a thin view over them.
//
// - Every write Baumy wants to do is a suggestion card with two buttons for
//   all of them: "Confirm all" and "Cancel" (owner ruling 2026-09-29, issue
//   #107). Confirm all runs every valid card still waiting (or that failed),
//   in order, destructive ones included; an invalid card never runs. On the
//   kiosk it asks the acting member's PIN once, for the cards that need it.
//   A card's × drops just that one first; Cancel rejects them all.
// - A card that saved stays saved: Confirm all again after a partial save
//   never sends it twice, and even if it did, its proposal id is the
//   idempotency key, so the server would replay the stored result.

import type { ActionResult } from "@/lib/actions/result";
import type { HistoryTurn } from "./command";
import type { Proposal } from "./proposal";

export type RowState = "pending" | "saving" | "saved" | "failed" | "rejected";

export interface ReviewRow {
  proposal: Proposal;
  state: RowState;
  message?: string;
  /** The server asked for the member's PIN (kiosk). */
  needsPin: boolean;
}

/** Results that mean "ask for the PIN" (lib/kiosk/constants.ts). */
export function asksForPin(
  result: ActionResult<unknown>,
  pinCodes: ReadonlySet<string>,
): boolean {
  return !result.ok && pinCodes.has(result.code);
}

export function rowsFor(proposals: readonly Proposal[]): ReviewRow[] {
  return proposals.map((p) => ({
    proposal: p,
    state: "pending",
    needsPin: p.needsPin,
  }));
}

/** Whether a row is still open: waiting, or failed and worth another go. */
export function isOpen(row: ReviewRow): boolean {
  return row.state === "pending" || row.state === "failed";
}

/** Whether a row can be approved now. */
export function canApprove(row: ReviewRow): boolean {
  return row.proposal.valid && isOpen(row);
}

/**
 * Result codes after which Confirm all sends the PIN no more: it was wrong,
 * or the member's PIN is resting or locked. Each try counts against it.
 */
const PIN_STOP_CODES: ReadonlySet<string> = new Set([
  "ATTESTATION_REQUIRED",
  "ATTESTATION_FAILED",
  "RATE_LIMITED",
  "PIN_LOCKED",
]);

export function stopsPin(code: string): boolean {
  return PIN_STOP_CODES.has(code);
}

/**
 * The rows "Confirm all" runs, in order: every valid suggestion still
 * waiting (or that failed), the destructive ones and those that need a PIN
 * included. Invalid, dropped and saved rows never run.
 */
export function confirmAllTargets(rows: readonly ReviewRow[]): ReviewRow[] {
  return rows.filter(canApprove);
}

/** Whether "Confirm all" must ask the acting member's PIN first (kiosk). */
export function confirmNeedsPin(
  rows: readonly ReviewRow[],
  kiosk: boolean,
): boolean {
  return kiosk && confirmAllTargets(rows).some((r) => r.needsPin);
}

/** The cards on screen: every suggestion but those dropped with ×. */
export function visibleRows(rows: readonly ReviewRow[]): ReviewRow[] {
  return rows.filter((r) => r.state !== "rejected");
}

/** How a card looks: red when it deletes, greyed when it cannot run. */
export function cardTone(row: ReviewRow): "destructive" | "invalid" | "normal" {
  if (!row.proposal.valid) return "invalid";
  return row.proposal.risk === "destructive" ? "destructive" : "normal";
}

/** Every suggestion, open or not, rejected: what Cancel does. */
export function cancelAll(rows: readonly ReviewRow[]): ReviewRow[] {
  return rows.map((r) =>
    isOpen(r) ? { ...r, state: "rejected", message: undefined } : r,
  );
}

/** A short line for a saved row, from the action's result. */
export function savedMessage(data: unknown): string {
  const d = (data ?? {}) as { totalPts?: unknown; counted?: unknown };
  if (typeof d.totalPts === "number") return `Saved: +${d.totalPts} points.`;
  if (d.counted === false) return "Saved. It counts once someone confirms it.";
  return "Saved.";
}

/** The input with one field set, or removed when emptied. */
export function withField(
  input: Readonly<Record<string, unknown>>,
  name: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...input };
  if (value === "" || value === undefined || value === null) delete next[name];
  else next[name] = value;
  return next;
}

/** The conversation to send with the next command, newest last. */
export function nextHistory(
  history: readonly HistoryTurn[],
  text: string,
  reply: string,
  keep = 12,
): HistoryTurn[] {
  return [
    ...history,
    { role: "user" as const, text },
    { role: "assistant" as const, text: reply },
  ].slice(-keep);
}
