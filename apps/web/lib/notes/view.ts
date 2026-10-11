import { formatBerlinDateTime } from "@baumy/core";
import { NOTE_COLORS, type NoteColor } from "@baumy/types";
import type { NoteView } from "@/lib/actions/notes";

// What the notes board says about a note (SPEC §3.5). Pure and client-safe.

/**
 * How long a note counts as new after it was posted or its words last
 * changed (issue #194, SPEC §12 decision 37): only then can it be unread, in
 * the Messages badges and the kitchen screen's Messages list, for everyone.
 */
export const NOTE_NEW_MS = 3 * 24 * 60 * 60_000;

/** The instant a note's words must have changed after to count as new. */
export function noteNewSince(now: Date): Date {
  return new Date(now.getTime() - NOTE_NEW_MS);
}

/** Whether a note is new at `now`: its words changed in the last 3 days. */
export function isNoteNew(n: Pick<NoteView, "editedAt">, now: Date): boolean {
  return Date.parse(n.editedAt) > noteNewSince(now).getTime();
}

/** "By Ryan · Sun 27 Sep, 12:00", with "changed" once it was edited. */
export function noteMeta(
  n: Pick<NoteView, "authorName" | "createdAt" | "updatedAt">,
): string {
  const edited = n.updatedAt !== n.createdAt;
  const when = formatBerlinDateTime(
    new Date(edited ? n.updatedAt : n.createdAt),
  );
  return `By ${n.authorName} · ${edited ? "changed " : ""}${when}`;
}

const LABELS: Record<NoteColor, string> = {
  yellow: "Yellow",
  pink: "Pink",
  blue: "Blue",
  green: "Green",
  orange: "Orange",
  purple: "Purple",
};

/** The colour picker's options, "none" first. */
export const NOTE_COLOR_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "none", label: "Plain" },
  ...NOTE_COLORS.map((c) => ({ value: c, label: LABELS[c] })),
];
