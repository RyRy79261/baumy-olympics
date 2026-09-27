import { z } from "zod";
import { defineAction } from "./define";

// The kiosk's "Check my PIN" (SPEC §6.2): the smallest attested action, so a
// member can try their PIN at the kiosk before it matters. It changes
// nothing; the gate does the work. Like every attested kiosk request it
// counts toward the PIN limits, and a correct PIN attests this one request
// only.

export interface CheckKioskPinData {
  memberId: string;
  displayName: string | null;
}

export const checkKioskPin = defineAction({
  name: "check_kiosk_pin",
  title: "Check my PIN",
  description:
    "Checks the acting member's kiosk PIN on the kiosk without changing anything.",
  consent: "Check your kiosk PIN",
  kind: "read",
  risk: "safe",
  surfaces: ["kiosk"],
  requires: "attested",
  input: z.strictObject({}),
  async execute(ctx) {
    const { actor } = ctx;
    const data: CheckKioskPinData = {
      // The attested gate has checked it is set.
      memberId: actor.memberId!,
      displayName: actor.kind === "kiosk" ? (actor.displayName ?? null) : null,
    };
    return { ok: true, data };
  },
});
