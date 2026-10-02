import type { Metadata } from "next";
import { FormMessage, PageHeading } from "@baumy/ui";
import { MarkNotesSeen } from "@/components/notes/mark-notes-seen";
import { NoteBoard } from "@/components/notes/note-board";
import { runAction } from "@/lib/actions/registry";
import { uiRequestCtx } from "@/lib/actions/ui";
import { requireMemberPage } from "@/lib/auth";
import {
  createNoteAction,
  deleteNoteAction,
  pinNoteAction,
  seeNotesAction,
  updateNoteAction,
} from "./actions";

// /notes, shown as the "Board" (SPEC §3.5; ADR 0005 §3): the household's
// sticky notes, the messages the kitchen screen counts. Pinned ones also show on
// the hub and the kitchen screen. Bodies are markdown, shown only through
// the sanitising renderer. Opening it marks the notes on it seen by this
// member (issue #153), which is what the hub's Messages count counts.

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
        <>
          <MarkNotesSeen
            noteIds={listed.data.notes
              .filter((n) => !n.seenBy.includes(me.memberId))
              .map((n) => n.id)}
            action={seeNotesAction}
          />
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
        </>
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
