import { randomInt } from "node:crypto";
import { KIOSK_PAIRING_CODE_LENGTH } from "@baumy/types";

// One-time codes people type: invite codes and Telegram link codes. Drawn
// from crypto.randomInt over an alphabet without look-alikes (no 0/o, 1/l/i),
// so a code read off one screen and typed on another survives the trip.

export const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** `length` characters drawn uniformly from CODE_ALPHABET. */
export function randomCode(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * An invite code like `k7dm-q2wx-p9ta`: 12 random characters (about 59 bits),
 * grouped in fours so it reads aloud. Stored lowercase.
 */
export function generateInviteCode(): string {
  return [randomCode(4), randomCode(4), randomCode(4)].join("-");
}

/**
 * A Telegram link code: 10 random characters (about 49 bits), uppercase so
 * it stands out in a chat message. Only its hash is stored.
 */
export function generateTelegramLinkCode(): string {
  return randomCode(10).toUpperCase();
}

/**
 * A kiosk pairing code (issue #126): 6 random characters (about 30 bits),
 * uppercase, shown as `ABC-DEF` on the unpaired iPad and carried in its QR
 * code. Only an admin can use one, it lives 10 minutes and only its hash is
 * stored.
 */
export function generateKioskPairingCode(): string {
  return randomCode(KIOSK_PAIRING_CODE_LENGTH).toUpperCase();
}
