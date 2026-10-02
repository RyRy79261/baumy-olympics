import { z } from "zod";
import { KioskIdleMinutes } from "@baumy/types";
import { setKioskIdleMinutes } from "@baumy/db/kiosk-devices";
import { defineAction } from "./define";
import { fail } from "./result";

// The kitchen screen's own setting (issue #147): how many minutes untouched
// before it forgets who is acting, chosen on the kiosk itself and stored on
// its device row. The owner: "it should deselect a character after 2
// minutes of inactivity. This should be configurable from the kiosk."
//
// [UNRESOLVED 2026-10-02] who may change it. Until the owner says, the
// member picked on the kiosk may, with no PIN and no admin rule (SPEC §12
// decision 28).

export interface KioskIdleData {
  minutes: number;
}

export const setKioskIdleMinutesAction = defineAction({
  name: "set_kiosk_idle_minutes",
  title: "Set the kitchen screen's idle time",
  description:
    "Sets how many minutes the kitchen screen waits, untouched, before it forgets who is acting and goes home.",
  consent: "Change the kitchen screen's idle time",
  kind: "write",
  risk: "safe",
  surfaces: ["kiosk"],
  requires: "member",
  input: z.strictObject({ minutes: z.coerce.number().pipe(KioskIdleMinutes) }),
  async preview(_ctx, i) {
    return `Forget who is acting after ${i.minutes} min untouched`;
  },
  async execute(ctx, i) {
    const { actor } = ctx;
    // The kiosk surface is the only one offered, so the actor is a kiosk.
    if (actor.kind !== "kiosk") {
      return fail("FORBIDDEN", "Only the kitchen screen has this setting.");
    }
    const set = await setKioskIdleMinutes(ctx.db, {
      householdId: ctx.householdId,
      id: actor.deviceId,
      minutes: i.minutes,
    });
    if (!set) {
      return fail(
        "NOT_FOUND",
        "This kitchen screen is not paired any more. Ask an admin to pair it again.",
      );
    }
    const data: KioskIdleData = { minutes: i.minutes };
    return {
      ok: true,
      data,
      audit: {
        entity: "kiosk_device",
        entityId: actor.deviceId,
        payload: { minutes: i.minutes, before: set.before },
      },
    };
  },
});
