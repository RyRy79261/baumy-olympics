"use client";

import { useState, type ReactNode } from "react";
import { Button, Dialog, FormMessage, PinPad } from "@baumy/ui";
import { useActionForm, type FormAction } from "@/components/use-action-form";
import type { ActionResult } from "@/lib/actions/result";
import { PIN_PROMPT_CODES } from "@/lib/kiosk/constants";

// A kiosk form whose action may need the acting member's PIN (SPEC §6.2).
// The first tap sends the request WITHOUT a PIN. If the gate answers
// ATTESTATION_REQUIRED (or the PIN was wrong), the PinPad opens INSIDE this
// form, and its OK sends the same request again with the PIN. The pad is
// remounted for every attempt, so the digits last one request; after a
// success it is gone, and the next request asks again.

export function AttestedForm<T>({
  action,
  label,
  pinLabel,
  fields,
  success,
}: {
  action: FormAction<T>;
  /** The button that starts the request. */
  label: string;
  /** What the PIN pad is for, e.g. "Ryan's PIN". */
  pinLabel: string;
  /** Hidden inputs: the action's own input. */
  fields?: ReactNode;
  /** What to show after it worked. */
  success: (data: T) => ReactNode;
}) {
  const { state, formAction, pending, requestId } = useActionForm(action);
  const [attempt, setAttempt] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const failed: ActionResult<T> | null = state && !state.ok ? state : null;
  const needsPin =
    failed !== null && !failed.ok && PIN_PROMPT_CODES.has(failed.code);
  const pinOpen = needsPin && !dismissed;

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
      <Button type="submit" size="kiosk" disabled={pending}>
        {label}
      </Button>
      {state?.ok ? (
        <FormMessage tone="success">{success(state.data)}</FormMessage>
      ) : null}
      {failed && !failed.ok && !needsPin ? (
        <FormMessage tone="error">{failed.message}</FormMessage>
      ) : null}
      <Dialog
        open={pinOpen}
        onClose={() => setDismissed(true)}
        title={pinLabel}
      >
        <div className="flex flex-col gap-4">
          {failed && !failed.ok && failed.code !== "ATTESTATION_REQUIRED" ? (
            <FormMessage tone="error">{failed.message}</FormMessage>
          ) : null}
          {pinOpen ? (
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
