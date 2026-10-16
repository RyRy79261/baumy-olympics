"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  kioskActionForm,
  kioskActionFormRefreshing,
} from "@/lib/actions/kiosk";
import type { ActionResult } from "@/lib/actions/result";
import { eventFormInput } from "@/lib/calendar/view";
import type {
  CalendarWriteData,
  DeleteEventData,
} from "@/lib/actions/calendar";
import type { CheckKioskPinData } from "@/lib/actions/check-kiosk-pin";
import type { ClaimEventData } from "@/lib/actions/confirmations";
import type { LogCompletionData } from "@/lib/actions/log-completion";
import type { KioskIdleData } from "@/lib/actions/kiosk-idle";
import type { DeleteNoteData, NoteWriteData } from "@/lib/actions/notes";
import type { UpdateBountiesData } from "@/lib/actions/update-bounties";
import type { WeightDecisionData } from "@/lib/actions/weights";
import type {
  AddShoppingData,
  CheckOffShoppingData,
  SetShoppingCategoryData,
} from "@/lib/actions/shopping";
import { getKioskActor } from "@/lib/auth";
import {
  KIOSK_MEMBER_COOKIE,
  KIOSK_MEMBER_MAX_AGE_S,
  KIOSK_WALK_IN_COOKIE,
  kioskCookieOptions,
  walkInCookieOptions,
} from "@/lib/kiosk/cookies";
import { pickKioskMember } from "@/lib/kiosk/selection";
import { changesFromForm } from "@/lib/chores/bulk-edit";
import { groupFormInput, splitItemsForm } from "@/lib/shopping/view";

// The kiosk's server actions (SPEC §8). Picking who is acting is the
// kiosk's own sign-in state, kept in its cookies (pairing is the
// /api/kiosk-pairing routes, issue #126); everything the household can DO
// from the kiosk goes through runAction (kioskActionForm). A write refreshes
// the kiosk pages that read what it changed: its `refreshes` tags, through
// kioskActionFormRefreshing (lib/actions/refresh.ts, issue #215).

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
  const jar = await cookies();
  jar.set(
    KIOSK_MEMBER_COOKIE,
    picked.data.memberId,
    kioskCookieOptions(KIOSK_MEMBER_MAX_AGE_S),
  );
  // The tap that picks someone walks them in on the dashboard, once.
  jar.set(KIOSK_WALK_IN_COOKIE, picked.data.memberId, walkInCookieOptions());
}

/** "Done", or the screen's idle minutes untouched: nobody is acting. */
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
  return kioskActionFormRefreshing("log_completion", form);
}

type ClaimResult = ActionResult<ClaimEventData>;

async function claimEvent(
  name:
    | "dispute_completion"
    | "undo_completion"
    | "withdraw_dispute"
    | "concede_completion",
  form: FormData,
): Promise<ClaimResult> {
  return kioskActionFormRefreshing(name, form);
}

/** The activity log's buttons on the kiosk: only Dispute needs the PIN. */
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
  return kioskActionFormRefreshing("create_event", form, eventFormInput);
}

export async function kioskUpdateEventAction(
  _prev: CalendarWriteResult | null,
  form: FormData,
): Promise<CalendarWriteResult> {
  return kioskActionFormRefreshing("update_event", form, eventFormInput);
}

export async function kioskDeleteEventAction(
  _prev: ActionResult<DeleteEventData> | null,
  form: FormData,
): Promise<ActionResult<DeleteEventData>> {
  return kioskActionFormRefreshing("delete_event", form);
}

type NoteWriteResult = ActionResult<NoteWriteData>;

/** The kiosk's notes: each change needs the acting member's PIN. */
export async function kioskCreateNoteAction(
  _prev: NoteWriteResult | null,
  form: FormData,
): Promise<NoteWriteResult> {
  return kioskActionFormRefreshing("create_note", form);
}

export async function kioskUpdateNoteAction(
  _prev: NoteWriteResult | null,
  form: FormData,
): Promise<NoteWriteResult> {
  return kioskActionFormRefreshing("update_note", form);
}

export async function kioskPinNoteAction(
  _prev: NoteWriteResult | null,
  form: FormData,
): Promise<NoteWriteResult> {
  return kioskActionFormRefreshing("pin_note", form);
}

export async function kioskDeleteNoteAction(
  _prev: ActionResult<DeleteNoteData> | null,
  form: FormData,
): Promise<ActionResult<DeleteNoteData>> {
  return kioskActionFormRefreshing("delete_note", form);
}

type AddShoppingResult = ActionResult<AddShoppingData>;
type CheckOffShoppingResult = ActionResult<CheckOffShoppingData>;

/** The kiosk's quick-add, as the acting member: no PIN. */
export async function kioskAddShoppingAction(
  _prev: AddShoppingResult | null,
  form: FormData,
): Promise<AddShoppingResult> {
  return kioskActionFormRefreshing("add_shopping_items", splitItemsForm(form));
}

/** One tap on a row checks it off, as the acting member. */
export async function kioskCheckOffShoppingAction(
  _prev: CheckOffShoppingResult | null,
  form: FormData,
): Promise<CheckOffShoppingResult> {
  return kioskActionFormRefreshing("check_off_shopping_items", form);
}

/** A group button for one item, as the acting member (issue #208). */
export async function kioskSetShoppingCategoryAction(
  _prev: ActionResult<SetShoppingCategoryData> | null,
  form: FormData,
): Promise<ActionResult<SetShoppingCategoryData>> {
  return kioskActionFormRefreshing(
    "set_shopping_category",
    form,
    groupFormInput,
  );
}

/**
 * The kitchen screen's idle minutes (issue #147), as the member acting.
 * [UNRESOLVED 2026-10-02] who may: anyone picked, for now.
 */
export async function kioskSetIdleMinutesAction(
  _prev: ActionResult<KioskIdleData> | null,
  form: FormData,
): Promise<ActionResult<KioskIdleData>> {
  return kioskActionFormRefreshing("set_kiosk_idle_minutes", form);
}

/**
 * A kiosk admin changes a bounty's points (issue #147): the admin gate asks
 * their PIN in this request, through the form's PinPad.
 */
export async function kioskSchedulePointsAction(
  _prev: ActionResult<WeightDecisionData> | null,
  form: FormData,
): Promise<ActionResult<WeightDecisionData>> {
  return kioskActionFormRefreshing("schedule_points_change", form);
}

/**
 * A kiosk admin edits many bounties in one save (issue #175): all or none,
 * with their PIN in this request, through the form's PinPad.
 */
export async function kioskUpdateBountiesAction(
  _prev: ActionResult<UpdateBountiesData> | null,
  form: FormData,
): Promise<ActionResult<UpdateBountiesData>> {
  return kioskActionFormRefreshing("update_bounties", form, changesFromForm);
}
