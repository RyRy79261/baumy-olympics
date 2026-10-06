"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  FormMessage,
  PinPad,
  type ButtonVariant,
} from "@baumy/ui";
import { useActionForm, type FormAction } from "@/components/use-action-form";
import type { ActionResult } from "@/lib/actions/result";
import { PIN_PROMPT_CODES } from "@/lib/kiosk/constants";
import { useActingPin } from "./acting-pin";
import { NoPinNotice } from "./no-pin-notice";

// A kiosk form whose action may need the acting member's PIN (SPEC §6.2).
// The first tap sends the request WITHOUT a PIN. If the gate answers
// ATTESTATION_REQUIRED (or the PIN was wrong), the PinPad opens INSIDE this
// form, and its OK sends the same request again with the PIN. The pad is
// remounted for every attempt, so the digits last one request; after a
// success it is gone, and the next request asks again.
//
// With `onResult`, the caller reports the outcome itself (a toast, a score
// pop): the form shows nothing inline except inside the PIN pad. The same
// form works off the kiosk, where a session attests itself and the pad never
// opens.
//
// A member with no personal PIN (the kiosk shell's `hasPin`, or the gate's
// PIN_NOT_SET) never sees the pad: the same dialog says "<Name> hasn't set a
// personal PIN yet", what it is for, and shows a QR code to Settings (issue
// #145).

export function AttestedForm<T>({
  action,
  label,
  pinLabel,
  fields,
  success,
  onResult,
  onPending,
  disabled = false,
  variant = "primary",
  bar,
}: {
  action: FormAction<T>;
  /** The button that starts the request. */
  label: string;
  /** What the PIN pad is for, e.g. "Ryan's PIN". */
  pinLabel: string;
  /** Hidden inputs: the action's own input. */
  fields?: ReactNode;
  /** What to show after it worked. */
  success?: (data: T) => ReactNode;
  /** Called once per answer that does not ask for a PIN. */
  onResult?: (result: ActionResult<T>) => void;
  /**
   * Told when a request starts and when its answer is in, so a sheet
   * around the form stays open until then (issue #174).
   */
  onPending?: (pending: boolean) => void;
  disabled?: boolean;
  /** The start button's look; primary unless given. */
  variant?: ButtonVariant;
  /**
   * Puts the start button in a bar of its own, with `extra` beside it (a
   * Discard), e.g. one that sticks to the bottom of a long form.
   */
  bar?: { className: string; testId?: string; extra?: ReactNode };
}) {
  const { state, formAction, pending, requestId } = useActionForm(action);
  const [attempt, setAttempt] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const failed: ActionResult<T> | null = state && !state.ok ? state : null;
  const needsPin =
    failed !== null && !failed.ok && PIN_PROMPT_CODES.has(failed.code);
  const pinOpen = needsPin && !dismissed;
  const acting = useActingPin();
  const failedCode = failed && !failed.ok ? failed.code : null;
  const noPin = needsPin && (!acting.hasPin || failedCode === "PIN_NOT_SET");

  useEffect(() => {
    if (!state || !onResult) return;
    if (!state.ok && PIN_PROMPT_CODES.has(state.code)) return;
    onResult(state);
    // Once per answer: `state` is a new object for every submission, while
    // `onResult` may be a new function on every render.
  }, [state]);

  const pendingLatest = useRef(onPending);
  pendingLatest.current = onPending;
  useEffect(() => {
    pendingLatest.current?.(pending);
  }, [pending]);
  // Gone mid-request (it cannot be while a sheet waits on it): not sending.
  useEffect(() => () => pendingLatest.current?.(false), []);

  return (
    <form
      action={(form) => {
        setDismissed(false);
        setAttempt((n) => n + 1);
        formAction(form);
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="requestId" value={requestId} />
      {fields}
      {bar ? (
        <div className={bar.className} data-testid={bar.testId}>
          <Button
            type="submit"
            size="kiosk"
            variant={variant}
            disabled={pending || disabled}
          >
            {label}
          </Button>
          {bar.extra}
        </div>
      ) : (
        <Button
          type="submit"
          size="kiosk"
          variant={variant}
          disabled={pending || disabled}
        >
          {label}
        </Button>
      )}
      {state?.ok && success && !onResult ? (
        <FormMessage tone="success">{success(state.data)}</FormMessage>
      ) : null}
      {failed && !failed.ok && !needsPin && !onResult ? (
        <FormMessage tone="error">{failed.message}</FormMessage>
      ) : null}
      <Dialog
        open={pinOpen}
        onClose={() => setDismissed(true)}
        title={noPin ? "Personal PIN needed" : pinLabel}
      >
        <div className="flex flex-col gap-4">
          {noPin ? <NoPinNotice name={acting.name} /> : null}
          {!noPin &&
          failed &&
          !failed.ok &&
          failed.code !== "ATTESTATION_REQUIRED" ? (
            <FormMessage tone="error">{failed.message}</FormMessage>
          ) : null}
          {pinOpen && !noPin ? (
            <PinPad
              key={attempt}
              label={pinLabel}
              submitLabel="OK"
              pending={pending}
              onCancel={() => setDismissed(true)}
            />
          ) : null}
        </div>
      </Dialog>
    </form>
  );
}
