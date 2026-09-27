"use server";

import { redirect } from "next/navigation";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";

// /join's server actions: thin wrappers around the registry (SPEC §6.3). On
// success the new member goes straight to the hub.

export async function redeemInviteAction(
  _prev: ActionResult<unknown> | null,
  form: FormData,
): Promise<ActionResult<unknown>> {
  const result = await actionForm("redeem_invite", form);
  if (result.ok) redirect("/");
  return result;
}

export async function joinAsFounderAction(
  _prev: ActionResult<unknown> | null,
  form: FormData,
): Promise<ActionResult<unknown>> {
  const result = await actionForm("join_as_founder", form);
  if (result.ok) redirect("/");
  return result;
}
