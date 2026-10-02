import "server-only";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { getKioskActor } from "@/lib/auth";
import { now } from "@/lib/clock";
import { pickKioskMember, type PickedMember } from "@/lib/kiosk/selection";
import { getClientIp } from "@/lib/rate-limit";
import type { ActionName, RequestCtx } from "./define";
import { runAction, type ActionOutput } from "./registry";
import { fail, type ActionResult } from "./result";
import { formDataToInput, type FormInputMap } from "./ui";

// The kiosk adapter (SPEC §6.3, §8): like the UI adapter (ui.ts), but the
// actor is the paired DEVICE with the member whose avatar was tapped, and the
// surface is `kiosk`. A form that attests carries the PinPad's `pin` field:
// it becomes `ctx.pin` for this one request and never reaches the action's
// input, the ledger or the audit row. Nothing keeps it afterwards.

/** The form field the PinPad (packages/ui) sends the PIN in. */
export const PIN_FIELD = "pin";

export const NOT_PAIRED_MESSAGE =
  "This kiosk is not paired any more. Ask an admin for a new pairing code.";

/**
 * The request context for a kiosk server action, or null when not paired.
 * `actAs` is a member just picked in this same request (kioskActionAsFace),
 * whom the device's cookie does not show yet.
 */
export async function kioskRequestCtx(
  requestId: string | undefined,
  pin: string | undefined,
  actAs?: PickedMember,
): Promise<RequestCtx | null> {
  const actor = await getKioskActor();
  if (!actor) return null;
  return {
    actor: actAs
      ? { ...actor, memberId: actAs.memberId, displayName: actAs.displayName }
      : actor,
    source: "kiosk",
    householdId: HOUSEHOLD_ID,
    requestId,
    ...(pin ? { pin } : {}),
    ip: getClientIp(await headers()),
    now: now(),
  };
}

function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Run `name` from the kiosk with a form's fields. Never throws for a failure
 * the kiosk can show; Next's redirects still propagate.
 */
export async function kioskActionForm<N extends ActionName>(
  name: N,
  form: FormData,
  actAs?: PickedMember,
  mapInput: FormInputMap = (i) => i,
): Promise<ActionResult<ActionOutput<N>>> {
  try {
    const ctx = await kioskRequestCtx(
      field(form, "requestId"),
      field(form, PIN_FIELD),
      actAs,
    );
    if (!ctx) return fail("UNAUTHENTICATED", NOT_PAIRED_MESSAGE);
    const input = formDataToInput(form);
    delete input[PIN_FIELD];
    return await runAction(name, mapInput(input), ctx);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[kioskActionForm:${name}]`, err);
    return fail("INTERNAL", "Something went wrong. Please try again.");
  }
}

/** The form field that says whose face was tapped. */
export const FACE_FIELD = "memberId";

/**
 * Run `name` from the kiosk as the face that was tapped (the reminder's
 * "I've seen it", ADR 0005 §4): the face must be an active member (the same
 * check as tapping their avatar), and the action runs as them and only them,
 * for this one request. It does NOT change who is picked on the kiosk: the
 * person who was acting before the tap is still the one acting after it, so
 * their next tap is never recorded as whoever acknowledged a reminder. The
 * face field never reaches the action's input. No PIN is asked for: the
 * actions this serves are `member`, and runAction's gates refuse an
 * `attested` one without its PIN anyway.
 */
export async function kioskActionAsFace<N extends ActionName>(
  name: N,
  form: FormData,
): Promise<ActionResult<ActionOutput<N>>> {
  try {
    const picked = await pickKioskMember(
      await getKioskActor(),
      form.get(FACE_FIELD),
    );
    if (!picked.ok) {
      return picked.code === "UNAUTHENTICATED"
        ? fail("UNAUTHENTICATED", NOT_PAIRED_MESSAGE)
        : picked;
    }
    const rest = new FormData();
    for (const [key, value] of form.entries()) {
      if (key !== FACE_FIELD) rest.append(key, value);
    }
    return await kioskActionForm(name, rest, picked.data);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[kioskActionAsFace:${name}]`, err);
    return fail("INTERNAL", "Something went wrong. Please try again.");
  }
}
