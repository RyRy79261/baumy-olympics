import { z } from "zod";
import {
  claimAbilities,
  listOpenClaims,
  listSettledClaims,
  type ClaimAbilities,
} from "@baumy/db/confirmations";
import { photoProxyUrl } from "@/lib/photos/paths";
import { defineAction } from "./define";

// "Needs your OK" (SPEC §4.3, §6.3): every claim still open at `ctx.now`, and
// for each, what the member asking may do to it now. The abilities come from
// the same `transition` the writes run, so a button is shown only when the
// write would succeed. The status is `effectiveStatus`: a claim that
// finalized or expired by time is not open, whatever the daily job has
// written. Photos are linked through /api/blob only.

const RECENT_DAYS = 7;
const RECENT_LIMIT = 10;
const DAY = 24 * 60 * 60 * 1000;

export interface ClaimView {
  completionId: string;
  choreId: string;
  choreName: string;
  confirmMode: "optimistic" | "partner";
  doneBy: string;
  doneByName: string;
  loggedBy: string;
  loggedByName: string;
  /** ISO 8601. */
  occurredAt: string;
  loggedAt: string;
  status: "pending" | "disputed";
  /** Disputes are possible until then. */
  windowEndsAt: string;
  /** Optimistic: finalizes by itself then, unless disputed. */
  finalizesAt: string | null;
  /** Partner mode: voided then if nobody confirms it. */
  expiresAt: string | null;
  /** `/api/blob?pathname=…`, never a raw Blob URL. */
  photoUrl: string | null;
  dispute: { raisedBy: string; raisedByName: string; reason: string } | null;
  /** Points while it counts; null while it does not. */
  totalPts: number | null;
  /** What the member asking may do to it right now. */
  can: ClaimAbilities;
  /** It waits on the member asking: an OK, a dispute they raised, a ruling. */
  needsYou: boolean;
}

export interface SettledClaimView {
  completionId: string;
  choreName: string;
  loggedAt: string;
  status: "finalized" | "confirmed" | "voided";
  voidReason: string | null;
  totalPts: number | null;
}

export interface PendingConfirmationsData {
  claims: ClaimView[];
  /** How many of `claims` need the member asking. */
  needsYouCount: number;
  /** The asker's own claims of the last 7 days that have settled. */
  recent: SettledClaimView[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export const getPendingConfirmations = defineAction({
  name: "get_pending_confirmations",
  title: "Claims waiting for an OK",
  description:
    "Lists the household's chore claims still waiting to settle (pending or disputed), with who did and logged each, when its dispute window ends, any open dispute and its reason, and `can`: which of confirm, dispute, withdraw, concede, undo and attach a photo you may do to it now. `needsYou` marks the ones waiting on you. `recent` lists your own claims of the last 7 days that have settled (finalized, confirmed or voided). Times are ISO 8601 in UTC.",
  consent: "See chore claims waiting for an OK",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  requires: "member",
  input: z.strictObject({}),
  async execute(ctx) {
    const me = ctx.actor.memberId!;
    // Rulings are for admins in a real session, in the UI (SPEC §6.3).
    const isAdmin =
      ctx.source === "ui" &&
      ctx.actor.kind === "member" &&
      ctx.actor.role === "admin";
    const [open, settled] = await Promise.all([
      listOpenClaims(ctx.db, { householdId: ctx.householdId, now: ctx.now }),
      listSettledClaims(ctx.db, {
        householdId: ctx.householdId,
        memberId: me,
        since: new Date(ctx.now.getTime() - RECENT_DAYS * DAY),
        now: ctx.now,
        limit: RECENT_LIMIT,
      }),
    ]);
    const claims = open.map((c): ClaimView => {
      const can = claimAbilities(
        c.row,
        c.photoPathname !== null,
        me,
        isAdmin,
        ctx.now,
      );
      return {
        completionId: c.completionId,
        choreId: c.choreId,
        choreName: c.choreName,
        confirmMode: c.confirmMode,
        doneBy: c.doneBy,
        doneByName: c.doneByName,
        loggedBy: c.loggedBy,
        loggedByName: c.loggedByName,
        occurredAt: c.occurredAt.toISOString(),
        loggedAt: c.loggedAt.toISOString(),
        status: c.status,
        windowEndsAt: c.windowEndsAt.toISOString(),
        finalizesAt: iso(c.finalizesAt),
        expiresAt: iso(c.expiresAt),
        photoUrl: c.photoPathname ? photoProxyUrl(c.photoPathname) : null,
        dispute: c.dispute
          ? {
              raisedBy: c.dispute.raisedBy,
              raisedByName: c.dispute.raisedByName,
              reason: c.dispute.reason,
            }
          : null,
        totalPts: c.totalPts,
        can,
        needsYou: can.confirm || can.withdraw || can.concede || can.resolve,
      };
    });
    const data: PendingConfirmationsData = {
      claims,
      needsYouCount: claims.filter((c) => c.needsYou).length,
      recent: settled.map((s) => ({
        completionId: s.completionId,
        choreName: s.choreName,
        loggedAt: s.loggedAt.toISOString(),
        status: s.status,
        voidReason: s.voidReason,
        totalPts: s.totalPts,
      })),
    };
    return { ok: true, data };
  },
});
