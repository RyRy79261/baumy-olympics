"use client";

import { useActionState, useRef, useState } from "react";
import { fieldErrors, type ActionResult } from "@/lib/actions/result";

// The client half of the UI adapter (lib/actions/ui.ts): a form bound to a
// server action with useActionState, plus the hidden `requestId` the action
// needs for idempotency. The id stays the same across retries of one attempt
// and is replaced after a success, so the next submission is a new request.

export type FormAction<T> = (
  prev: ActionResult<T> | null,
  form: FormData,
) => Promise<ActionResult<T>>;

export function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Insecure contexts (plain http on a LAN address) have no randomUUID. The
  // id only needs to be unique per member, not secret.
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function useActionForm<T>(action: FormAction<T>) {
  const [requestId, setRequestId] = useState(newRequestId);
  const [state, formAction, pending] = useActionState<
    ActionResult<T> | null,
    FormData
  >(async (prev, form) => {
    const result = await action(prev, form);
    if (result.ok) setRequestId(newRequestId());
    return result;
  }, null);
  return {
    state,
    formAction,
    pending,
    requestId,
    errors: fieldErrors(state),
  };
}

/**
 * The action, then `onDone` on success. Read through a ref, so the form's
 * action never goes stale and a sheet can close before it re-renders.
 */
export function useReporting<T>(
  action: FormAction<T>,
  onDone: (data: T) => void,
): FormAction<T> {
  const done = useRef(onDone);
  done.current = onDone;
  const [wrapped] = useState<FormAction<T>>(() => {
    const send: FormAction<T> = async (prev, form) => {
      const result = await action(prev, form);
      if (result.ok) done.current(result.data);
      return result;
    };
    return send;
  });
  return wrapped;
}
