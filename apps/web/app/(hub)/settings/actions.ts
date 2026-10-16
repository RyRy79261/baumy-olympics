"use server";

import { actionForm, actionFormRefreshing } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { SetKioskPinData } from "@/lib/actions/set-kiosk-pin";
import type { TelegramLinkCodeData } from "@/lib/actions/create-telegram-link-code";
import type { TelegramLinkStatus } from "@/lib/actions/get-telegram-link-status";
import type { ChooseAvatarData } from "@/lib/actions/avatars";

// /settings' server actions: thin wrappers around the registry (SPEC §6.3).

export async function setKioskPinAction(
  _prev: ActionResult<SetKioskPinData> | null,
  form: FormData,
): Promise<ActionResult<SetKioskPinData>> {
  return actionFormRefreshing("set_kiosk_pin", form);
}

/** Pick my character from the gallery (issue #111). */
export async function chooseAvatarAction(
  _prev: ActionResult<ChooseAvatarData> | null,
  form: FormData,
): Promise<ActionResult<ChooseAvatarData>> {
  return actionFormRefreshing("choose_avatar", form);
}

export async function createTelegramLinkCodeAction(
  _prev: ActionResult<TelegramLinkCodeData> | null,
  form: FormData,
): Promise<ActionResult<TelegramLinkCodeData>> {
  // No refresh: the card shows the code from this answer and polls for the
  // link; it refreshes the page itself once linked (settings-forms.tsx).
  return actionForm("create_telegram_link_code", form);
}

/** What the Telegram card polls while a link code is on screen (issue #118). */
export async function telegramLinkStatusAction(): Promise<
  ActionResult<TelegramLinkStatus>
> {
  return actionForm("get_telegram_link_status", new FormData());
}
