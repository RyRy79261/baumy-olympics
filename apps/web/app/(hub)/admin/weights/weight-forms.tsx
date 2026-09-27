"use client";

import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  COOLDOWN_HOURS_MAX,
} from "@baumy/types";
import { Button, Field, FormMessage, Input } from "@baumy/ui";
import { useActionForm, type FormAction } from "@/components/use-action-form";
import type { WeightDecisionData } from "@/lib/actions/weights";
import { toast } from "@/lib/ui/toast";
import { appliesLabel, hoursField } from "@/lib/weights/view";
import {
  dismissWeightAction,
  scheduleWeightAction,
  vetoWeightAction,
} from "./actions";

// The weight decisions (SPEC §4.4): an admin schedules a suggestion, as it
// is or edited, or dismisses it; another member vetoes a scheduled change.
// The form shows its errors inline; the one-tap buttons report by toast.
//
// Success is toasted as soon as the action answers, not from an effect: the
// page re-renders with the new status and the form that asked is gone
// before an effect of its own could run (as in components/claims).

type Action = FormAction<WeightDecisionData>;

function reporting(
  action: Action,
  success: (data: WeightDecisionData) => string,
  errorsToo: boolean,
): Action {
  return async (prev, form) => {
    const result = await action(prev, form);
    if (result.ok) toast.success(success(result.data));
    else if (errorsToo) toast.error(result.message);
    return result;
  };
}

const scheduleReporting = reporting(
  scheduleWeightAction,
  (d) => appliesLabel(d.appliesAt!),
  false,
);

/** "Schedule" and "Edit & schedule" in one: the fields start at the suggestion. */
export function ScheduleWeightForm({
  suggestionId,
  choreName,
  suggestedPoints,
  suggestedCooldownMinutes,
}: {
  suggestionId: string;
  choreName: string;
  suggestedPoints: number;
  suggestedCooldownMinutes: number;
}) {
  const { state, formAction, pending, requestId, errors } =
    useActionForm(scheduleReporting);
  const id = `schedule-${suggestionId}`;
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-3"
      aria-label={`Schedule ${choreName}`}
    >
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <div className="w-32">
        <Field id={`${id}-points`} label="Points" errors={errors.basePoints}>
          {(control) => (
            <Input
              {...control}
              name="basePoints"
              type="number"
              inputMode="numeric"
              min={BASE_POINTS_MIN}
              max={BASE_POINTS_MAX}
              defaultValue={suggestedPoints}
              required
            />
          )}
        </Field>
      </div>
      <div className="w-40">
        <Field
          id={`${id}-cooldown`}
          label="Cooldown (hours)"
          errors={errors.cooldownHours}
        >
          {(control) => (
            <Input
              {...control}
              name="cooldownHours"
              type="number"
              inputMode="decimal"
              min={0}
              max={COOLDOWN_HOURS_MAX}
              step="any"
              defaultValue={hoursField(suggestedCooldownMinutes)}
              required
            />
          )}
        </Field>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Scheduling..." : "Schedule"}
      </Button>
      {state && !state.ok && state.code !== "INVALID_INPUT" ? (
        <div className="basis-full">
          <FormMessage tone="error">{state.message}</FormMessage>
        </div>
      ) : null}
    </form>
  );
}

function OneTap({
  action,
  suggestionId,
  label,
  accessibleName,
  variant = "secondary",
}: {
  action: Action;
  suggestionId: string;
  label: string;
  accessibleName: string;
  variant?: "secondary" | "danger";
}) {
  const { formAction, pending, requestId } = useActionForm(action);
  return (
    <form action={formAction}>
      <input type="hidden" name="requestId" value={requestId} />
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <Button
        type="submit"
        variant={variant}
        disabled={pending}
        aria-label={accessibleName}
      >
        {label}
      </Button>
    </form>
  );
}

const dismissReporting = reporting(
  dismissWeightAction,
  () => "Dismissed.",
  true,
);
const cancelReporting = reporting(
  dismissWeightAction,
  () => "Cancelled. The points stay.",
  true,
);
const vetoReporting = reporting(
  vetoWeightAction,
  () => "Vetoed. The points stay as they are.",
  true,
);

export function DismissWeightButton({
  suggestionId,
  choreName,
  scheduled,
}: {
  suggestionId: string;
  choreName: string;
  /** A scheduled change is cancelled rather than dismissed. */
  scheduled: boolean;
}) {
  const label = scheduled ? "Cancel" : "Dismiss";
  return (
    <OneTap
      action={scheduled ? cancelReporting : dismissReporting}
      suggestionId={suggestionId}
      label={label}
      accessibleName={`${label} the ${choreName} change`}
    />
  );
}

export function VetoWeightButton({
  suggestionId,
  choreName,
}: {
  suggestionId: string;
  choreName: string;
}) {
  return (
    <OneTap
      action={vetoReporting}
      suggestionId={suggestionId}
      label="Veto"
      accessibleName={`Veto the ${choreName} change`}
      variant="danger"
    />
  );
}
