import type { Metadata } from "next";
import { FormMessage, PageHeading } from "@baumy/ui";
import { NoteBoard } from "@/components/notes/note-board";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import {
  createNoteAction,
  deleteNoteAction,
  pinNoteAction,
  updateNoteAction,
} from "./actions";

// /notes, shown as the "Board" (SPEC §3.5; ADR 0005 §3): the household's
// sticky notes, the messages the kitchen screen counts. Pinned ones also show on
// the hub and the kitchen screen. Bodies are markdown, shown only through
// the sanitising renderer.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Board" };

export default async function NotesPage() {
  const me = await requireMemberPage();
  const listed = await runAction(
    "list_notes",
    {},
    (await uiRequestCtx(undefined))!,
  );
  return (
    <>
      <PageHeading
        title="Board"
        description="Short notes for the house, like the plumber's visit or the guest wifi. Never passwords. Pin one to show it on the hub and the kitchen screen."
      />
      {listed.ok ? (
        <NoteBoard
          notes={listed.data.notes}
          canEdit
          pinLabel={`${me.displayName}'s PIN`}
          actions={{
            create: createNoteAction,
            update: updateNoteAction,
            pin: pinNoteAction,
            remove: deleteNoteAction,
          }}
        />
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
