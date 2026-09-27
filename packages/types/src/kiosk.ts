import { z } from "zod";

// The kitchen kiosk at its boundaries (SPEC §6.2): the name an admin gives a
// device when pairing it, and the code the iPad types at /kiosk/pair.

export const KIOSK_DEVICE_NAME_MAX = 40;

/** What the admin calls the device, for example "Kitchen iPad". */
export const KioskDeviceName = z
  .string()
  .trim()
  .min(1, "Give the device a name.")
  .max(
    KIOSK_DEVICE_NAME_MAX,
    `Keep it to ${KIOSK_DEVICE_NAME_MAX} characters.`,
  );

/** Length of a pairing code, without the dash it is shown with. */
export const KIOSK_PAIRING_CODE_LENGTH = 8;

/**
 * A pairing code as typed: spaces and dashes are ignored and case does not
 * matter, so `abcd-efgh` and `ABCDEFGH` are one code. Parses to the bare
 * uppercase code.
 */
export const KioskPairingCode = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
  .pipe(
    z
      .string()
      .regex(
        new RegExp(`^[A-Z0-9]{${KIOSK_PAIRING_CODE_LENGTH}}$`),
        `Enter the ${KIOSK_PAIRING_CODE_LENGTH}-character code from the admin page.`,
      ),
  );
