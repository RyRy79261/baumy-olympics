"use server";

import { revalidatePath } from "next/cache";
import { kioskActionForm } from "@/lib/actions/kiosk";
import type { AcknowledgeNoteData } from "@/lib/actions/notes";
import type { ActionResult } from "@/lib/actions/result";

// The kitchen screen's notes seen (issue #153): a thin wrapper around the
// registry. It runs as the picked member only (the device's pick, never a
// face tapped elsewhere); with nobody picked the kiosk gate refuses it, so
// nothing is marked.

/** The picked member has the notes open on the kiosk. */
export async function kioskSeeNotesAction(
  form: FormData,
): Promise<ActionResult<AcknowledgeNoteData>> {
  const result = await kioskActionForm("acknowledge_note", form);
  // The home's Messages count drops once everyone has read them.
  if (result.ok) revalidatePath("/kiosk");
  return result;
}
