"use client";

import { useState } from "react";
import {
  BASE_POINTS_MAX,
  BASE_POINTS_MIN,
  COOLDOWN_HOURS_MAX,
  WEIGHT_CHANGE_REASON_MAX,
} from "@baumy/types";
import { Field, FormMessage, Input, Select, Textarea } from "@baumy/ui";
import type { FormAction } from "@/components/use-action-form";
import type { ActionResult } from "@/lib/actions/result";
import type { WeightDecisionData } from "@/lib/actions/weights";
import { toast } from "@/lib/ui/toast";
import { appliesLabel, hoursField } from "@/lib/weights/view";
import { AttestedForm } from "./attested-form";

// An admin changes a bounty's points on the kitchen screen (issue #147):
// schedule_points_change, which the admin gate lets through for a picked
// admin with their PIN. The PinPad opens inside the form (AttestedForm); the
// fields are controlled, so the PIN's second send still carries them.

export interface PointsBounty {
  id: string;
  name: string;
  basePoints: number | null;
  cooldownMinutes: number | null;
}

export function KioskPointsForm({
  bounties,
  pinLabel,
  action,
}: {
  bounties: readonly PointsBounty[];
  pinLabel: string;
  action: FormAction<WeightDecisionData>;
}) {
  const first = bounties[0];
  const [choreId, setChoreId] = useState(first?.id ?? "");
  const picked = bounties.find((b) => b.id === choreId);
  const [points, setPoints] = useState(String(first?.basePoints ?? ""));
  const [hours, setHours] = useState(
    first?.cooldownMinutes != null ? hoursField(first.cooldownMinutes) : "",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pick = (id: string) => {
    setChoreId(id);
    const b = bounties.find((x) => x.id === id);
    setPoints(String(b?.basePoints ?? ""));
    setHours(b?.cooldownMinutes != null ? hoursField(b.cooldownMinutes) : "");
  };

  const onResult = (result: ActionResult<WeightDecisionData>) => {
    if (result.ok) {
      setError(null);
      setReason("");
      toast.success(
        `${picked?.name ?? "The bounty"}: ${appliesLabel(result.data.appliesAt!)}`,
      );
    } else {
      setError(result.message);
    }
  };

  if (!first) return <p className="text-base">There are no bounties yet.</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="kiosk-points-form">
      <AttestedForm
        action={action}
        label="Schedule change"
        pinLabel={pinLabel}
        onResult={onResult}
        fields={
          <>
            <Field id="kiosk-points-bounty" label="Bounty">
              {(control) => (
                <Select
                  {...control}
                  name="choreId"
                  value={choreId}
                  onChange={(e) => pick(e.currentTarget.value)}
                  className="min-h-14 text-xl"
                >
                  {bounties.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex flex-wrap gap-3">
              <div className="w-40">
                <Field id="kiosk-points-points" label="Points">
                  {(control) => (
                    <Input
                      {...control}
                      kiosk
                      name="basePoints"
                      type="number"
                      inputMode="numeric"
                      min={BASE_POINTS_MIN}
                      max={BASE_POINTS_MAX}
                      value={points}
                      onChange={(e) => setPoints(e.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
              <div className="w-48">
                <Field id="kiosk-points-cooldown" label="Cooldown (hours)">
                  {(control) => (
                    <Input
                      {...control}
                      kiosk
                      name="cooldownHours"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={COOLDOWN_HOURS_MAX}
                      step="any"
                      value={hours}
                      onChange={(e) => setHours(e.currentTarget.value)}
                    />
                  )}
                </Field>
              </div>
            </div>
            <Field id="kiosk-points-reason" label="Reason (optional)">
              {(control) => (
                <Textarea
                  {...control}
                  kiosk
                  name="reason"
                  maxLength={WEIGHT_CHANGE_REASON_MAX}
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.currentTarget.value)}
                />
              )}
            </Field>
          </>
        }
      />
      {error ? <FormMessage tone="error">{error}</FormMessage> : null}
    </div>
  );
}
