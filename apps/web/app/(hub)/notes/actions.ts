"use server";

import { revalidatePath } from "next/cache";
import type {
  AcknowledgeNoteData,
  DeleteNoteData,
  NoteWriteData,
} from "@/lib/actions/notes";
import type { ActionResult } from "@/lib/actions/result";
import { actionForm } from "@/lib/actions/ui";

// /notes's server actions: thin wrappers around the registry (SPEC §3.5).
// Each change re-renders the notes page and the hub, where pinned notes show.

type WriteResult = ActionResult<NoteWriteData>;

function refresh(): void {
  revalidatePath("/notes");
  revalidatePath("/");
}

export async function createNoteAction(
  _prev: WriteResult | null,
  form: FormData,
): Promise<WriteResult> {
  const result = await actionForm("create_note", form);
  if (result.ok) refresh();
  return result;
}

export async function updateNoteAction(
  _prev: WriteResult | null,
  form: FormData,
): Promise<WriteResult> {
  const result = await actionForm("update_note", form);
  if (result.ok) refresh();
  return result;
}

export async function pinNoteAction(
  _prev: WriteResult | null,
  form: FormData,
): Promise<WriteResult> {
  const result = await actionForm("pin_note", form);
  if (result.ok) refresh();
  return result;
}

/**
 * The member has the Board open: the notes on it are seen by them (issue
 * #153). The hub's Messages count reads it on its next render.
 */
export async function seeNotesAction(
  form: FormData,
): Promise<ActionResult<AcknowledgeNoteData>> {
  const result = await actionForm("acknowledge_note", form);
  if (result.ok) revalidatePath("/");
  return result;
}

export async function deleteNoteAction(
  _prev: ActionResult<DeleteNoteData> | null,
  form: FormData,
): Promise<ActionResult<DeleteNoteData>> {
  const result = await actionForm("delete_note", form);
  if (result.ok) refresh();
  return result;
}
