import "server-only";

import { findKioskPinState } from "@baumy/db/kiosk-pin";

// Whether the kiosk's acting member has a personal PIN (issue #145). The
// kiosk asks for it only to dispute a chore (SPEC §12 decision 27); a
// member without one is shown "<Name> hasn't set a personal PIN yet" and a
// QR code to Settings, never a PinPad they cannot use. Only this one boolean, for the member
// already picked on this device, leaves the server: never the hash, the
// lock or anyone else's.

export async function actingMemberHasPin(
  householdId: string,
  memberId: string | undefined,
  find: typeof findKioskPinState = findKioskPinState,
): Promise<boolean> {
  if (!memberId) return false;
  const state = await find(householdId, memberId);
  return Boolean(state?.pinHash);
}
