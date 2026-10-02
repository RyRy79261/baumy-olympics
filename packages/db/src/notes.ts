import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Queryable } from "./index";
import { members, noteReads, notes } from "./schema";

// Household notes (SPEC §3.5, §5 `notes`). Every function takes the caller's
// handle (the action's transaction for writes), and none writes an audit row:
// runAction does that (AGENTS.md). A deleted note (`deleted_at` set) is gone
// as far as every function here is concerned; nothing brings it back.
//
// Seen (issue #153, `note_reads`): a member has seen a note while their
// `seen_at` is at or after the moment its words last changed (`edited_at`,
// else `created_at`). An edit therefore makes it unseen again for everyone
// who has not opened it since. Pinning is not an edit, so it never does.

export interface NoteRow {
  id: string;
  title: string;
  bodyMd: string;
  color: string | null;
  pinned: boolean;
  authorId: string;
  authorName: string;
  createdAt: Date;
  updatedAt: Date;
  /** When its words last changed: `edited_at`, else when it was added. */
  editedAt: Date;
  /**
   * The active members who have seen its words as they are now, in the
   * order they joined.
   */
  seenBy: string[];
}

/** When a note's words last changed. */
const editedAtSql = sql`coalesce(${notes.editedAt}, ${notes.createdAt})`;

/**
 * Whether `member` (a member id, or a column holding one) has seen the
 * note's words as they are now.
 */
function seenBy(member: PgColumn | string): SQL {
  return sql`exists (select 1 from ${noteReads} where ${noteReads.noteId} = ${notes.id} and ${noteReads.memberId} = ${member} and ${noteReads.seenAt} >= ${editedAtSql})`;
}

const noteColumns = {
  id: notes.id,
  title: notes.title,
  bodyMd: notes.bodyMd,
  color: notes.color,
  pinned: notes.pinned,
  authorId: notes.authorId,
  authorName: members.displayName,
  createdAt: notes.createdAt,
  updatedAt: notes.updatedAt,
  editedAt: sql<Date>`${editedAtSql}`
    .mapWith(notes.createdAt)
    .as("edited_at"),
};

function live(householdId: string, id?: string) {
  return and(
    eq(notes.householdId, householdId),
    isNull(notes.deletedAt),
    id === undefined ? undefined : eq(notes.id, id),
  );
}

/** Each note's `seenBy`: the reads of its current words by active members. */
async function withSeenBy(
  db: Queryable,
  rows: Omit<NoteRow, "seenBy">[],
): Promise<NoteRow[]> {
  if (rows.length === 0) return [];
  const reads = await db
    .select({ noteId: noteReads.noteId, memberId: noteReads.memberId })
    .from(noteReads)
    .innerJoin(notes, eq(notes.id, noteReads.noteId))
    .innerJoin(members, eq(members.id, noteReads.memberId))
    .where(
      and(
        inArray(
          noteReads.noteId,
          rows.map((r) => r.id),
        ),
        isNull(members.deactivatedAt),
        gte(noteReads.seenAt, editedAtSql),
      ),
    )
    .orderBy(asc(members.createdAt), asc(members.id));
  return rows.map((r) => ({
    ...r,
    seenBy: reads.filter((x) => x.noteId === r.id).map((x) => x.memberId),
  }));
}

/** The live notes, pinned first, then the most recently changed. */
export async function listNotes(
  db: Queryable,
  input: { householdId: string; pinnedOnly?: boolean; limit: number },
): Promise<NoteRow[]> {
  const rows = await db
    .select(noteColumns)
    .from(notes)
    .innerJoin(members, eq(members.id, notes.authorId))
    .where(
      and(
        live(input.householdId),
        input.pinnedOnly ? eq(notes.pinned, true) : undefined,
      ),
    )
    .orderBy(desc(notes.pinned), desc(notes.updatedAt), desc(notes.id))
    .limit(input.limit);
  return withSeenBy(db, rows);
}

/**
 * How many live notes this member has not seen as they are now (the phone's
 * Messages count, issue #153), over every note.
 */
export async function countUnseenNotes(
  db: Queryable,
  input: { householdId: string; memberId: string },
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notes)
    .where(and(live(input.householdId), sql`not ${seenBy(input.memberId)}`));
  return Number(row?.n ?? 0);
}

/**
 * How many live notes at least one active member has not seen as they are
 * now: the kitchen screen's Messages count, which shows a number until every
 * member has read the message (issue #153).
 */
export async function countNotesUnseenByAnyone(
  db: Queryable,
  householdId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notes)
    .where(
      and(
        live(householdId),
        sql`exists (select 1 from ${members} where ${and(
          eq(members.householdId, householdId),
          isNull(members.deactivatedAt),
        )} and not ${seenBy(members.id)})`,
      ),
    );
  return Number(row?.n ?? 0);
}

/**
 * Mark live notes of the household as seen by a member at `now`. Seeing one
 * again moves `seen_at` forward, never back. Returns the ids it marked, in
 * the order given and without repeats; a note that is deleted, not there or
 * another household's is left out.
 */
export async function markNotesSeen(
  db: Queryable,
  input: {
    householdId: string;
    memberId: string;
    noteIds: readonly string[];
    now: Date;
  },
): Promise<string[]> {
  if (input.noteIds.length === 0) return [];
  const found = await db
    .select({ id: notes.id })
    .from(notes)
    .where(and(live(input.householdId), inArray(notes.id, [...input.noteIds])));
  const there = new Set(found.map((n) => n.id));
  const marked = [...new Set(input.noteIds)].filter((id) => there.has(id));
  if (marked.length === 0) return [];
  await db
    .insert(noteReads)
    .values(
      marked.map((noteId) => ({
        noteId,
        memberId: input.memberId,
        seenAt: input.now,
      })),
    )
    .onConflictDoUpdate({
      target: [noteReads.noteId, noteReads.memberId],
      set: { seenAt: sql`greatest(${noteReads.seenAt}, excluded.seen_at)` },
    });
  return marked;
}

/** One live note of the household, or null (missing, deleted, elsewhere). */
export async function findNote(
  db: Queryable,
  householdId: string,
  id: string,
): Promise<NoteRow | null> {
  const rows = await db
    .select(noteColumns)
    .from(notes)
    .innerJoin(members, eq(members.id, notes.authorId))
    .where(live(householdId, id))
    .limit(1);
  const [row] = await withSeenBy(db, rows);
  return row ?? null;
}

export interface NoteFields {
  title: string;
  bodyMd: string;
  color: string | null;
}

/** Add a note; returns its id. */
export async function insertNote(
  db: Queryable,
  input: NoteFields & {
    householdId: string;
    authorId: string;
    pinned: boolean;
    now: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(notes)
    .values({
      householdId: input.householdId,
      authorId: input.authorId,
      title: input.title,
      bodyMd: input.bodyMd,
      color: input.color,
      pinned: input.pinned,
      createdAt: input.now,
      updatedAt: input.now,
      editedAt: input.now,
    })
    .returning({ id: notes.id });
  return row!.id;
}

/** Replace a live note's fields. False when there is no such live note. */
export async function updateNote(
  db: Queryable,
  input: NoteFields & { householdId: string; id: string; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(notes)
    .set({
      title: input.title,
      bodyMd: input.bodyMd,
      color: input.color,
      updatedAt: input.now,
      editedAt: input.now,
    })
    .where(live(input.householdId, input.id))
    .returning({ id: notes.id });
  return rows.length > 0;
}

/**
 * Pin or unpin a live note. It counts as a change, so a note pinned just now
 * comes first among the pinned. False when there is no such live note.
 */
export async function setNotePinned(
  db: Queryable,
  input: { householdId: string; id: string; pinned: boolean; now: Date },
): Promise<boolean> {
  const rows = await db
    .update(notes)
    .set({ pinned: input.pinned, updatedAt: input.now })
    .where(live(input.householdId, input.id))
    .returning({ id: notes.id });
  return rows.length > 0;
}

/**
 * Soft-delete a live note: it stays in the table (the audit trail points at
 * it) but no read returns it. Returns the deleted note's title, or null when
 * there is no such live note, so a second delete of the same note finds
 * nothing.
 */
export async function softDeleteNote(
  db: Queryable,
  input: { householdId: string; id: string; now: Date },
): Promise<{ title: string } | null> {
  const [row] = await db
    .update(notes)
    .set({ deletedAt: input.now })
    .where(live(input.householdId, input.id))
    .returning({ title: notes.title });
  return row ?? null;
}
