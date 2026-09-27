"use client";

import { useEffect, useState } from "react";
import { POT_NOTE_MAX } from "@baumy/types";
import { Button, Card, Field, FormMessage, Input, Select } from "@baumy/ui";
import { useActionForm } from "@/components/use-action-form";
import { formatEuros } from "@/lib/scores/view";
import { toast } from "@/lib/ui/toast";
import { addPotContributionAction } from "./actions";

// /pot's admin form (`add_pot_contribution`): who paid how much for which
// month. The pot is a ledger only; the money moves at the bank.

export function AddContributionForm({
  members,
  me,
  month,
}: {
  members: { id: string; displayName: string }[];
  me: string;
  /** The current Berlin month, "YYYY-MM": the default and the latest. */
  month: string;
}) {
  const { state, formAction, pending, requestId, errors } = useActionForm(
    addPotContributionAction,
  );
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (state?.ok) {
      toast.success(`Added ${formatEuros(state.data.amountCents)} to the pot.`);
      setRound((n) => n + 1);
    }
  }, [state]);
  return (
    <Card title="Add to the pot">
      <form key={round} action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="requestId" value={requestId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pot-month" label="Month" errors={errors.month}>
            {(control) => (
              <Input
                {...control}
                name="month"
                type="month"
                max={month}
                required
                defaultValue={month}
              />
            )}
          </Field>
          <Field
            id="pot-amount"
            label="Amount (€)"
            hint="Like 25 or 25.50."
            errors={errors.amount}
          >
            {(control) => (
              <Input {...control} name="amount" inputMode="decimal" required />
            )}
          </Field>
          <Field id="pot-payer" label="Paid by" errors={errors.contributedBy}>
            {(control) => (
              <Select {...control} name="contributedBy" defaultValue={me}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="pot-note" label="Note (optional)" errors={errors.note}>
            {(control) => (
              <Input {...control} name="note" maxLength={POT_NOTE_MAX} />
            )}
          </Field>
        </div>
        {state && !state.ok && state.code !== "INVALID_INPUT" ? (
          <FormMessage tone="error">{state.message}</FormMessage>
        ) : null}
        <Button type="submit" disabled={pending} className="self-start">
          {pending ? "Adding..." : "Add to the pot"}
        </Button>
      </form>
    </Card>
  );
}
