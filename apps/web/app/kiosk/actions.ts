"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { kioskActionForm } from "@/lib/actions/kiosk";
import type { ActionResult } from "@/lib/actions/result";
import type { CheckKioskPinData } from "@/lib/actions/check-kiosk-pin";
import type { ClaimEventData } from "@/lib/actions/confirmations";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import { getKioskActor } from "@/lib/auth";
import { now } from "@/lib/clock";
import {
  KIOSK_COOKIE,
  KIOSK_COOKIE_MAX_AGE_S,
  KIOSK_MEMBER_COOKIE,
  KIOSK_MEMBER_MAX_AGE_S,
  kioskCookieOptions,
} from "@/lib/kiosk/cookies";
import { pairKioskDevice } from "@/lib/kiosk/pairing";
import { pickKioskMember } from "@/lib/kiosk/selection";
import { getClientIp } from "@/lib/rate-limit";

// The kiosk's server actions (SPEC §8). Pairing and picking who is acting
// are the kiosk's own sign-in state, kept in its cookies; everything the
// household can DO from the kiosk goes through runAction (kioskActionForm).

/** /kiosk/pair: trade the admin's code for the device cookie. */
export async function pairKioskAction(
  _prev: ActionResult<null> | null,
  form: FormData,
): Promise<ActionResult<null>> {
  const result = await pairKioskDevice({
    code: form.get("code"),
    ip: getClientIp(await headers()),
    now: now(),
  });
  if (!result.ok) return result;
  const jar = await cookies();
  jar.set(
    KIOSK_COOKIE,
    result.token,
    kioskCookieOptions(KIOSK_COOKIE_MAX_AGE_S),
  );
  jar.delete(KIOSK_MEMBER_COOKIE);
  redirect("/kiosk");
}

/** An avatar was tapped: that member is acting now. */
export async function pickMemberAction(form: FormData): Promise<void> {
  const picked = await pickKioskMember(
    await getKioskActor(),
    form.get("memberId"),
  );
  if (!picked.ok) {
    if (picked.code === "UNAUTHENTICATED") redirect("/kiosk/pair");
    return;
  }
  (await cookies()).set(
    KIOSK_MEMBER_COOKIE,
    picked.data.memberId,
    kioskCookieOptions(KIOSK_MEMBER_MAX_AGE_S),
  );
}

/** "Done", or 60 seconds idle: nobody is acting. */
export async function clearPickAction(): Promise<void> {
  (await cookies()).delete(KIOSK_MEMBER_COOKIE);
}

/** "Check my PIN": the attested request, with the PIN in the form. */
export async function checkPinAction(
  _prev: ActionResult<CheckKioskPinData> | null,
  form: FormData,
): Promise<ActionResult<CheckKioskPinData>> {
  return kioskActionForm("check_kiosk_pin", form);
}

/** Log a chore as the acting member; for someone else, with the PIN. */
export async function kioskLogCompletionAction(
  _prev: ActionResult<LogCompletionData> | null,
  form: FormData,
): Promise<ActionResult<LogCompletionData>> {
  const result = await kioskActionForm("log_completion", form);
  if (result.ok) revalidatePath("/kiosk");
  return result;
}

type ClaimResult = ActionResult<ClaimEventData>;

async function claimEvent(
  name:
    | "confirm_completion"
    | "dispute_completion"
    | "undo_completion"
    | "withdraw_dispute"
    | "concede_completion",
  form: FormData,
): Promise<ClaimResult> {
  const result = await kioskActionForm(name, form);
  if (result.ok) revalidatePath("/kiosk");
  return result;
}

/** "Needs your OK" on the kiosk: each needs the acting member's PIN. */
export async function kioskConfirmClaimAction(
  _prev: ClaimResult | null,
  form: FormData,
): Promise<ClaimResult> {
  return claimEvent("confirm_completion", form);
}

export async function kioskDisputeClaimAction(
  _prev: ClaimResult | null,
  form: FormData,
): Promise<ClaimResult> {
  return claimEvent("dispute_completion", form);
}

export async function kioskUndoClaimAction(
  _prev: ClaimResult | null,
  form: FormData,
): Promise<ClaimResult> {
  return claimEvent("undo_completion", form);
}

export async function kioskWithdrawDisputeAction(
  _prev: ClaimResult | null,
  form: FormData,
): Promise<ClaimResult> {
  return claimEvent("withdraw_dispute", form);
}

export async function kioskConcedeClaimAction(
  _prev: ClaimResult | null,
  form: FormData,
): Promise<ClaimResult> {
  return claimEvent("concede_completion", form);
}
