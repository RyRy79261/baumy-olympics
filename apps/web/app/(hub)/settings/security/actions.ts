"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { sendAuthEmail } from "@baumy/auth";
import { getActor } from "@/lib/auth";
import { actionForm } from "@/lib/actions/ui";
import type { ActionResult } from "@/lib/actions/result";
import type { ActionOutput } from "@/lib/actions/registry";

// /settings/security's server actions: thin wrappers around the registry
// (issue #79). The passkey and two-factor ceremonies are Better Auth's own
// endpoints, called from the browser (lib/auth-client.ts).

const PAGE = "/settings/security";

type Result<N extends Parameters<typeof actionForm>[0]> = ActionResult<
  ActionOutput<N>
>;

export async function revokeSessionAction(
  _prev: Result<"revoke_session"> | null,
  form: FormData,
): Promise<Result<"revoke_session">> {
  const result = await actionForm("revoke_session", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function revokeOtherSessionsAction(
  _prev: Result<"revoke_other_sessions"> | null,
  form: FormData,
): Promise<Result<"revoke_other_sessions">> {
  const result = await actionForm("revoke_other_sessions", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function renamePasskeyAction(
  _prev: Result<"rename_passkey"> | null,
  form: FormData,
): Promise<Result<"rename_passkey">> {
  const result = await actionForm("rename_passkey", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function removePasskeyAction(
  _prev: Result<"remove_passkey"> | null,
  form: FormData,
): Promise<Result<"remove_passkey">> {
  const result = await actionForm("remove_passkey", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function unlinkGoogleAction(
  _prev: Result<"unlink_google"> | null,
  form: FormData,
): Promise<Result<"unlink_google">> {
  const result = await actionForm("unlink_google", form);
  if (result.ok) revalidatePath(PAGE);
  return result;
}

export async function setFirstPasswordAction(
  _prev: Result<"set_first_password"> | null,
  form: FormData,
): Promise<Result<"set_first_password">> {
  const result = await actionForm("set_first_password", form);
  if (result.ok) {
    revalidatePath(PAGE);
    // A password is a new way into the account: if a stolen session added
    // it, this email is how the owner finds out. Sent after the answer, with
    // no transaction open; sendAuthEmail never throws.
    const actor = await getActor();
    if (actor?.kind === "member") {
      const to = actor.email;
      after(async () => {
        await sendAuthEmail(process.env, { to, kind: "password-set" });
      });
    }
  }
  return result;
}
