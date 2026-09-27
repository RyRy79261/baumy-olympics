import "server-only";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { getActor } from "@/lib/auth";
import { now } from "@/lib/clock";
import { getClientIp } from "@/lib/rate-limit";
import type { ActionName, RequestCtx } from "./define";
import { runAction, type ActionOutput } from "./registry";
import { fail, type ActionResult } from "./result";

// The UI adapter (SPEC §6.3): a server action is a thin wrapper around
// `actionForm`, which builds the request context from the session and runs
// the action from the `ui` surface.
//
//   // app/(hub)/settings/actions.ts
//   "use server";
//   export async function updateMyProfileAction(_prev: unknown, form: FormData) {
//     return actionForm("update_my_profile", form);
//   }
//
// The form carries a hidden `requestId` (a fresh UUID per submission attempt,
// kept across retries of that attempt), which becomes the idempotency key.
// Field errors come back as INVALID_INPUT issues; `fieldErrors()` in
// result.ts groups them per field for inline display, and a one-tap action
// reports a failure through `toastActionError` (lib/ui/toast.ts).

/** Form fields that are request metadata, not action input. */
const RESERVED_FIELDS = new Set(["requestId"]);

/**
 * FormData to the object an action's Zod schema parses. Next's own fields
 * (`$ACTION_…`) and the request id are dropped, an empty text field counts as
 * not given, and a repeated name becomes an array. Files are left out: uploads
 * go through their own route (SPEC §6.5).
 */
export function formDataToInput(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("$ACTION") || RESERVED_FIELDS.has(key)) continue;
    if (typeof value !== "string") continue;
    if (value === "") continue;
    const prev = out[key];
    if (prev === undefined) out[key] = value;
    else out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

/**
 * The request context for a server action, or null when nobody signed in. A
 * paired kiosk without a person's session is not signed in here: the kiosk
 * has its own adapter (kiosk.ts) and its own surface.
 */
export async function uiRequestCtx(
  requestId: string | undefined,
): Promise<RequestCtx | null> {
  const actor = await getActor();
  if (!actor || actor.kind === "kiosk") return null;
  return {
    actor,
    source: "ui",
    householdId: HOUSEHOLD_ID,
    requestId,
    ip: getClientIp(await headers()),
    now: now(),
  };
}

/**
 * Run `name` with a form's fields, as the signed-in user, from the UI. Never
 * throws for a failure the user can act on; Next's redirects still propagate.
 */
export async function actionForm<N extends ActionName>(
  name: N,
  form: FormData,
): Promise<ActionResult<ActionOutput<N>>> {
  try {
    const requestId = form.get("requestId");
    const ctx = await uiRequestCtx(
      typeof requestId === "string" && requestId !== "" ? requestId : undefined,
    );
    if (!ctx) return fail("UNAUTHENTICATED", "Sign in to do this.");
    return await runAction(name, formDataToInput(form), ctx);
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[actionForm:${name}]`, err);
    return fail("INTERNAL", "Something went wrong. Please try again.");
  }
}
