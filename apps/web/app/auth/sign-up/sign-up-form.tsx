"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { PASSWORD_MIN_LENGTH } from "@baumy/auth/password";
import { authClient } from "@/lib/auth-client";
import { signUpErrorSentence, SOMETHING_WENT_WRONG } from "../messages";

/**
 * Email and password sign-up. The name Better Auth requires is the email for
 * now; the household display name belongs to the `members` row (issue #9).
 */
export function SignUpForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < PASSWORD_MIN_LENGTH) {
      setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const trimmed = email.trim();
      const result = await authClient.signUp.email({
        email: trimmed,
        password,
        name: trimmed,
      });
      if (result.error) {
        setError(signUpErrorSentence(result.error));
        setPending(false);
        return;
      }
      window.location.assign("/");
    } catch {
      setError(SOMETHING_WENT_WRONG);
      setPending(false);
    }
  }

  async function google() {
    setError(null);
    setPending(true);
    try {
      await authClient.signIn.social({ provider: "google", callbackURL: "/" });
    } catch {
      setError(SOMETHING_WENT_WRONG);
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1>Create an account</h1>
      <p>
        <label htmlFor="signup-email">Email</label>
        <br />
        <input
          id="signup-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </p>
      <p>
        <label htmlFor="signup-password">Password</label>
        <br />
        <input
          id="signup-password"
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
      <p>
        <label htmlFor="signup-confirm">Confirm password</label>
        <br />
        <input
          id="signup-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
        />
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Creating account..." : "Create account"}
        </button>
      </p>
      {googleEnabled ? (
        <p>
          <button type="button" onClick={google} disabled={pending}>
            Continue with Google
          </button>
        </p>
      ) : null}
      <p>
        Already have an account? <Link href="/auth/sign-in">Sign in</Link>
      </p>
    </form>
  );
}
