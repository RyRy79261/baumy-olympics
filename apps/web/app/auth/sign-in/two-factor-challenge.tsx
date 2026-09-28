"use client";

import { useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Field,
  FormMessage,
  Input,
  PageHeading,
} from "@baumy/ui";
import { authClient } from "@/lib/auth-client";
import { SOMETHING_WENT_WRONG, twoFactorErrorSentence } from "../messages";

// The step after a correct password when two-factor is on (issue #79), as
// camp-404 `packages/ui/src/components/account-two-factor-challenge.tsx`.
// Better Auth's signIn.email answers `twoFactorRedirect` instead of a
// session, and the sign-in form renders this in its place. Two ways
// through, so a lost phone is never a dead end: a 6-digit code from the
// authenticator app, or a one-time backup code.

export function TwoFactorChallenge({
  onVerified,
}: {
  /** Called once the code verifies and a full session exists. */
  onVerified: () => void;
}) {
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totp = mode === "totp";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = totp
        ? await authClient.twoFactor.verifyTotp({ code, trustDevice })
        : await authClient.twoFactor.verifyBackupCode({ code, trustDevice });
      if (result.error) {
        setError(twoFactorErrorSentence(result.error, mode));
        setPending(false);
        return;
      }
      onVerified();
    } catch {
      setError(SOMETHING_WENT_WRONG);
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <PageHeading
        title="One more step"
        description={
          totp
            ? "Enter the 6-digit code from your authenticator app."
            : "Enter one of your backup codes. Each one works once."
        }
      />
      <Field id="two-factor-code" label={totp ? "6-digit code" : "Backup code"}>
        {(control) => (
          <Input
            {...control}
            inputMode={totp ? "numeric" : "text"}
            autoComplete="one-time-code"
            autoFocus
            maxLength={totp ? 6 : 32}
            value={code}
            onChange={(e) =>
              setCode(
                totp
                  ? e.target.value.replace(/\D/g, "").slice(0, 6)
                  : e.target.value.trim(),
              )
            }
            disabled={pending}
            required
          />
        )}
      </Field>
      <Checkbox
        id="two-factor-trust"
        label="Trust this device for 30 days"
        checked={trustDevice}
        onChange={(e) => setTrustDevice(e.target.checked)}
        disabled={pending}
      />
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Button
        type="submit"
        disabled={pending || (totp ? code.length !== 6 : code.length === 0)}
      >
        {pending ? "Checking..." : "Verify"}
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          setMode(totp ? "backup" : "totp");
          setCode("");
          setError(null);
        }}
        disabled={pending}
      >
        {totp
          ? "Lost your phone? Use a backup code"
          : "Use a code from your authenticator app"}
      </Button>
    </form>
  );
}
