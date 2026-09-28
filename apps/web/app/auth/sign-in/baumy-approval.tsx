"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Field, FormMessage, Input } from "@baumy/ui";
import { SOMETHING_WENT_WRONG } from "../messages";

// "Sign in with Baumy" (issue #80, ADR 0006): no password on this device.
// Baumy DMs the member's linked Telegram account; they tap the number this
// screen shows. The browser's proof is an httpOnly cookie the start route
// sets, so nothing secret passes through this component or a URL.
//
// Every address gets the same screen ("If this account is linked…"), so the
// page never says whether an account exists or is linked.

/** How often the waiting screen asks whether the member answered. */
export const POLL_MS = 2000;

const BASE = "/api/login-approval";

type Phase =
  | { kind: "form" }
  | { kind: "waiting"; code: number; expiresAt: number; message: string }
  | { kind: "signing-in" }
  | { kind: "over"; message: string };

const DENIED =
  "This sign-in was denied in Telegram. If that was not you, nothing happened.";
const EXPIRED = "Nobody answered in time. Start again, or use your password.";

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function BaumyApproval({
  initialEmail = "",
  callbackURL = "/",
  onCancel,
}: {
  initialEmail?: string;
  /** Where to go once signed in: a path on this site (safeCallbackUrl). */
  callbackURL?: string;
  /** Back to the password form. */
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const exchanging = useRef(false);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`${BASE}/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await readJson(res);
      if (!res.ok || body.ok !== true) {
        setError(
          typeof body.message === "string"
            ? body.message
            : SOMETHING_WENT_WRONG,
        );
        return;
      }
      exchanging.current = false;
      setPhase({
        kind: "waiting",
        code: Number(body.code),
        expiresAt: Date.parse(String(body.expiresAt)),
        message: String(body.message),
      });
    } catch {
      setError(SOMETHING_WENT_WRONG);
    } finally {
      setPending(false);
    }
  }

  // While waiting: ask every POLL_MS, count the time down, and trade an
  // approved request for the session exactly once.
  useEffect(() => {
    if (phase.kind !== "waiting") return;
    let stopped = false;
    const tick = () =>
      setSecondsLeft(
        Math.max(0, Math.ceil((phase.expiresAt - Date.now()) / 1000)),
      );
    tick();

    async function exchange() {
      if (exchanging.current) return;
      exchanging.current = true;
      setPhase({ kind: "signing-in" });
      try {
        const res = await fetch(`${BASE}/exchange`, { method: "POST" });
        const body = await readJson(res);
        if (res.ok && body.ok === true) {
          // A full navigation, so the server renders with the new cookie.
          window.location.assign(callbackURL);
          return;
        }
        setPhase({
          kind: "over",
          message:
            typeof body.message === "string"
              ? body.message
              : SOMETHING_WENT_WRONG,
        });
      } catch {
        setPhase({ kind: "over", message: SOMETHING_WENT_WRONG });
      }
    }

    async function poll() {
      tick();
      try {
        const res = await fetch(`${BASE}/status`, { cache: "no-store" });
        const body = await readJson(res);
        if (stopped) return;
        switch (body.status) {
          case "approved":
            stopped = true;
            await exchange();
            return;
          case "denied":
            stopped = true;
            setPhase({ kind: "over", message: DENIED });
            return;
          case "expired":
          case "used":
            stopped = true;
            setPhase({ kind: "over", message: EXPIRED });
            return;
          default:
          // Still pending, or a hiccup: ask again on the next tick.
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
    }

    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [phase, callbackURL]);

  if (phase.kind === "waiting") {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-base">{phase.message}</p>
        <p
          className="font-display text-6xl tracking-widest text-bm-green"
          data-testid="baumy-login-code"
          aria-label={`The number to tap: ${phase.code}`}
        >
          {phase.code}
        </p>
        <p className="text-sm text-bm-muted" aria-live="polite">
          Waiting for your tap in Telegram… {secondsLeft}s
        </p>
        <Button variant="ghost" onClick={onCancel}>
          Use your password instead
        </Button>
      </div>
    );
  }

  if (phase.kind === "signing-in") {
    return (
      <p role="status" className="text-center">
        Approved. Signing you in…
      </p>
    );
  }

  if (phase.kind === "over") {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage tone="error">{phase.message}</FormMessage>
        <Button onClick={() => setPhase({ kind: "form" })}>Try again</Button>
        <Button variant="ghost" onClick={onCancel}>
          Use your password instead
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={start} className="flex flex-col gap-4">
      <p className="text-base">
        Baumy will message your linked Telegram account. Tap the number this
        screen shows, and you are in.
      </p>
      <Field id="baumy-email" label="Email">
        {(control) => (
          <Input
            {...control}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={pending}
          />
        )}
      </Field>
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Asking Baumy..." : "Send to Telegram"}
      </Button>
      <Button variant="ghost" onClick={onCancel} disabled={pending}>
        Use your password instead
      </Button>
    </form>
  );
}
