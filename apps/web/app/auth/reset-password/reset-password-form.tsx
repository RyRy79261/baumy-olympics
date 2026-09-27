"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "@baumy/auth/password";
import { authClient } from "@/lib/auth-client";
import { SOMETHING_WENT_WRONG } from "../messages";

// Ported from camp-404 `apps/web/app/auth/reset-password-form.tsx`. A missing
// or refused token is a different screen, not a disabled form.

export function ResetPasswordForm({ token }: { token: string | null }) {
  if (!token) {
    return (
      <div>
        <h1>This link can&rsquo;t be used</h1>
        <p>
          Reset links work once and expire after an hour. This one has been
          used, has expired, or lost its code on the way.
        </p>
        <p>
          <Link href="/auth/forgot-password">Send a new link</Link>
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
      <div>
        <h1>Password changed</h1>
        <p role="status">
          Every device has been signed out. Sign in with the new password.
        </p>
        <p>
          <Link href="/auth/sign-in">Sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h1>Choose a new password</h1>
      <p>
        <label htmlFor="reset-password">New password</label>
        <br />
        <input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
        <br />
        <small>At least {PASSWORD_MIN_LENGTH} characters.</small>
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Resetting..." : "Reset password"}
        </button>
      </p>
      <p>This signs you out everywhere.</p>
    </form>
  );
}
