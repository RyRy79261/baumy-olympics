"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  Button,
  Field,
  FormMessage,
  Input,
  PageHeading,
  linkClass,
} from "@baumy/ui";
import { PASSWORD_MIN_LENGTH } from "@baumy/auth/password";
import { authClient } from "@/lib/auth-client";
import { SOMETHING_WENT_WRONG } from "../messages";

// Ported from camp-404 `apps/web/app/auth/reset-password-form.tsx`. A missing
// or refused token is a different screen, not a disabled form.

export function ResetPasswordForm({ token }: { token: string | null }) {
  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading title="This link can’t be used" />
        <p>
          Reset links work once and expire after an hour. This one has been
          used, has expired, or lost its code on the way.
        </p>
        <p>
          <Link href="/auth/forgot-password" className={linkClass}>
            Send a new link
          </Link>
        </p>
      </div>
    );
  }
  return <ResetForm token={token} />;
}

function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    setPending(true);
    try {
      const result = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (result.error) {
        setError(
          result.error.code === "INVALID_TOKEN"
            ? "This link has expired or was already used. Send yourself a new one."
            : SOMETHING_WENT_WRONG,
        );
        return;
      }
      setDone(true);
    } catch {
      setError(SOMETHING_WENT_WRONG);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeading title="Password changed" />
        <FormMessage tone="success">
          Every device has been signed out. Sign in with the new password.
        </FormMessage>
        <p>
          <Link href="/auth/sign-in" className={linkClass}>
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PageHeading title="Choose a new password" />
      <Field
        id="reset-password"
        label="New password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={pending}
          />
        )}
      </Field>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Resetting..." : "Reset password"}
      </Button>
      <p className="text-bm-muted">This signs you out everywhere.</p>
    </form>
  );
}
