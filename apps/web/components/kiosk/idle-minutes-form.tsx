"use client";

import { useEffect } from "react";
import { KIOSK_IDLE_MINUTES_CHOICES } from "@baumy/types";
import { buttonClass, FormMessage } from "@baumy/ui";
import { useActionForm, type FormAction } from "@/components/use-action-form";
import type { KioskIdleData } from "@/lib/actions/kiosk-idle";
import { toast } from "@/lib/ui/toast";

// The kitchen screen's idle time (issue #147): how many minutes untouched
// before it forgets who is acting and goes home. One big button per choice
// (56px and more), the current one pressed; a tap saves it at once and
// reports through a toast.

export function IdleMinutesForm({
  current,
  action,
}: {
  current: number;
  action: FormAction<KioskIdleData>;
}) {
  const { state, formAction, pending, requestId } = useActionForm(action);
  useEffect(() => {
    if (state?.ok) {
      toast.success(
        `Saved: it forgets who is acting after ${state.data.minutes} min.`,
      );
    }
  }, [state]);
  return (
    <form
      action={formAction}
      aria-label="Forget who is acting after"
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="requestId" value={requestId} />
      <div className="flex flex-wrap gap-3" role="group">
        {KIOSK_IDLE_MINUTES_CHOICES.map((m) => (
          <button
            key={m}
            type="submit"
            name="minutes"
            value={m}
            disabled={pending}
            aria-pressed={m === current}
            className={buttonClass(
              m === current ? "primary" : "secondary",
              "kiosk",
            )}
          >
            {m} min
          </button>
        ))}
      </div>
      {state && !state.ok ? (
        <FormMessage tone="error">{state.message}</FormMessage>
      ) : null}
    </form>
  );
}
