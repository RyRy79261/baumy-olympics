import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FormMessage, PageHeading, buttonClass } from "@baumy/ui";
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

// The household's notes on the kitchen iPad (SPEC §3.5, §8): anyone can read
// them; the member whose avatar was tapped can add, change, pin or delete
// one, and every change asks for their PIN in that request (SPEC §6.2).

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notes - Kiosk - Baumy" };

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
        title="Notes"
        description={
          acting
            ? "Changing a note asks for your PIN."
            : "Tap your avatar at the top to add or change a note."
        }
        actions={
          <Link href="/kiosk" className={buttonClass("secondary", "kiosk")}>
            Home
          </Link>
        }
      />
      {listed.ok ? (
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
      ) : (
        <FormMessage tone="error">{listed.message}</FormMessage>
      )}
    </>
  );
}
