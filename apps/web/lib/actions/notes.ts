import {
  countNotesUnseenByAnyone,
  countUnseenNotes,
  findNote,
  insertNote,
  listNotes as listNoteRows,
  markNotesSeen,
  setNotePinned,
  softDeleteNote,
  updateNote as updateNoteRow,
  type NoteRow,
} from "@baumy/db/notes";
import {
  ListNotesInput,
  NOTE_LIST_MAX,
  NewNote,
  NoteAcknowledge,
  NotePin,
  NoteRef,
  NoteUpdate,
  type NoteColor,
} from "@baumy/types";
import { defineAction, type ActionCtx } from "./define";
import { fail } from "./result";

// Household notes (SPEC §3.5, issue #20): short shared notes with a markdown
// body, an optional colour and a pin that puts them on the hub and the
// kitchen screen. Any member may add, change, pin or delete any note; it is
// the household's board. Every write is `member`: on the kiosk the acting
// member (the avatar tapped) writes it with no PIN, since a note touches
// nobody's points (owner ruling 2026-10-02, SPEC §12 decision 27, issue
// #145; before, every change asked the PIN).
//
// Seen (issue #153, SPEC §12 decision 30): each member has their own seen
// state per note (`note_reads`). Opening the Board, or the Messages on the
// kitchen screen as the picked member, runs `acknowledge_note`; writing a
// note marks it seen for its writer; an edit makes it unseen again for
// everyone else. `list_notes` counts the caller's unseen notes (the phone's
// Messages badge) and the notes not every active member has seen (the
// kitchen screen's).
//
// Note bodies are data. They are shown only through the sanitising markdown
// renderer (packages/ui `MarkdownBody`), and the AI sees them inside tool
// results like any other household text.

const ALL_SURFACES = ["ui", "kiosk", "ai", "mcp", "brain"] as const;

/** A note as every surface sees it. Times are ISO 8601. */
export interface NoteView {
  id: string;
  title: string;
  bodyMd: string;
  color: NoteColor | null;
  pinned: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  /** When its words last changed (pinning is not an edit). */
  editedAt: string;
  /**
   * The active members (ids, in the order they joined) who have seen its
   * words as they are now.
   */
  seenBy: string[];
}

export function noteView(n: NoteRow): NoteView {
  return {
    id: n.id,
    title: n.title,
    bodyMd: n.bodyMd,
    color: n.color as NoteColor | null,
    pinned: n.pinned,
    authorId: n.authorId,
    authorName: n.authorName,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
    editedAt: n.editedAt.toISOString(),
    seenBy: n.seenBy,
  };
}

const NOT_THERE = "That note is not there any more.";

/** The note as it is now, after a write that found it. */
async function reread(ctx: ActionCtx, id: string): Promise<NoteView> {
  const row = await findNote(ctx.db, ctx.householdId, id);
  // The write just found it in this same transaction.
  return noteView(row!);
}

/** Whoever writes a note has read it as it now is. */
async function writerHasSeen(ctx: ActionCtx, noteId: string): Promise<void> {
  await markNotesSeen(ctx.db, {
    householdId: ctx.householdId,
    memberId: ctx.actor.memberId!,
    noteIds: [noteId],
    now: ctx.now,
  });
}

export interface ListNotesData {
  notes: NoteView[];
  /**
   * How many live notes the calling member has not seen as they are now,
   * over all notes, not only the listed ones: the phone's Messages count.
   * Null for the kitchen screen with nobody picked.
   */
  unseenCount: number | null;
  /**
   * How many live notes at least one active member has not seen as they are
   * now, over all notes: the kitchen screen's Messages count.
   */
  unseenByAnyoneCount: number;
}

export const listNotes = defineAction({
  name: "list_notes",
  title: "Notes",
  description:
    "Lists the household's notes, pinned ones first and then the most recently changed, each with its id, title, markdown body, colour, whether it is pinned to the hub, who wrote it (member id and name) and when it was created, last changed and last edited (editedAt: its words; pinning is not an edit) (ISO 8601, UTC), and seenBy: the member ids who have read it since its words last changed. Also `unseenCount`: how many notes you have not read yet, and `unseenByAnyoneCount`: how many notes not every member has read yet. Notes are shared household text, never secrets.",
  consent: "Read the household's notes",
  kind: "read",
  risk: "safe",
  surfaces: ALL_SURFACES,
  // The kitchen screen shows the pinned notes before anyone taps in.
  requires: "display",
  input: ListNotesInput,
  async execute(ctx, input) {
    const memberId = ctx.actor.memberId;
    const [rows, unseenCount, unseenByAnyoneCount] = await Promise.all([
      listNoteRows(ctx.db, {
        householdId: ctx.householdId,
        pinnedOnly: input.pinnedOnly ?? false,
        limit: input.limit ?? NOTE_LIST_MAX,
      }),
      memberId
        ? countUnseenNotes(ctx.db, { householdId: ctx.householdId, memberId })
        : null,
      countNotesUnseenByAnyone(ctx.db, ctx.householdId),
    ]);
    const data: ListNotesData = {
      notes: rows.map(noteView),
      unseenCount,
      unseenByAnyoneCount,
    };
    return { ok: true, data };
  },
});

/** What a note write returns: the note as it is now. */
export interface NoteWriteData {
  note: NoteView;
}

export const createNote = defineAction({
  name: "create_note",
  title: "Add a note",
  description:
    "Adds a note for the household: a short title, an optional markdown body (bold, italic, lists, links), an optional colour and whether to pin it to the hub and the kitchen screen. Never put secrets (passwords, codes that unlock anything) in a note.",
  consent: "Add notes for the household",
  kind: "write",
  risk: "safe",
  surfaces: ALL_SURFACES,
  requires: "member",
  input: NewNote,
  async preview(_ctx, i) {
    return `Add the note "${i.title}"${i.pinned ? " and pin it" : ""}`;
  },
  async execute(ctx, i) {
    const id = await insertNote(ctx.db, {
      householdId: ctx.householdId,
      authorId: ctx.actor.memberId!,
      title: i.title,
      bodyMd: i.bodyMd ?? "",
      color: i.color ?? null,
      pinned: i.pinned ?? false,
      now: ctx.now,
    });
    await writerHasSeen(ctx, id);
    const data: NoteWriteData = { note: await reread(ctx, id) };
    return { ok: true, data, audit: { entity: "note", entityId: id } };
  },
});

export const updateNote = defineAction({
  name: "update_note",
  title: "Change a note",
  description:
    "Rewrites a note: its title, markdown body and colour are all replaced, so send the whole note (a body or colour left out is emptied). Pinning is pin_note. Anyone in the household may change any note.",
  consent: "Change the household's notes",
  kind: "write",
  risk: "confirm",
  surfaces: ALL_SURFACES,
  requires: "member",
  input: NoteUpdate,
  async preview(ctx, i) {
    const was = await findNote(ctx.db, ctx.householdId, i.noteId);
    return was && was.title !== i.title
      ? `Change the note "${was.title}" to "${i.title}"`
      : `Change the note "${i.title}"`;
  },
  async execute(ctx, i) {
    const found = await updateNoteRow(ctx.db, {
      householdId: ctx.householdId,
      id: i.noteId,
      title: i.title,
      bodyMd: i.bodyMd ?? "",
      color: i.color ?? null,
      now: ctx.now,
    });
    if (!found) return fail("NOT_FOUND", NOT_THERE);
    await writerHasSeen(ctx, i.noteId);
    const data: NoteWriteData = { note: await reread(ctx, i.noteId) };
    return { ok: true, data, audit: { entity: "note", entityId: i.noteId } };
  },
});

export const pinNote = defineAction({
  name: "pin_note",
  title: "Pin a note",
  description:
    "Pins a note to the hub and the kitchen screen (pinned: true), or takes it off (pinned: false).",
  consent: "Pin and unpin the household's notes",
  kind: "write",
  risk: "safe",
  surfaces: ALL_SURFACES,
  requires: "member",
  input: NotePin,
  async preview(ctx, i) {
    const note = await findNote(ctx.db, ctx.householdId, i.noteId);
    const title = note ? `"${note.title}"` : "the note";
    return i.pinned ? `Pin ${title} to the hub` : `Unpin ${title}`;
  },
  async execute(ctx, i) {
    const found = await setNotePinned(ctx.db, {
      householdId: ctx.householdId,
      id: i.noteId,
      pinned: i.pinned,
      now: ctx.now,
    });
    if (!found) return fail("NOT_FOUND", NOT_THERE);
    const data: NoteWriteData = { note: await reread(ctx, i.noteId) };
    return { ok: true, data, audit: { entity: "note", entityId: i.noteId } };
  },
});

export interface DeleteNoteData {
  noteId: string;
  title: string;
}

export const deleteNote = defineAction({
  name: "delete_note",
  title: "Delete a note",
  description:
    "Deletes a note for everyone in the household. Always ask before doing this.",
  consent: "Delete the household's notes",
  kind: "write",
  risk: "destructive",
  // Brain behind its confirm button (issue #70); never MCP.
  surfaces: ["ui", "kiosk", "ai", "brain"],
  requires: "member",
  input: NoteRef,
  async preview(ctx, i) {
    const note = await findNote(ctx.db, ctx.householdId, i.noteId);
    return `Delete the note ${note ? `"${note.title}"` : "(already gone)"}`;
  },
  async execute(ctx, i) {
    const deleted = await softDeleteNote(ctx.db, {
      householdId: ctx.householdId,
      id: i.noteId,
      now: ctx.now,
    });
    if (!deleted) return fail("NOT_FOUND", NOT_THERE);
    const { title } = deleted;
    const data: DeleteNoteData = { noteId: i.noteId, title };
    return {
      ok: true,
      data,
      audit: {
        entity: "note",
        entityId: i.noteId,
        payload: { noteId: i.noteId, title },
      },
    };
  },
});

export interface AcknowledgeNoteData {
  memberId: string;
  /** The notes marked seen: those asked for that are still there. */
  noteIds: string[];
}

export const acknowledgeNote = defineAction({
  name: "acknowledge_note",
  title: "Mark notes seen",
  description:
    "Records that you have read these notes as they are now. A note edited afterwards counts as unread again. Seeing one twice changes nothing.",
  consent: "Mark notes as seen by you",
  kind: "write",
  risk: "safe",
  // The phone's Board and the kitchen screen (issue #153); brain's "read"
  // button comes with issue #163.
  surfaces: ["ui", "kiosk"],
  requires: "member",
  input: NoteAcknowledge,
  async preview(_ctx, i) {
    return i.noteIds.length === 1
      ? "Mark the note as seen"
      : `Mark ${i.noteIds.length} notes as seen`;
  },
  async execute(ctx, i) {
    const memberId = ctx.actor.memberId!;
    const noteIds = await markNotesSeen(ctx.db, {
      householdId: ctx.householdId,
      memberId,
      noteIds: i.noteIds,
      now: ctx.now,
    });
    if (noteIds.length === 0) {
      return fail(
        "NOT_FOUND",
        i.noteIds.length === 1
          ? NOT_THERE
          : "Those notes are not there any more.",
      );
    }
    const data: AcknowledgeNoteData = { memberId, noteIds };
    return {
      ok: true,
      data,
      audit: {
        entity: "note",
        entityId: noteIds.length === 1 ? noteIds[0] : null,
        payload: { noteIds },
      },
    };
  },
});
