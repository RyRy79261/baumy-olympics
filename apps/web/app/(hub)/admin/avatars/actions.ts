"use server";

import { revalidatePath } from "next/cache";
import type { ArchiveAvatarData } from "@/lib/actions/avatars";
import type { ActionResult } from "@/lib/actions/result";
import { actionForm } from "@/lib/actions/ui";

// /admin/avatars' server actions: thin wrappers around the registry. Adding
// a character goes through the upload route instead (lib/avatars/upload.ts).

export async function archiveAvatarAction(
  _prev: ActionResult<ArchiveAvatarData> | null,
  form: FormData,
): Promise<ActionResult<ArchiveAvatarData>> {
  const result = await actionForm("archive_avatar", form);
  if (result.ok) revalidatePath("/admin/avatars");
  return result;
}

export async function restoreAvatarAction(
  _prev: ActionResult<ArchiveAvatarData> | null,
  form: FormData,
): Promise<ActionResult<ArchiveAvatarData>> {
  const result = await actionForm("restore_avatar", form);
  if (result.ok) revalidatePath("/admin/avatars");
  return result;
}
