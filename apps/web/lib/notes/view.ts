import { formatBerlinDateTime } from "@baumy/core";
import { NOTE_COLORS, type NoteColor } from "@baumy/types";
import type { NoteView } from "@/lib/actions/notes";

// What the notes board says about a note (SPEC §3.5). Pure and client-safe.

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
