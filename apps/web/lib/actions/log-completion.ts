import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { formatBerlinDateTime } from "@baumy/core";
import type { Queryable } from "@baumy/db";
import {
  logCompletion,
  previewCompletion,
  type CompletionRow,
  type CompletionScoreRow,
  type LogCompletionFailure,
} from "@baumy/db/completions";
import { findActiveMember } from "@baumy/db/members";
import { chores, members } from "@baumy/db/schema";
import { CompletionNote } from "@baumy/types";
import { defineAction, type RequestCtx } from "./define";
import { fail, type ActionFailure } from "./result";

// Log that someone did a chore (SPEC §4.3, §6.3): on every surface, `confirm`
// risk. `doneBy` defaults to the actor. Logging for someone else vouches for
// them, so it needs attestation: a session, MCP or brain actor is its own
// member, and the kiosk must send the LOGGER's PIN with this request.
//
// The write path is `logCompletion` (packages/db): it locks the chore,
// validates, inserts and re-scores in runAction's transaction, and a refusal
// rolls everything back, so a cooldown stores nothing.

const input = z.strictObject({
  choreId: z
    .uuid("Pick a chore.")
    .describe("The chore's id, from list_chores."),
  doneBy: z
    .uuid("Pick who did it.")
    .optional()
    .describe(
      "The member id of whoever did the chore. Defaults to you. Logging for someone else vouches for them.",
    ),
  occurredAt: z.iso
    .datetime({ offset: true, error: "Use an ISO 8601 date and time." })
    .optional()
    .describe(
      "When the chore was done, ISO 8601. Defaults to now; at most 24 hours ago, and not before the chore's last completion.",
    ),
  note: CompletionNote.optional().describe("An optional short note."),
});

type LogInput = z.output<typeof input>;

export interface LogCompletionData {
  completionId: string;
  choreId: string;
  choreName: string;
  doneBy: string;
  doneByName: string;
  loggedBy: string;
  status: CompletionRow["status"];
  occurredAt: string;
  /** False while a partner-mode claim waits for someone to confirm it. */
  counted: boolean;
  /** The stored `completion_scores` row; null while not counted. */
  totalPts: number | null;
  streakLen: number | null;
  breakPts: number | null;
  brokenMemberId: string | null;
  brokenMemberName: string | null;
  brokenLen: number | null;
}

/** Whose completion this is: the named member, or the actor. */
function doerOf(ctx: RequestCtx, i: LogInput): string {
  return i.doneBy ?? ctx.actor.memberId!;
}

async function choreName(db: Queryable, choreId: string): Promise<string> {
  const [row] = await db
    .select({ name: chores.name })
    .from(chores)
    .where(eq(chores.id, choreId))
    .limit(1);
  return row?.name ?? "That chore";
}

async function namesOf(
  db: Queryable,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const wanted = ids.filter((id): id is string => id !== null);
  const rows = await db
    .select({ id: members.id, name: members.displayName })
    .from(members)
    .where(inArray(members.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * The sentence for each way a completion is refused. Every time is Berlin
 * wall time, since that is the household's clock.
 */
export function completionFailure(
  r: LogCompletionFailure,
  name: string,
): ActionFailure {
  switch (r.code) {
    case "COOLDOWN":
      return fail(
        "COOLDOWN",
        `${name} was done recently. You can log it again from ${formatBerlinDateTime(r.retryAt)} (Berlin time).`,
        { retryAt: r.retryAt.toISOString() },
      );
    case "FUTURE":
      return fail(
        "FUTURE",
        "That time is in the future. Log it once it is done.",
      );
    case "BACKDATE_TOO_FAR":
      return fail(
        "BACKDATE_TOO_FAR",
        "That was more than 24 hours ago. Chores can be logged at most a day late.",
      );
    case "OUT_OF_ORDER":
      return fail(
        "OUT_OF_ORDER",
        `${name} was already logged after that time. Only log what happened since.`,
      );
    case "SEASON_CLOSED":
      return fail(
        "SEASON_CLOSED",
        "That season is closed, so nothing more can be logged in it.",
      );
    case "PHOTO_REQUIRED":
      return fail("PHOTO_REQUIRED", `${name} needs a photo as proof.`);
    case "ARCHIVED_CHORE":
      return fail(
        "ARCHIVED_CHORE",
        `${name} is archived. Ask an admin to restore it first.`,
      );
    case "NO_RULE_VERSION":
      return fail(
        "NO_RULE_VERSION",
        `${name} has no points set for that time yet. Ask an admin to set them.`,
      );
    case "CHORE_NOT_FOUND":
      return fail("NOT_FOUND", "That chore was not found.");
    case "REQUEST_ID_REUSED":
      return fail(
        "IDEMPOTENCY_CONFLICT",
        "This request id was already used for something else. Start again.",
      );
  }
}

const NOT_A_MEMBER = fail(
  "NOT_FOUND",
  "That person is not an active member of the household.",
);

export const logCompletionAction = defineAction({
  name: "log_completion",
  title: "Log a chore",
  description:
    "Logs that a household member did a chore and scores it (streaks and break bonuses). doneBy defaults to you; logging for someone else vouches for them. Refused with COOLDOWN (and retryAt) if the chore was done too recently, and with other codes for times in the future, more than 24h ago, or before the chore's last completion. Get chore and member ids from list_chores and whoami.",
  consent: "Log chores as done for you or, vouching for them, your housemates",
  kind: "write",
  risk: "confirm",
  surfaces: ["ui", "kiosk", "ai", "mcp", "brain"],
  requires: (ctx, i) =>
    i.doneBy !== undefined && i.doneBy !== ctx.actor.memberId
      ? "attested"
      : "member",
  input,
  async preview(ctx, i) {
    const doneBy = doerOf(ctx, i);
    const doer = await findActiveMember(ctx.db, ctx.householdId, doneBy);
    if (!doer) return NOT_A_MEMBER.message;
    const r = await previewCompletion(ctx.db, {
      householdId: ctx.householdId,
      choreId: i.choreId,
      doneBy,
      loggedBy: ctx.actor.memberId!,
      occurredAt: i.occurredAt ? new Date(i.occurredAt) : ctx.now,
      now: ctx.now,
    });
    if (!r.ok) {
      return completionFailure(r, await choreName(ctx.db, i.choreId)).message;
    }
    const s = r.score;
    let line = `Log ${r.choreName} for ${doer.displayName}: +${s.totalPts} (streak ${s.streakLen})`;
    if (s.brokenMemberId) {
      const names = await namesOf(ctx.db, [s.brokenMemberId]);
      line += `, breaking ${names.get(s.brokenMemberId) ?? "someone"}'s streak of ${s.brokenLen} for +${s.breakPts}`;
    }
    if (!r.counted) line += ", once someone else confirms it";
    return line;
  },
  async execute(ctx, i) {
    const doneBy = doerOf(ctx, i);
    if (doneBy !== ctx.actor.memberId) {
      const doer = await findActiveMember(ctx.db, ctx.householdId, doneBy);
      if (!doer) return NOT_A_MEMBER;
    }
    const r = await logCompletion(ctx.db, {
      householdId: ctx.householdId,
      choreId: i.choreId,
      doneBy,
      loggedBy: ctx.actor.memberId!,
      occurredAt: i.occurredAt ? new Date(i.occurredAt) : ctx.now,
      source: ctx.source,
      clientRequestId: ctx.requestId!,
      now: ctx.now,
      note: i.note ?? null,
    });
    if (!r.ok) {
      return completionFailure(r, await choreName(ctx.db, i.choreId));
    }
    const c = r.completion;
    const s: CompletionScoreRow | null = r.score;
    const names = await namesOf(ctx.db, [c.doneBy, s?.brokenMemberId ?? null]);
    const data: LogCompletionData = {
      completionId: c.id,
      choreId: c.choreId,
      choreName: await choreName(ctx.db, c.choreId),
      doneBy: c.doneBy,
      doneByName: names.get(c.doneBy) ?? "",
      loggedBy: c.loggedBy,
      status: c.status,
      occurredAt: c.occurredAt.toISOString(),
      counted: s !== null,
      totalPts: s?.totalPts ?? null,
      streakLen: s?.streakLen ?? null,
      breakPts: s?.breakPts ?? null,
      brokenMemberId: s?.brokenMemberId ?? null,
      brokenMemberName: s?.brokenMemberId
        ? (names.get(s.brokenMemberId) ?? null)
        : null,
      brokenLen: s?.brokenLen ?? null,
    };
    return {
      ok: true,
      data,
      audit: { entity: "completion", entityId: c.id },
    };
  },
});
