"use server";

import type { ArchiveAvatarData } from "@/lib/actions/avatars";
import type { ActionResult } from "@/lib/actions/result";
import { actionFormRefreshing } from "@/lib/actions/ui";

// /admin/avatars' server actions: thin wrappers around the registry. Adding
// a character goes through the upload route instead (lib/avatars/upload.ts).

export async function archiveAvatarAction(
  _prev: ActionResult<ArchiveAvatarData> | null,
  form: FormData,
): Promise<ActionResult<ArchiveAvatarData>> {
  return actionFormRefreshing("archive_avatar", form);
}

export async function restoreAvatarAction(
  _prev: ActionResult<ArchiveAvatarData> | null,
  form: FormData,
): Promise<ActionResult<ArchiveAvatarData>> {
  return actionFormRefreshing("restore_avatar", form);
}
