import "server-only";

import { withTransaction, type Queryable, type Tx } from "@baumy/db";
import { claimKioskPairing, hashKioskToken } from "@baumy/db/kiosk-devices";
import { KioskPairingCode } from "@baumy/types";
import { fail, type ActionFailure } from "@/lib/actions/result";
import { rateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { generateKioskToken } from "./cookies";

// /kiosk/pair (SPEC §6.2): the iPad trades the admin's one-time code for a
// device token. This is signing in, not an action: there is no actor yet,
// just as there is none at /auth/sign-in. The admin's `pair_kiosk` is the
// audited half; the device row records when it paired.
//
// The code is claimed with one compare-and-set UPDATE, so it works once. Only
// the token's sha256 is stored; the caller puts the token in the
// `baumy_kiosk` cookie and it is never shown or logged.

/** Tries per IP address, per 15 minutes, against 40-bit codes. */
export const PAIR_LIMIT = { limit: 10, windowMs: 15 * 60_000 };

export const PAIR_FAILED_MESSAGE =
  "That code is wrong, used or expired. Ask an admin for a new one.";

export interface PairingDeps {
  withTransaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
  rateLimiter: RateLimiter;
  newToken: () => string;
}

const defaultDeps: PairingDeps = {
  withTransaction,
  rateLimiter,
  newToken: generateKioskToken,
};

export type PairingResult =
  { ok: true; token: string; deviceId: string; name: string } | ActionFailure;

export async function pairKioskDevice(
  input: { code: unknown; ip: string; now: Date },
  deps: PairingDeps = defaultDeps,
): Promise<PairingResult> {
  const parsed = KioskPairingCode.safeParse(input.code ?? "");
  if (!parsed.success) {
    return fail("INVALID_INPUT", "Check the code and try again.", {
      issues: [{ path: ["code"], message: parsed.error.issues[0]!.message }],
    });
  }
  const rl = await deps.rateLimiter.limit(
    `kiosk_pair:ip:${input.ip}`,
    PAIR_LIMIT,
  );
  if (!rl.ok) {
    return fail(
      "RATE_LIMITED",
      `Too many tries. Wait ${rl.retryAfterSeconds}s and try again.`,
      { retryAfterSeconds: rl.retryAfterSeconds },
    );
  }
  const token = deps.newToken();
  const device = await deps.withTransaction((tx) =>
    claimKioskPairing(tx as unknown as Queryable, {
      code: parsed.data,
      tokenHash: hashKioskToken(token),
      now: input.now,
    }),
  );
  if (!device) return fail("NOT_FOUND", PAIR_FAILED_MESSAGE);
  return { ok: true, token, deviceId: device.id, name: device.name };
}
