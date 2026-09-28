import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { Queryable } from "./index";
import { members, notes } from "./schema";

// Household notes (SPEC §3.5, §5 `notes`). Every function takes the caller's
// handle (the action's transaction for writes), and none writes an audit row:
// runAction does that (AGENTS.md). A deleted note (`deleted_at` set) is gone
// as far as every function here is concerned; nothing brings it back.

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
};

function live(householdId: string, id?: string) {
  return and(
    eq(notes.householdId, householdId),
    isNull(notes.deletedAt),
    id === undefined ? undefined : eq(notes.id, id),
  );
}

/** The live notes, pinned first, then the most recently changed. */
export async function listNotes(
  db: Queryable,
  input: { householdId: string; pinnedOnly?: boolean; limit: number },
): Promise<NoteRow[]> {
  return db
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
}

/**
 * How many live notes were added or had their words edited after `since`
 * (the Messages count, ADR 0005 §3). Pinning and unpinning are not edits.
 */
export async function countNotesEditedSince(
  db: Queryable,
  input: { householdId: string; since: Date },
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notes)
    .where(
      and(
        live(input.householdId),
        gt(sql`coalesce(${notes.editedAt}, ${notes.createdAt})`, input.since),
      ),
    );
  return Number(row?.n ?? 0);
}

/** One live note of the household, or null (missing, deleted, elsewhere). */
export async function findNote(
  db: Queryable,
  householdId: string,
  id: string,
): Promise<NoteRow | null> {
  const [row] = await db
    .select(noteColumns)
    .from(notes)
    .innerJoin(members, eq(members.id, notes.authorId))
    .where(live(householdId, id))
    .limit(1);
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
