// Kiosk PIN attestation (SPEC §6.2): the acting member's PIN travels with
// each attested kiosk request and is checked in that request. Nothing is
// stored, so the next person at the kiosk cannot inherit it.

export interface PinCheck {
  deviceId: string;
  memberId: string;
  pin: string;
  now: Date;
}

/** Says whether `pin` is this member's kiosk PIN right now. */
export type PinVerifier = (check: PinCheck) => Promise<boolean>;

/**
 * FAILS CLOSED until kiosk attestation lands (issue #10): no PIN is accepted.
 * That issue replaces this with the scrypt check against
 * `members.kiosk_pin_hash`, the per-device and per-member attempt limits and
 * the `kiosk_pin_locked_at` lock. Until then a kiosk can do only what needs
 * no attestation, and there is no paired kiosk to try anyway.
 */
export const verifyKioskPin: PinVerifier = async () => false;
