"use server";

import { revalidatePath } from "next/cache";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { SetKioskPinData } from "@/lib/actions/set-kiosk-pin";
import type { TelegramLinkCodeData } from "@/lib/actions/create-telegram-link-code";

// /settings' server actions: thin wrappers around the registry (SPEC §6.3).

export async function setKioskPinAction(
  _prev: ActionResult<SetKioskPinData> | null,
  form: FormData,
): Promise<ActionResult<SetKioskPinData>> {
  const result = await actionForm("set_kiosk_pin", form);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function createTelegramLinkCodeAction(
  _prev: ActionResult<TelegramLinkCodeData> | null,
  form: FormData,
): Promise<ActionResult<TelegramLinkCodeData>> {
  return actionForm("create_telegram_link_code", form);
}
