"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { signInErrorSentence, SOMETHING_WENT_WRONG } from "../messages";

/** Email and password sign-in, plus Google when this deployment has its keys. */
export function SignInForm({ googleEnabled }: { googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.email({
        email: email.trim(),
        password,
      });
      if (result.error) {
        setError(signInErrorSentence(result.error));
        setPending(false);
        return;
      }
      // A full navigation, so the server renders home with the new cookie.
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
      <h1>Sign in</h1>
      <p>
        <label htmlFor="signin-email">Email</label>
        <br />
        <input
          id="signin-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </p>
      <p>
        <label htmlFor="signin-password">Password</label>
        <br />
        <input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        <button type="submit" disabled={pending}>
          {pending ? "Signing in..." : "Sign in"}
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
        <Link href="/auth/forgot-password">Forgot your password?</Link>
      </p>
      <p>
        New here? <Link href="/auth/sign-up">Create an account</Link>
      </p>
    </form>
  );
}
