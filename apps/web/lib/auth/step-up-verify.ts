import "server-only";

import { headers } from "next/headers";
import { getAuth } from "@baumy/auth";
import { isClientRefusal, verifyCurrentPassword } from "./password-check";

// The proofs "Confirm it's you" accepts (issue #135, ADR 0007), each checked
// by Better Auth 1.6.25 for the session in THIS request's headers. None makes
// a session or changes one; `confirm_identity` records the window.
//
// - password: `verifyPassword` (false with no password on the account);
// - totp: our server-only `verifyStepUpTotp` (packages/auth/src/step-up.ts),
//   against the account's finished enrolment only. It answers the time step
//   the code matched, which the action claims once (no replay). Better
//   Auth's own verify-totp is not used: with a session it is the enrolment
//   step, which swaps the session and needs an open window;
// - passkey: our server-only `verifyStepUpPasskey`, on the challenge Better
//   Auth's passkey plugin issued.
//
// A refusal (4xx) is `false` (or null); an outage throws, and runAction turns
// that into INTERNAL.

async function refusedIsNull<T>(check: () => Promise<T>): Promise<T | null> {
  try {
    return await check();
  } catch (err) {
    if (isClientRefusal(err)) return null;
    throw err;
  }
}

async function refusedIsFalse(check: () => Promise<unknown>) {
  return (await refusedIsNull(check)) !== null;
}

export function verifyPasswordStepUp(password: string): Promise<boolean> {
  return verifyCurrentPassword(password);
}

/** The TOTP time step `code` matched for this session's account, or null. */
export async function verifyTotpStepUp(code: string): Promise<number | null> {
  const h = await headers();
  const res = await refusedIsNull(() =>
    getAuth().api.verifyStepUpTotp({ body: { code }, headers: h }),
  );
  return res?.step ?? null;
}

export async function verifyPasskeyStepUp(
  response: Record<string, unknown>,
): Promise<boolean> {
  const h = await headers();
  return refusedIsFalse(() =>
    // Better Auth's body schema checks the shape; a response with no `id`
    // is refused there (400), which reads as `false` here.
    getAuth().api.verifyStepUpPasskey({
      body: { response: response as { id: string } },
      headers: h,
    }),
  );
}
