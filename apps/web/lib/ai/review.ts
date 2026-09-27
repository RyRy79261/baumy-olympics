// The review list's rules (SPEC §3.6), pure and client-safe, so the sheet
// (components/baumy) stays a thin view over them.
//
// - Each row is approved or rejected on its own. "Approve all" approves the
//   rows still waiting (or that failed) except those marked destructive,
//   those that are not valid, and on the kiosk those that need a PIN (each
//   of those asks for it on its own).
// - A row that saved stays saved: approving again, or "Approve all" after a
//   partial save, never sends it twice, and even if it did, its proposal id
//   is the idempotency key, so the server would replay the stored result.

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

/** Whether a row can be approved now. */
export function canApprove(row: ReviewRow): boolean {
  return (
    row.proposal.valid && (row.state === "pending" || row.state === "failed")
  );
}

/** The rows "Approve all" sends, in order. */
export function approveAllTargets(
  rows: readonly ReviewRow[],
  kiosk: boolean,
): ReviewRow[] {
  return rows.filter(
    (r) =>
      canApprove(r) &&
      r.proposal.risk !== "destructive" &&
      !(kiosk && r.needsPin),
  );
}

/** What "Approve all" leaves for the member to do one by one. */
export function approveAllSkips(
  rows: readonly ReviewRow[],
  kiosk: boolean,
): string | null {
  const open = rows.filter(
    (r) => r.state === "pending" || r.state === "failed",
  );
  const destructive = open.filter(
    (r) => r.proposal.valid && r.proposal.risk === "destructive",
  ).length;
  const invalid = open.filter((r) => !r.proposal.valid).length;
  const pin = open.filter(
    (r) =>
      r.proposal.valid &&
      r.proposal.risk !== "destructive" &&
      kiosk &&
      r.needsPin,
  ).length;
  const parts: string[] = [];
  if (destructive)
    parts.push(
      `${destructive} that delete${destructive === 1 ? "s" : ""} something`,
    );
  if (invalid)
    parts.push(`${invalid} that ${invalid === 1 ? "isn't" : "aren't"} valid`);
  if (pin) parts.push(`${pin} that need${pin === 1 ? "s" : ""} your PIN`);
  return parts.length > 0
    ? `Approve all skips ${parts.join(", ")}: approve or reject those one by one.`
    : null;
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
