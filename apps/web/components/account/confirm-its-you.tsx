"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button, Dialog, Field, FormMessage, Input } from "@baumy/ui";
import { newRequestId, type FormAction } from "@/components/use-action-form";
import type {
  BaumyConfirmation,
  StepUpOption,
  StepUpView,
} from "@/lib/actions/step-up";
import type { ActionResult } from "@/lib/actions/result";
import { authClient } from "@/lib/auth-client";
import {
  confirmIdentityAction,
  getBaumyConfirmationAction,
  getStepUpAction,
  requestBaumyConfirmationAction,
} from "./step-up-actions";

// "Confirm it's you" (issue #135, ADR 0007), GitHub's sudo mode: ONE dialog
// for every sensitive change. A form wraps its server action in `guard`; when
// the action answers REAUTH_REQUIRED, the dialog opens with the methods this
// member actually has (get_step_up), and once one works (confirm_identity)
// the same request is sent again. The session then has a 10-minute window,
// so the next sensitive change does not open the dialog at all.
//
// The methods, in this order, each only when the member has it:
// - a passkey: Better Auth's passkey challenge, the browser's prompt, and the
//   assertion to confirm_identity (no new session);
// - the two-factor code from their app;
// - "Sign in with Baumy": a Telegram DM, tap the number shown here;
// - the password;
// - Google: a fresh Google sign-in, which counts for 10 minutes like any
//   sign-in. It leaves the page, so the member does the change again after.

const WINDOW_HINT =
  "You won't be asked again on this device for the next 10 minutes.";

/** How often the dialog asks whether the Telegram tap has come in. */
const BAUMY_POLL_MS = 2_000;

type Outcome = (confirmed: boolean) => void;

/**
 * Google's sign-in URL, made to ask for the Google password again
 * (`prompt=login`, `max_age=0`), so a browser already signed in to Google
 * cannot confirm with one click. Better Auth 1.6.25 sets `prompt` only for
 * the whole provider and does not check the id token's `auth_time`, so this
 * is the browser's request, not something the server verifies (ADR 0007).
 */
export function reauthUrl(googleUrl: string): string {
  const url = new URL(googleUrl);
  url.searchParams.set("prompt", "login");
  url.searchParams.set("max_age", "0");
  return url.toString();
}

/**
 * The dialog and the wrapper that opens it. Render `dialog` once in the
 * component that uses `guard`.
 */
export function useStepUp(): {
  guard: <T>(action: FormAction<T>) => FormAction<T>;
  /**
   * For Better Auth's own security endpoints (adding a passkey, two-factor):
   * true when this session's window is open, else the dialog's answer.
   */
  ensure: () => Promise<boolean>;
  dialog: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const pending = useRef<Outcome | null>(null);

  const finish = useCallback((confirmed: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOpen(false);
    resolve?.(confirmed);
  }, []);

  const confirm = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
        pending.current?.(false);
        pending.current = resolve;
        setOpen(true);
      }),
    [],
  );

  const guard = useCallback(
    <T,>(action: FormAction<T>): FormAction<T> =>
      async (prev, form) => {
        const first = await action(prev, form);
        if (first.ok || first.code !== "REAUTH_REQUIRED") return first;
        if (!(await confirm())) return first;
        return action(prev, form);
      },
    [confirm],
  );

  const ensure = useCallback(async () => {
    const view = await getStepUpAction().catch(() => null);
    if (view?.ok && view.data.until) return true;
    return confirm();
  }, [confirm]);

  return {
    guard,
    ensure,
    dialog: (
      <Dialog
        open={open}
        onClose={() => finish(false)}
        title="Confirm it's you"
      >
        {open ? <StepUpChoices onDone={finish} /> : null}
      </Dialog>
    ),
  };
}

/** What a failed action says, or a fallback. */
function sentence(result: ActionResult<unknown> | null, fallback: string) {
  return result && !result.ok ? result.message : fallback;
}

function StepUpChoices({ onDone }: { onDone: Outcome }) {
  const [view, setView] = useState<StepUpView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<StepUpOption | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [baumy, setBaumy] = useState<BaumyConfirmation | null>(null);

  useEffect(() => {
    let live = true;
    void getStepUpAction()
      .then((res) => {
        if (!live) return;
        if (!res.ok) {
          setError(res.message);
          return;
        }
        // Confirmed meanwhile (another tab): nothing to ask.
        if (res.data.until) onDone(true);
        else setView(res.data);
      })
      .catch(() => live && setError("Something went wrong. Please try again."));
    return () => {
      live = false;
    };
  }, [onDone]);

  const confirmWith = useCallback(
    async (method: StepUpOption, proof: Record<string, unknown>) => {
      setError(null);
      setBusy(method);
      const res = await confirmIdentityAction(proof, newRequestId()).catch(
        () => null,
      );
      setBusy(null);
      if (res?.ok) onDone(true);
      else setError(sentence(res, "Something went wrong. Please try again."));
      return res?.ok ?? false;
    },
    [onDone],
  );

  // Ask whether the Telegram tap has come in, until it has or it is over.
  useEffect(() => {
    if (!baumy) return;
    let live = true;
    const timer = setInterval(async () => {
      const res = await getBaumyConfirmationAction(baumy.approvalId).catch(
        () => null,
      );
      if (!live || !res?.ok) return;
      const { status } = res.data;
      if (status === "pending") return;
      clearInterval(timer);
      setBaumy(null);
      if (status === "approved") {
        await confirmWith("baumy", {
          method: "baumy",
          approvalId: baumy.approvalId,
        });
      } else {
        setError(
          status === "denied"
            ? "That was turned down in Telegram. Use another way."
            : "That request ran out. Start again.",
        );
      }
    }, BAUMY_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [baumy, confirmWith]);

  async function withPasskey() {
    setError(null);
    setBusy("passkey");
    try {
      const options = await authClient.$fetch<
        Parameters<typeof startAuthentication>[0]["optionsJSON"]
      >("/passkey/generate-authenticate-options", {
        method: "GET",
        throw: false,
      });
      if (!options.data) throw new Error("no options");
      const assertion = await startAuthentication({
        optionsJSON: options.data,
      });
      setBusy(null);
      await confirmWith("passkey", {
        method: "passkey",
        response: assertion as unknown as Record<string, unknown>,
      });
    } catch {
      setBusy(null);
      setError("The passkey prompt was closed or failed. Try again.");
    }
  }

  async function withBaumy() {
    setError(null);
    setBusy("baumy");
    const res = await requestBaumyConfirmationAction(newRequestId()).catch(
      () => null,
    );
    setBusy(null);
    if (res?.ok) setBaumy(res.data);
    else setError(sentence(res, "Something went wrong. Please try again."));
  }

  async function withGoogle() {
    setError(null);
    setBusy("google");
    const res = await authClient.signIn
      .social({
        provider: "google",
        callbackURL: window.location.pathname,
        disableRedirect: true,
      })
      .catch(() => null);
    const url = res && !res.error ? res.data?.url : undefined;
    if (!url) {
      setBusy(null);
      setError("Google didn't open. Try again, or use another way.");
      return;
    }
    window.location.assign(reauthUrl(url));
  }

  function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void confirmWith("totp", { method: "totp", code }).then(
      (ok) => ok || setCode(""),
    );
  }

  function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void confirmWith("password", { method: "password", password }).then(
      (ok) => ok || setPassword(""),
    );
  }

  const disabled = busy !== null || baumy !== null;
  const has = (m: StepUpOption) => view?.methods.includes(m) ?? false;

  return (
    <div className="flex flex-col gap-4" data-testid="confirm-its-you">
      <p className="text-base text-bm-muted">
        This change needs you to show it&rsquo;s you. {WINDOW_HINT}
      </p>
      {view === null && !error ? (
        <p className="text-base text-bm-muted">Loading...</p>
      ) : null}

      {has("passkey") ? (
        <Button onClick={withPasskey} disabled={disabled}>
          {busy === "passkey" ? "Waiting for your device..." : "Use a passkey"}
        </Button>
      ) : null}

      {has("totp") ? (
        <form onSubmit={submitCode} className="flex flex-col gap-3" noValidate>
          <Field
            id="step-up-code"
            label="6-digit code"
            hint="From your authenticator app."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) =>
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                disabled={disabled}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="secondary"
            className="self-start"
            disabled={disabled || code.length !== 6}
          >
            {busy === "totp" ? "Checking..." : "Confirm with code"}
          </Button>
        </form>
      ) : null}

      {has("baumy") ? (
        baumy ? (
          <FormMessage tone="success">
            Baumy sent you a message in Telegram. Tap{" "}
            <strong data-testid="step-up-baumy-code">{baumy.code}</strong>{" "}
            there.
          </FormMessage>
        ) : (
          <Button variant="secondary" onClick={withBaumy} disabled={disabled}>
            {busy === "baumy" ? "Asking Baumy..." : "Approve in Telegram"}
          </Button>
        )
      ) : null}

      {has("password") ? (
        <form
          onSubmit={submitPassword}
          className="flex flex-col gap-3"
          noValidate
        >
          <Field id="step-up-password" label="Your password">
            {(control) => (
              <Input
                {...control}
                type="password"
                autoComplete="current-password"
                maxLength={256}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={disabled}
              />
            )}
          </Field>
          <Button
            type="submit"
            variant="secondary"
            className="self-start"
            disabled={disabled || !password}
          >
            {busy === "password" ? "Checking..." : "Confirm with password"}
          </Button>
        </form>
      ) : null}

      {has("google") ? (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={withGoogle} disabled={disabled}>
            {busy === "google"
              ? "Opening Google..."
              : "Sign in again with Google"}
          </Button>
          <p className="text-base text-bm-muted">
            You&rsquo;ll come back here signed in afresh. Then do it again.
          </p>
        </div>
      ) : null}

      {view && view.methods.length === 0 ? (
        <p className="text-base">
          Sign out and sign in again, then do this within 10 minutes.
        </p>
      ) : null}

      {error ? <FormMessage tone="error">{error}</FormMessage> : null}

      <Button
        variant="ghost"
        className="self-start"
        onClick={() => onDone(false)}
      >
        Cancel
      </Button>
    </div>
  );
}
