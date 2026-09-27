// Pairing-code display, shared by the admin page (client) and tests.

/** `ABCDEFGH` as `ABCD-EFGH`, the way the admin page shows it. */
export function formatKioskPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
