"use client";

import { useActionState } from "react";
import { Button, Field, FormMessage, Input } from "@baumy/ui";
import { fieldErrors, type ActionResult } from "@/lib/actions/result";
import { pairKioskAction } from "../actions";

/** The pairing code, and the way in. Success redirects to /kiosk. */
export function PairForm() {
  const [state, formAction, pending] = useActionState<
    ActionResult<null> | null,
    FormData
  >(pairKioskAction, null);
  const errors = fieldErrors(state);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Field id="pair-code" label="Pairing code" errors={errors.code}>
        {(control) => (
          <Input
            {...control}
            kiosk
            name="code"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="ABCD-EFGH"
            maxLength={16}
            required
          />
        )}
      </Field>
      {state && !state.ok && state.code !== "INVALID_INPUT" ? (
        <FormMessage tone="error">{state.message}</FormMessage>
      ) : null}
      <Button type="submit" size="kiosk" disabled={pending}>
        {pending ? "Pairing..." : "Pair this kiosk"}
      </Button>
    </form>
  );
}
