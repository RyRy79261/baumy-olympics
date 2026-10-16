"use server";

import type {
  AcknowledgeNoteData,
  DeleteNoteData,
  NoteWriteData,
} from "@/lib/actions/notes";
import type { ActionResult } from "@/lib/actions/result";
import { actionFormRefreshing } from "@/lib/actions/ui";

// /notes's server actions: thin wrappers around the registry (SPEC §3.5).
// Each change re-renders the notes page and the hub, where pinned notes show.

type WriteResult = ActionResult<NoteWriteData>;

export async function createNoteAction(
  _prev: WriteResult | null,
  form: FormData,
): Promise<WriteResult> {
  return actionFormRefreshing("create_note", form);
}

export async function updateNoteAction(
  _prev: WriteResult | null,
  form: FormData,
): Promise<WriteResult> {
  return actionFormRefreshing("update_note", form);
}

export async function pinNoteAction(
  _prev: WriteResult | null,
  form: FormData,
): Promise<WriteResult> {
  return actionFormRefreshing("pin_note", form);
}

/**
 * The member has the Board open: the notes on it are seen by them (issue
 * #153). The hub's Messages count reads it on its next render.
 */
export async function seeNotesAction(
  form: FormData,
): Promise<ActionResult<AcknowledgeNoteData>> {
  return actionFormRefreshing("acknowledge_note", form);
}

export async function deleteNoteAction(
  _prev: ActionResult<DeleteNoteData> | null,
  form: FormData,
): Promise<ActionResult<DeleteNoteData>> {
  return actionFormRefreshing("delete_note", form);
}
