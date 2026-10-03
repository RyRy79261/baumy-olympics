import { z } from "zod";

// A household note at its boundaries (SPEC §3.5, §5 `notes`): the forms on
// /notes and /kiosk/notes, `list_notes`, `create_note`, `update_note`,
// `pin_note` and `delete_note` all parse with these. Notes are short and
// shared ("plumber comes Tue", the guest wifi), never secrets.

export const NOTE_TITLE_MAX = 80;
export const NOTE_BODY_MAX = 2000;
/** The most notes `list_notes` returns at once. */
export const NOTE_LIST_MAX = 100;

/**
 * The colours a note can have, by name. The pixel UI kit (issue #7) decides
 * what each looks like; the names are what `notes.color` stores, so the
 * palette can change without a data migration.
 */
export const NOTE_COLORS = [
  "yellow",
  "pink",
  "blue",
  "green",
  "orange",
  "purple",
] as const;

export const NoteColor = z.enum(NOTE_COLORS, {
  error: "Pick one of the note colours.",
});
export type NoteColor = z.infer<typeof NoteColor>;

/** A colour, or "none" for a plain note (stored as null). */
export const NoteColorChoice = z
  .union([NoteColor, z.literal("none")], {
    error: "Pick one of the note colours.",
  })
  .transform((c): NoteColor | null => (c === "none" ? null : c));

export const NoteTitle = z
  .string({ error: "Give the note a title." })
  .trim()
  .min(1, "Give the note a title.")
  .max(NOTE_TITLE_MAX, `Keep it to ${NOTE_TITLE_MAX} characters.`);

/** Markdown. Rendered through the sanitising renderer only (packages/ui). */
export const NoteBody = z
  .string({ error: "Write the note as text." })
  .trim()
  .max(NOTE_BODY_MAX, `Keep it to ${NOTE_BODY_MAX} characters.`);

/**
 * Yes or no, from JSON (`true`) or from a form (`"true"`, or `"on"` from a
 * ticked checkbox).
 */
export const NoteFlag = z
  .union([z.boolean(), z.enum(["true", "false", "on"])], {
    error: "Say yes or no.",
  })
  .transform((v) => v === true || v === "true" || v === "on");

export const NoteId = z.uuid("Pick a note.");

export const ListNotesInput = z.strictObject({
  pinnedOnly: NoteFlag.optional().describe(
    "Only the pinned notes (the hub shows these). Default false.",
  ),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(NOTE_LIST_MAX)
    .optional()
    .describe(`How many notes at most. Default ${NOTE_LIST_MAX}.`),
});

export const NewNote = z.strictObject({
  title: NoteTitle.describe("A short title."),
  bodyMd: NoteBody.optional().describe(
    "The note itself, in markdown (bold, italic, lists, links). Optional.",
  ),
  color: NoteColorChoice.optional().describe(
    'The note\'s colour, or "none". Default none.',
  ),
  pinned: NoteFlag.optional().describe(
    "Pin it to the hub and the kitchen screen. Default false.",
  ),
});

/** A whole note's fields: an update replaces all of them (not the pin). */
export const NoteUpdate = z.strictObject({
  noteId: NoteId.describe("The note's id, from list_notes."),
  title: NoteTitle.describe("The new title."),
  bodyMd: NoteBody.optional().describe(
    "The new text, in markdown. Leaving it out empties the note.",
  ),
  color: NoteColorChoice.optional().describe(
    'The colour, or "none". Leaving it out makes the note plain.',
  ),
});

export const NotePin = z.strictObject({
  noteId: NoteId.describe("The note's id, from list_notes."),
  pinned: NoteFlag.describe("True to pin it to the hub, false to unpin it."),
});

export const NoteRef = z.strictObject({
  noteId: NoteId.describe("The note's id, from list_notes."),
});

/**
 * One or more note ids, as they are: an array (JSON, a repeated form field)
 * or one string (a form with a single note).
 */
export const NoteIds = z
  .union([z.array(z.string()), z.string()], { error: "Pick a note." })
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .pipe(
    z
      .array(NoteId)
      .min(1, "Pick a note.")
      .max(NOTE_LIST_MAX, `Mark at most ${NOTE_LIST_MAX} at once.`),
  );

/** `acknowledge_note`: the notes the member has just read (issue #153). */
export const NoteAcknowledge = z.strictObject({
  noteIds: NoteIds.describe(
    'The ids of the notes you have read, from list_notes: ["<id>"].',
  ),
});
