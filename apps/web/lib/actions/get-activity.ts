import { z } from "zod";
import type { CompletionStatus } from "@baumy/core";
import {
  listActivity,
  type ActivityEntry,
  type ActivityMember,
} from "@baumy/db/activity";
import { claimAbilities, type ClaimAbilities } from "@baumy/db/confirmations";
import { photoProxyUrl } from "@/lib/photos/paths";
import { defineAction } from "./define";
import { vetoWeight } from "./weights";

// The activity log (issue #150, SPEC §4.3): what happened in the house,
// newest first. Owner (2026-10-02): "What you're describing is an activity
// log, which is cool, but it's not an inbox, that is for messages." It
// replaces "Needs your OK": there is no confirming (§12 decision 29).
//
// One read for the phone's /activity, the kitchen screen's /kiosk/activity,
// the AI command, MCP and brain. A chore entry says what the member asking
// may do to it right now (`can`: dispute while its window is open, withdraw,
// concede, undo; an admin's ruling on the phone), judged by the same
// `transition` the writes run, so a button shows only when the write would
// succeed. A scheduled points change says whether they may veto it, where
// `veto_weight` is offered. Times are ISO 8601; photos only through
// /api/blob.

/** How far back the log reads. */
export const ACTIVITY_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const NOBODY: ClaimAbilities = {
  dispute: false,
  withdraw: false,
  concede: false,
  undo: false,
  resolve: false,
  attachPhoto: false,
};

export type ActivityMemberView = ActivityMember;

export interface ActivityChoreView {
  kind: "chore";
  /** Stable across reads, for lists. */
  id: string;
  at: string;
  completionId: string;
  choreId: string;
  choreName: string;
  doneBy: ActivityMemberView;
  loggedBy: ActivityMemberView;
  occurredAt: string;
  status: CompletionStatus;
  voidReason: string | null;
  /** Disputes are possible until then. */
  windowEndsAt: string;
  /** `/api/blob?pathname=…`, never a raw Blob URL. */
  photoUrl: string | null;
  dispute: { raisedBy: ActivityMemberView; reason: string } | null;
  /** Points while it counts; null while it does not. */
  totalPts: number | null;
  /** What the member asking may do to it right now. */
  can: ClaimAbilities;
}

export interface ActivityDisputeView {
  kind: "dispute";
  id: string;
  at: string;
  completionId: string;
  choreName: string;
  doneBy: ActivityMemberView;
  raisedBy: ActivityMemberView;
  reason: string;
  resolution: string | null;
  resolvedAt: string | null;
}

export interface ActivityBountyView {
  kind: "bounty";
  id: string;
  at: string;
  choreId: string;
  choreName: string;
  change: "added" | "edited";
  by: ActivityMemberView | null;
}

export interface ActivityPointsView {
  kind: "points";
  id: string;
  at: string;
  suggestionId: string;
  choreId: string;
  choreName: string;
  event: "scheduled" | "applied" | "vetoed";
  by: ActivityMemberView | null;
  fromPoints: number;
  toPoints: number;
  fromCooldownMinutes: number;
  toCooldownMinutes: number;
  appliesAt: string;
  reason: string | null;
  /** What became of it at `now`. */
  outcome: "pending" | "applied" | "vetoed" | "cancelled";
  /** The member asking may veto it now (on a `scheduled` entry only). */
  canVeto: boolean;
}

export type ActivityView =
  | ActivityChoreView
  | ActivityDisputeView
  | ActivityBountyView
  | ActivityPointsView;

export interface GetActivityData {
  /** Newest first. */
  entries: ActivityView[];
  /** How many days back the log reads. */
  days: number;
}

export const getActivity = defineAction({
  name: "get_activity",
  title: "Activity log",
  description:
    "Lists what happened in the house in the last 30 days, newest first: chores logged (who did and logged each, its status, points, any open dispute and when its dispute window ends), disputes raised and how they ended, bounties added or edited, and points changes scheduled, applied or vetoed. A chore entry's `can` says which of dispute, withdraw, concede, undo and attach a photo you may do to it now; a scheduled points change's `canVeto` says whether you may veto it. Times are ISO 8601 in UTC.",
  consent: "See the house's activity log",
  kind: "read",
  risk: "safe",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  // The kitchen screen shows it with nobody picked, without buttons.
  requires: "display",
  input: z.strictObject({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("At most this many entries (default 50)."),
  }),
  async execute(ctx, input) {
    const me = ctx.actor.memberId ?? null;
    // Rulings are for admins in a real session, in the UI (SPEC §6.3).
    const isAdmin =
      ctx.source === "ui" &&
      ctx.actor.kind === "member" &&
      ctx.actor.role === "admin";
    const vetoHere = (vetoWeight.surfaces as readonly string[]).includes(
      ctx.source,
    );
    const rows = await listActivity(ctx.db, {
      householdId: ctx.householdId,
      since: new Date(ctx.now.getTime() - ACTIVITY_DAYS * DAY),
      now: ctx.now,
      limit: input.limit ?? 50,
    });
    const data: GetActivityData = {
      entries: rows.map((e) => view(e, me, isAdmin, vetoHere, ctx.now)),
      days: ACTIVITY_DAYS,
    };
    return { ok: true, data };
  },
});

function view(
  e: ActivityEntry,
  me: string | null,
  isAdmin: boolean,
  vetoHere: boolean,
  now: Date,
): ActivityView {
  const at = e.at.toISOString();
  switch (e.kind) {
    case "chore":
      return {
        kind: "chore",
        id: `chore:${e.completionId}`,
        at,
        completionId: e.completionId,
        choreId: e.choreId,
        choreName: e.choreName,
        doneBy: e.doneBy,
        loggedBy: e.loggedBy,
        occurredAt: e.occurredAt.toISOString(),
        status: e.status,
        voidReason: e.voidReason,
        windowEndsAt: e.windowEndsAt.toISOString(),
        photoUrl: e.photoPathname ? photoProxyUrl(e.photoPathname) : null,
        dispute: e.dispute,
        totalPts: e.totalPts,
        can: me
          ? claimAbilities(e.row, e.photoPathname !== null, me, isAdmin, now)
          : NOBODY,
      };
    case "dispute":
      return {
        kind: "dispute",
        id: `dispute:${e.disputeId}`,
        at,
        completionId: e.completionId,
        choreName: e.choreName,
        doneBy: e.doneBy,
        raisedBy: e.raisedBy,
        reason: e.reason,
        resolution: e.resolution,
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
      };
    case "bounty":
      return {
        kind: "bounty",
        id: `bounty:${e.auditId}`,
        at,
        choreId: e.choreId,
        choreName: e.choreName,
        change: e.change,
        by: e.by,
      };
    case "points":
      return {
        kind: "points",
        id: `points:${e.suggestionId}:${e.event}`,
        at,
        suggestionId: e.suggestionId,
        choreId: e.choreId,
        choreName: e.choreName,
        event: e.event,
        by: e.by,
        fromPoints: e.fromPoints,
        toPoints: e.toPoints,
        fromCooldownMinutes: e.fromCooldownMinutes,
        toCooldownMinutes: e.toCooldownMinutes,
        appliesAt: e.appliesAt.toISOString(),
        reason: e.reason,
        outcome: e.outcome,
        canVeto:
          e.event === "scheduled" &&
          e.vetoable &&
          vetoHere &&
          me !== null &&
          me !== e.scheduledBy,
      };
  }
}
