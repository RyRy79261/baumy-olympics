// Pairing-code display, shared by the iPad's pairing screen, the admin's
// confirm page (both client-safe) and tests.

/** `ABC234` as `ABC-234`: two halves, the way the screens show it. */
export function formatKioskPairingCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/** Where the admin's phone approves the iPad: the URL its QR code holds. */
export const KIOSK_APPROVE_PATH = "/admin/kitchen-screen/approve";

/** The approve URL for `code` on `origin` (the iPad's own address). */
export function kioskApproveUrl(origin: string, code: string): string {
  return `${origin}${KIOSK_APPROVE_PATH}?code=${encodeURIComponent(code)}`;
}
