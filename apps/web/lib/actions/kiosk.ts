import "server-only";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { getKioskActor } from "@/lib/auth";
import { now } from "@/lib/clock";
import { getClientIp } from "@/lib/rate-limit";
import type { ActionName, RequestCtx } from "./define";
import { runAction, type ActionOutput } from "./registry";
import { fail, type ActionResult } from "./result";
import { formDataToInput } from "./ui";

// The kiosk adapter (SPEC §6.3, §8): like the UI adapter (ui.ts), but the
// actor is the paired DEVICE with the member whose avatar was tapped, and the
// surface is `kiosk`. A form that attests carries the PinPad's `pin` field:
// it becomes `ctx.pin` for this one request and never reaches the action's
// input, the ledger or the audit row. Nothing keeps it afterwards.

/** The form field the PinPad (packages/ui) sends the PIN in. */
export const PIN_FIELD = "pin";

export const NOT_PAIRED_MESSAGE =
  "This kiosk is not paired any more. Ask an admin for a new pairing code.";

/** The request context for a kiosk server action, or null when not paired. */
export async function kioskRequestCtx(
  requestId: string | undefined,
  pin: string | undefined,
): Promise<RequestCtx | null> {
  const actor = await getKioskActor();
  if (!actor) return null;
  return {
    actor,
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
): Promise<ActionResult<ActionOutput<N>>> {
  try {
    const ctx = await kioskRequestCtx(
      field(form, "requestId"),
      field(form, PIN_FIELD),
    );
    if (!ctx) return fail("UNAUTHENTICATED", NOT_PAIRED_MESSAGE);
    const input = formDataToInput(form);
    delete input[PIN_FIELD];
    return await runAction(name, input, ctx);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[kioskActionForm:${name}]`, err);
    return fail("INTERNAL", "Something went wrong. Please try again.");
  }
}
