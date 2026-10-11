import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormMessage, PageHeading, buttonClass } from "@baumy/ui";
import { MarkNotesSeen } from "@/components/notes/mark-notes-seen";
import { NoteBoard } from "@/components/notes/note-board";
import { kioskRequestCtx } from "@/lib/actions/kiosk";
import { runAction } from "@/lib/actions/registry";
import { getKioskActor } from "@/lib/auth";
import {
  kioskCreateNoteAction,
  kioskDeleteNoteAction,
  kioskPinNoteAction,
  kioskUpdateNoteAction,
} from "../../actions";
import { kioskSeeNotesAction } from "../../note-actions";

// The household's notes on the kitchen iPad (SPEC §3.5, §8): anyone can read
// them; the member whose avatar was tapped can add, change, pin or remove
// one, with no PIN (owner ruling 2026-10-02, issue #145; Remove, issue
// #194).
// Opened with someone picked, the notes on it are seen by that member only
// (issue #153); with nobody picked, by nobody.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Board · Kiosk" };

export default async function KioskNotesPage() {
  const kiosk = await getKioskActor();
  if (!kiosk) redirect("/kiosk/pair");
  const ctx = (await kioskRequestCtx(undefined, undefined))!;
  const listed = await runAction("list_notes", {}, ctx);
  const acting = Boolean(kiosk.memberId);
  return (
    <>
      <PageHeading
        eyebrow={kiosk.deviceName ?? "Kiosk"}
        title="Board"
        description={
          acting
            ? `Hi ${kiosk.displayName}. Add a note, or tap Remove on one that is done with.`
            : "Tap your avatar at the top to add, change or remove a note."
        }
        actions={
          <Link href="/kiosk" className={buttonClass("secondary", "kiosk")}>
            Home
          </Link>
        }
      />
      {listed.ok ? (
        <>
          {kiosk.memberId ? (
            <MarkNotesSeen
              noteIds={listed.data.notes
                .filter((n) => !n.seenBy.includes(kiosk.memberId!))
                .map((n) => n.id)}
              action={kioskSeeNotesAction}
            />
          ) : null}
          <NoteBoard
            notes={listed.data.notes}
            kiosk
            canEdit={acting}
            pinLabel={`${kiosk.displayName ?? "Your"}'s PIN`}
            actions={{
              create: kioskCreateNoteAction,
              update: kioskUpdateNoteAction,
              pin: kioskPinNoteAction,
              remove: kioskDeleteNoteAction,
            }}
          />
        </>
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
