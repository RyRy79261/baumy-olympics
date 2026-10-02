import {
  effectiveStatus,
  photoPruneAt,
  type CompletionStatus,
} from "@baumy/core";
import { and, asc, count, eq, max, or, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { aiUsage, auditEvents, completions, disputes, notes } from "./schema";

// "What do you keep about me?" (issue #144): counts and dates about ONE
// member, for the self-only `get_my_data` action. Every query here is keyed
// on that member (and the household), never on anyone else, and returns no
// text anyone wrote: no note bodies, no completion notes, no audit payloads.

export interface MemberScope {
  householdId: string;
  memberId: string;
}

export interface MyCompletionCounts {
  /** Every completion done by them, in every season. */
  total: number;
  /** By status at `now` (`effectiveStatus`), so a lazy row counts right. */
  byStatus: Record<CompletionStatus, number>;
}

export interface MyPhoto {
  attachedAt: Date;
  /** Null while the claim is still open: the clock starts once it settles. */
  deletesAt: Date | null;
}

export interface MyCompletions {
  completions: MyCompletionCounts;
  /** The proof photos still stored on their completions, oldest first. */
  photos: MyPhoto[];
}

/**
 * The completions the member did, counted by status at `now`, and the proof
 * photos still stored on them with the day each is due for deletion: the
 * same `photoPruneAt` the daily job prunes by (sweep.ts).
 */
export async function myCompletions(
  db: Queryable,
  { householdId, memberId, now }: MemberScope & { now: Date },
): Promise<MyCompletions> {
  const lastRuling = db
    .select({
      completionId: disputes.completionId,
      resolvedAt: max(disputes.resolvedAt).as("last_resolved_at"),
    })
    .from(disputes)
    .groupBy(disputes.completionId)
    .as("last_ruling");
  const rows = await db
    .select({
      completion: completions,
      lastResolvedAt: lastRuling.resolvedAt,
    })
    .from(completions)
    .leftJoin(lastRuling, eq(lastRuling.completionId, completions.id))
    .where(
      and(
        eq(completions.householdId, householdId),
        eq(completions.doneBy, memberId),
      ),
    )
    .orderBy(asc(completions.loggedAt), asc(completions.id));
  const byStatus: Record<CompletionStatus, number> = {
    pending: 0,
    confirmed: 0,
    finalized: 0,
    disputed: 0,
    voided: 0,
  };
  const photos: MyPhoto[] = [];
  for (const { completion: c, lastResolvedAt } of rows) {
    const row = { ...c, disputedBy: null };
    byStatus[effectiveStatus(row, now)] += 1;
    if (c.photoPathname && c.photoAttachedAt) {
      photos.push({
        attachedAt: c.photoAttachedAt,
        deletesAt: photoPruneAt(row, now, lastResolvedAt),
      });
    }
  }
  photos.sort((a, b) => a.attachedAt.getTime() - b.attachedAt.getTime());
  return { completions: { total: rows.length, byStatus }, photos };
}

export interface MyNoteCounts {
  /** Every note they wrote, deleted or not. */
  written: number;
  /** Deleted, so hidden everywhere, but still in the database. */
  deletedKept: number;
}

export async function myNoteCounts(
  db: Queryable,
  { householdId, memberId }: MemberScope,
): Promise<MyNoteCounts> {
  const [row] = await db
    .select({
      written: count(),
      deletedKept: count(notes.deletedAt),
    })
    .from(notes)
    .where(
      and(eq(notes.householdId, householdId), eq(notes.authorId, memberId)),
    );
  return { written: row?.written ?? 0, deletedKept: row?.deletedKept ?? 0 };
}

/**
 * Audit-log entries that name the member: as the actor, as the member who
 * started it (an AI proposal they approved), or as the member row it is
 * about (`entity` = `member`, e.g. an admin renaming them, or a "Sign in with
 * Baumy" request for them).
 */
export async function countAuditEntriesNaming(
  db: Queryable,
  memberId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(auditEvents)
    .where(
      or(
        eq(auditEvents.actorMemberId, memberId),
        eq(auditEvents.initiatedByMemberId, memberId),
        and(
          eq(auditEvents.entity, "member"),
          eq(auditEvents.entityId, memberId),
        ),
      ),
    );
  return row?.n ?? 0;
}

export interface MyAiUsage {
  /** Baumy commands (one `anthropic` row each). */
  commands: number;
  inputTokens: number;
  outputTokens: number;
  /** Voice clips transcribed (one `groq` row each). */
  voiceClips: number;
  voiceSeconds: number;
  lastUsedAt: Date | null;
}

export async function myAiUsage(
  db: Queryable,
  { householdId, memberId }: MemberScope,
): Promise<MyAiUsage> {
  const anthropic = sql`${aiUsage.provider} = 'anthropic'`;
  const groq = sql`${aiUsage.provider} = 'groq'`;
  const [row] = await db
    .select({
      commands: sql<number>`count(*) filter (where ${anthropic})::int`,
      inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}) filter (where ${anthropic}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}) filter (where ${anthropic}), 0)::int`,
      voiceClips: sql<number>`count(*) filter (where ${groq})::int`,
      voiceSeconds: sql<number>`coalesce(sum(${aiUsage.audioSeconds}) filter (where ${groq}), 0)::float8`,
      lastUsedAt: max(aiUsage.at),
    })
    .from(aiUsage)
    .where(
      and(eq(aiUsage.householdId, householdId), eq(aiUsage.memberId, memberId)),
    );
  return {
    commands: Number(row?.commands ?? 0),
    inputTokens: Number(row?.inputTokens ?? 0),
    outputTokens: Number(row?.outputTokens ?? 0),
    voiceClips: Number(row?.voiceClips ?? 0),
    voiceSeconds: Number(row?.voiceSeconds ?? 0),
    lastUsedAt: row?.lastUsedAt ?? null,
  };
}
