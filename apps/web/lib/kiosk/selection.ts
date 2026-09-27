import "server-only";

import { createHttpDb, type Queryable } from "@baumy/db";
import { HOUSEHOLD_ID } from "@baumy/db/household";
import { findActiveMember } from "@baumy/db/members";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { KioskActor } from "@/lib/auth";
import { isMemberId } from "./cookies";

// Tapping an avatar on the kiosk (SPEC §8): who is acting now. Only an active
// member of the household can be picked, and only on a paired kiosk. The
// pick is a member id in a cookie and nothing more: it lets that member make
// self-claims, while anything attested still needs their PIN with the
// request.

export interface PickedMember {
  memberId: string;
  displayName: string;
}

export async function pickKioskMember(
  kiosk: KioskActor | null,
  memberId: unknown,
  find: typeof findActiveMember = findActiveMember,
): Promise<ActionResult<PickedMember>> {
  if (!kiosk) {
    return fail("UNAUTHENTICATED", "This kiosk is not paired any more.");
  }
  if (typeof memberId !== "string" || !isMemberId(memberId)) {
    return fail("INVALID_INPUT", "Tap one of the avatars.");
  }
  const member = await find(
    createHttpDb() as unknown as Queryable,
    HOUSEHOLD_ID,
    memberId,
  );
  if (!member) {
    return fail("NOT_FOUND", "That person is not in the household any more.");
  }
  return {
    ok: true,
    data: { memberId: member.id, displayName: member.displayName },
  };
}
