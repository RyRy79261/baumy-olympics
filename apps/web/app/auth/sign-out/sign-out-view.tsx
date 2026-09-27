"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

/**
 * /auth/sign-out: end the session, then go to sign-in. Ported from camp-404
 * `apps/web/app/auth/sign-out-view.tsx`. Better Auth deletes the session row
 * and clears the cookies; if that fails the screen says so rather than leaving
 * for sign-in as if it worked.
 */
export function SignOutView() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authClient
      .signOut()
      .then((result) => {
        if (cancelled) return;
        if (result.error) {
          setFailed(true);
          return;
        }
        window.location.replace("/auth/sign-in");
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div>
        <h1>You may still be signed in</h1>
        <p role="alert">
          Signing out didn&rsquo;t finish. Check your connection and try again.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  return <p role="status">Signing you out...</p>;
}
