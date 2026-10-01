import { z } from "zod";

// The kitchen kiosk at its boundaries (SPEC §6.2): the name an admin gives a
// device when approving it, and the short code the unpaired iPad shows (in
// its QR code, and to type if the camera will not read it; issue #126).

export const KIOSK_DEVICE_NAME_MAX = 40;

/** What the admin calls the device, for example "Kitchen". */
export const KioskDeviceName = z
  .string()
  .trim()
  .min(1, "Give the screen a name.")
  .max(
    KIOSK_DEVICE_NAME_MAX,
    `Keep it to ${KIOSK_DEVICE_NAME_MAX} characters.`,
  );

/** Length of a pairing code, without the dash it is shown with. */
export const KIOSK_PAIRING_CODE_LENGTH = 6;

/**
 * A pairing code as typed or scanned: spaces and dashes are ignored and case
 * does not matter, so `abc-234` and `ABC234` are one code. Parses to the bare
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
        `Enter the ${KIOSK_PAIRING_CODE_LENGTH}-character code shown on the iPad.`,
      ),
  );
