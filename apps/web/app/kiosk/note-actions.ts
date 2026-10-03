"use server";

import { kioskActionForm } from "@/lib/actions/kiosk";
import type { AcknowledgeNoteData } from "@/lib/actions/notes";
import type { ActionResult } from "@/lib/actions/result";

// The kitchen screen's notes seen (issue #153): a thin wrapper around the
// registry. It runs as the picked member only (the device's pick, never a
// face tapped elsewhere); with nobody picked the kiosk gate refuses it, so
// nothing is marked.
//
// It revalidates nothing: a re-render while the Messages box is open would
// pull a note out from under the last member reading it. The box keeps the
// rows it opened with and refreshes the page when it closes
// (components/kiosk/dashboard/dashboard-header.tsx); the Board's notes do
// not move when they are seen.

/** The picked member has the notes open on the kiosk. */
export async function kioskSeeNotesAction(
  form: FormData,
): Promise<ActionResult<AcknowledgeNoteData>> {
  return kioskActionForm("acknowledge_note", form);
}
