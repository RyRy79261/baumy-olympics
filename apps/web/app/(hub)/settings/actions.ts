"use server";

import { revalidatePath } from "next/cache";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { SetKioskPinData } from "@/lib/actions/set-kiosk-pin";
import type { TelegramLinkCodeData } from "@/lib/actions/create-telegram-link-code";
import type { UpdateAvatarData } from "@/lib/actions/update-avatar";

// /settings' server actions: thin wrappers around the registry (SPEC §6.3).

export async function setKioskPinAction(
  _prev: ActionResult<SetKioskPinData> | null,
  form: FormData,
): Promise<ActionResult<SetKioskPinData>> {
  const result = await actionForm("set_kiosk_pin", form);
  if (result.ok) revalidatePath("/settings");
  return result;
}

/** Choose my character (issue #66); every page's header draws it. */
export async function updateAvatarAction(
  _prev: ActionResult<UpdateAvatarData> | null,
  form: FormData,
): Promise<ActionResult<UpdateAvatarData>> {
  const result = await actionForm("update_avatar", form);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function createTelegramLinkCodeAction(
  _prev: ActionResult<TelegramLinkCodeData> | null,
  form: FormData,
): Promise<ActionResult<TelegramLinkCodeData>> {
  return actionForm("create_telegram_link_code", form);
}
