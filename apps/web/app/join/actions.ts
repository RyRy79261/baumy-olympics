"use server";

import { redirect } from "next/navigation";
import { createHttpDb, type Queryable } from "@baumy/db";
import { countLiveAvatars } from "@baumy/db/avatars";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";

// /join's server actions: thin wrappers around the registry (SPEC §6.3). On
// success the new member goes straight to the hub; someone who joined with
// a code goes to Settings first when the household has a gallery, to pick
// their character there (issue #111: the gallery is for members).

export async function redeemInviteAction(
  _prev: ActionResult<unknown> | null,
  form: FormData,
): Promise<ActionResult<unknown>> {
  const result = await actionForm("redeem_invite", form);
  if (result.ok) {
    const gallery = await countLiveAvatars(
      createHttpDb() as unknown as Queryable,
      HOUSEHOLD_ID,
    );
    redirect(gallery > 0 ? "/settings#character" : "/");
  }
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
