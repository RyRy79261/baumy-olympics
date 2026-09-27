import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// Kiosk PIN hashing (SPEC §5 `members.kiosk_pin_hash`, §6.2). A PIN has only
// 4 to 6 digits, so the hash is salted scrypt: a leaked row still costs a
// memory-hard hash per guess, and the attempt limits (apps/web/lib/auth/pin.ts)
// stop online guessing. `set_kiosk_pin` writes it; kiosk attestation checks
// it.
//
// Stored as `scrypt$N$r$p$<salt base64>$<hash base64>`, so the cost can be
// raised later without breaking stored PINs.

const N = 16_384;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;

function derive(
  pin: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      pin.normalize("NFKC"),
      salt,
      keyLength,
      { N: n, r, p, maxmem: 128 * n * r * 2 },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** A fresh salted scrypt hash of `pin`. */
export async function hashKioskPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(pin, salt, N, R, P, KEY_LENGTH);
  return [
    "scrypt",
    N,
    R,
    P,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Whether `pin` matches `stored`, compared in constant time. A malformed
 * stored value never matches.
 */
export async function verifyKioskPin(
  pin: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number) as [number, number, number];
  if (![n, r, p].every((v) => Number.isInteger(v) && v > 0)) return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = await derive(pin, salt, n, r, p, expected.length);
  } catch {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
