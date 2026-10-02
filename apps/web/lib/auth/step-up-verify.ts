import "server-only";

import { headers } from "next/headers";
import { getAuth } from "@baumy/auth";
import { isClientRefusal, verifyCurrentPassword } from "./password-check";

// The proofs "Confirm it's you" accepts (issue #135, ADR 0007), each checked
// by Better Auth 1.6.25 for the session in THIS request's headers. None makes
// a session or changes one; `confirm_identity` records the window.
//
// - password: `verifyPassword` (false with no password on the account);
// - totp: `verifyTOTP`. With a session it checks the code against the
//   account's secret and returns. It would also FINISH an unverified
//   enrolment, so the action calls it only when two-factor is on and
//   verified (`hasVerifiedTotp`);
// - passkey: our server-only `verifyStepUpPasskey` (packages/auth/src/
//   step-up.ts), on the challenge Better Auth's passkey plugin issued.
//
// A refusal (4xx) is `false`; an outage throws, and runAction turns that into
// INTERNAL.

async function refusedIsFalse(check: () => Promise<unknown>) {
  try {
    await check();
    return true;
  } catch (err) {
    if (isClientRefusal(err)) return false;
    throw err;
  }
}

export function verifyPasswordStepUp(password: string): Promise<boolean> {
  return verifyCurrentPassword(password);
}

export async function verifyTotpStepUp(code: string): Promise<boolean> {
  const h = await headers();
  return refusedIsFalse(() =>
    getAuth().api.verifyTOTP({ body: { code }, headers: h }),
  );
}

export async function verifyPasskeyStepUp(
  response: Record<string, unknown>,
): Promise<boolean> {
  const h = await headers();
  return refusedIsFalse(() =>
    getAuth().api.verifyStepUpPasskey({ body: { response }, headers: h }),
  );
}
