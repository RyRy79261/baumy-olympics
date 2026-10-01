"use server";

import { revalidatePath } from "next/cache";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { ApproveKioskPairingData } from "@/lib/actions/approve-kiosk-pairing";
import type { RenameKioskData } from "@/lib/actions/rename-kiosk";
import type { RevokeKioskData } from "@/lib/actions/revoke-kiosk";

// /admin/kitchen-screen's server actions (issue #126): thin wrappers around
// the registry. The actions themselves refuse anyone but an admin session.

const PAGE = "/admin/kitchen-screen";

export async function approveKioskPairingAction(
  _prev: ActionResult<ApproveKioskPairingData> | null,
  form: FormData,
): Promise<ActionResult<ApproveKioskPairingData>> {
  const result = await actionForm("approve_kiosk_pairing", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function renameKioskAction(
  _prev: ActionResult<RenameKioskData> | null,
  form: FormData,
): Promise<ActionResult<RenameKioskData>> {
  const result = await actionForm("rename_kiosk", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function revokeKioskAction(
  _prev: ActionResult<RevokeKioskData> | null,
  form: FormData,
): Promise<ActionResult<RevokeKioskData>> {
  const result = await actionForm("revoke_kiosk", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}
