import {
  findNote,
  insertNote,
  listNotes as listNoteRows,
  setNotePinned,
  softDeleteNote,
  updateNote as updateNoteRow,
  type NoteRow,
} from "@baumy/db/notes";
import {
  ListNotesInput,
  NOTE_LIST_MAX,
  NewNote,
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
// the household's board. On the kiosk every change needs the acting
// member's PIN (SPEC §6.2), which is what `attested` means there; a phone
// session, MCP or brain is its own member and passes as it is.
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
  };
}

const NOT_THERE = "That note is not there any more.";

/** The note as it is now, after a write that found it. */
async function reread(ctx: ActionCtx, id: string): Promise<NoteView> {
  const row = await findNote(ctx.db, ctx.householdId, id);
  // The write just found it in this same transaction.
  return noteView(row!);
}

export interface ListNotesData {
  notes: NoteView[];
}

export const listNotes = defineAction({
  name: "list_notes",
  title: "Notes",
  description:
    "Lists the household's notes, pinned ones first and then the most recently changed, each with its id, title, markdown body, colour, whether it is pinned to the hub, who wrote it (member id and name) and when it was created and last changed (ISO 8601, UTC). Notes are shared household text, never secrets.",
  consent: "Read the household's notes",
  kind: "read",
  risk: "safe",
  surfaces: ALL_SURFACES,
  // The kitchen screen shows the pinned notes before anyone taps in.
  requires: "display",
  input: ListNotesInput,
  async execute(ctx, input) {
    const rows = await listNoteRows(ctx.db, {
      householdId: ctx.householdId,
      pinnedOnly: input.pinnedOnly ?? false,
      limit: input.limit ?? NOTE_LIST_MAX,
    });
    const data: ListNotesData = { notes: rows.map(noteView) };
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
  requires: "attested",
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
  requires: "attested",
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
  requires: "attested",
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
  surfaces: ["ui", "kiosk", "ai"],
  requires: "attested",
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
