"use server";

import { revalidatePath } from "next/cache";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { ManageMembersData } from "@/lib/actions/manage-members";
import type { MintInviteData } from "@/lib/actions/mint-invite";
import type { PairKioskData } from "@/lib/actions/pair-kiosk";
import type { RevokeKioskData } from "@/lib/actions/revoke-kiosk";

// /admin/members' server actions: thin wrappers around the registry (SPEC
// §6.3). The actions themselves refuse anyone but an admin session.

export async function mintInviteAction(
  _prev: ActionResult<MintInviteData> | null,
  form: FormData,
): Promise<ActionResult<MintInviteData>> {
  const result = await actionForm("mint_invite", form);
  if (result.ok) revalidatePath("/admin/members");
  return result;
}

export async function revokeInviteAction(
  _prev: ActionResult<{ code: string }> | null,
  form: FormData,
): Promise<ActionResult<{ code: string }>> {
  const result = await actionForm("revoke_invite", form);
  if (result.ok) revalidatePath("/admin/members");
  return result;
}

export async function manageMembersAction(
  _prev: ActionResult<ManageMembersData> | null,
  form: FormData,
): Promise<ActionResult<ManageMembersData>> {
  const result = await actionForm("manage_members", form);
  if (result.ok) revalidatePath("/admin/members");
  return result;
}

export async function pairKioskAction(
  _prev: ActionResult<PairKioskData> | null,
  form: FormData,
): Promise<ActionResult<PairKioskData>> {
  const result = await actionForm("pair_kiosk", form);
  if (result.ok) revalidatePath("/admin/members");
  return result;
}

export async function revokeKioskAction(
  _prev: ActionResult<RevokeKioskData> | null,
  form: FormData,
): Promise<ActionResult<RevokeKioskData>> {
  const result = await actionForm("revoke_kiosk", form);
  if (result.ok) revalidatePath("/admin/members");
  return result;
}
