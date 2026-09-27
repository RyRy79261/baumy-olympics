"use client";

import { AttestedForm } from "@/components/kiosk/attested-form";
import { checkPinAction } from "../actions";

export function CheckPinForm({ displayName }: { displayName: string }) {
  return (
    <AttestedForm
      action={checkPinAction}
      label="Check my PIN"
      pinLabel={`${displayName}'s PIN`}
      success={(data) => `PIN accepted for ${data.displayName ?? "you"}.`}
    />
  );
}
