"use server";

import { actionForm, actionFormRefreshing } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { ApproveKioskPairingData } from "@/lib/actions/approve-kiosk-pairing";
import type { RenameKioskData } from "@/lib/actions/rename-kiosk";
import type { RevokeKioskData } from "@/lib/actions/revoke-kiosk";

// /admin/kitchen-screen's server actions (issue #126): thin wrappers around
// the registry. The actions themselves refuse anyone but an admin session.

export async function approveKioskPairingAction(
  _prev: ActionResult<ApproveKioskPairingData> | null,
  form: FormData,
): Promise<ActionResult<ApproveKioskPairingData>> {
  // No revalidatePath: it would re-render the confirm page, which then reads
  // the request as already approved and replaces the "Done" message. The
  // Kitchen screen page is dynamic and reads the new device anyway.
  return actionForm("approve_kiosk_pairing", form);
}

export async function renameKioskAction(
  _prev: ActionResult<RenameKioskData> | null,
  form: FormData,
): Promise<ActionResult<RenameKioskData>> {
  return actionFormRefreshing("rename_kiosk", form);
}

export async function revokeKioskAction(
  _prev: ActionResult<RevokeKioskData> | null,
  form: FormData,
): Promise<ActionResult<RevokeKioskData>> {
  return actionFormRefreshing("revoke_kiosk", form);
}
