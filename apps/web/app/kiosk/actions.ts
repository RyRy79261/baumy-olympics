"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { kioskActionForm } from "@/lib/actions/kiosk";
import type { ActionResult } from "@/lib/actions/result";
import type {
  CalendarWriteData,
  DeleteEventData,
} from "@/lib/actions/calendar";
import type { CheckKioskPinData } from "@/lib/actions/check-kiosk-pin";
import type { ClaimEventData } from "@/lib/actions/confirmations";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import type { DeleteNoteData, NoteWriteData } from "@/lib/actions/notes";
import type {
  AddShoppingData,
  CheckOffShoppingData,
} from "@/lib/actions/shopping";
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
import { splitItemsForm } from "@/lib/shopping/view";

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

/** The chores page, and the home whose widgets show the due chores. */
function revalidateKioskChores(): void {
  revalidatePath("/kiosk/chores");
  revalidatePath("/kiosk");
}

/** Log a chore as the acting member; for someone else, with the PIN. */
export async function kioskLogCompletionAction(
  _prev: ActionResult<LogCompletionData> | null,
  form: FormData,
): Promise<ActionResult<LogCompletionData>> {
  const result = await kioskActionForm("log_completion", form);
  if (result.ok) revalidateKioskChores();
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
  if (result.ok) revalidateKioskChores();
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

type CalendarWriteResult = ActionResult<CalendarWriteData>;

/** The kiosk calendar: add, change and delete as the acting member. */
export async function kioskCreateEventAction(
  _prev: CalendarWriteResult | null,
  form: FormData,
): Promise<CalendarWriteResult> {
  const result = await kioskActionForm("create_event", form);
  if (result.ok) revalidatePath("/kiosk/calendar");
  return result;
}

export async function kioskUpdateEventAction(
  _prev: CalendarWriteResult | null,
  form: FormData,
): Promise<CalendarWriteResult> {
  const result = await kioskActionForm("update_event", form);
  if (result.ok) revalidatePath("/kiosk/calendar");
  return result;
}

export async function kioskDeleteEventAction(
  _prev: ActionResult<DeleteEventData> | null,
  form: FormData,
): Promise<ActionResult<DeleteEventData>> {
  const result = await kioskActionForm("delete_event", form);
  if (result.ok) revalidatePath("/kiosk/calendar");
  return result;
}

type NoteWriteResult = ActionResult<NoteWriteData>;

/** The notes page, and the home whose widget shows the pinned ones. */
function revalidateKioskNotes(): void {
  revalidatePath("/kiosk/notes");
  revalidatePath("/kiosk");
}

/** The kiosk's notes: each change needs the acting member's PIN. */
export async function kioskCreateNoteAction(
  _prev: NoteWriteResult | null,
  form: FormData,
): Promise<NoteWriteResult> {
  const result = await kioskActionForm("create_note", form);
  if (result.ok) revalidateKioskNotes();
  return result;
}

export async function kioskUpdateNoteAction(
  _prev: NoteWriteResult | null,
  form: FormData,
): Promise<NoteWriteResult> {
  const result = await kioskActionForm("update_note", form);
  if (result.ok) revalidateKioskNotes();
  return result;
}

export async function kioskPinNoteAction(
  _prev: NoteWriteResult | null,
  form: FormData,
): Promise<NoteWriteResult> {
  const result = await kioskActionForm("pin_note", form);
  if (result.ok) revalidateKioskNotes();
  return result;
}

export async function kioskDeleteNoteAction(
  _prev: ActionResult<DeleteNoteData> | null,
  form: FormData,
): Promise<ActionResult<DeleteNoteData>> {
  const result = await kioskActionForm("delete_note", form);
  if (result.ok) revalidateKioskNotes();
  return result;
}

type AddShoppingResult = ActionResult<AddShoppingData>;
type CheckOffShoppingResult = ActionResult<CheckOffShoppingData>;

/** The shopping page, and the home whose widget shows the list. */
function revalidateKioskShopping(): void {
  revalidatePath("/kiosk/shopping");
  revalidatePath("/kiosk");
}

/** The kiosk's quick-add, as the acting member: no PIN. */
export async function kioskAddShoppingAction(
  _prev: AddShoppingResult | null,
  form: FormData,
): Promise<AddShoppingResult> {
  const result = await kioskActionForm(
    "add_shopping_items",
    splitItemsForm(form),
  );
  if (result.ok) revalidateKioskShopping();
  return result;
}

/** One tap on a row checks it off, as the acting member. */
export async function kioskCheckOffShoppingAction(
  _prev: CheckOffShoppingResult | null,
  form: FormData,
): Promise<CheckOffShoppingResult> {
  const result = await kioskActionForm("check_off_shopping_items", form);
  if (result.ok) revalidateKioskShopping();
  return result;
}
