"use client";

import { useEffect, useState } from "react";
import {
  keepScreenOn,
  type WakeLockEnv,
  type WakeLockStatus,
} from "@/lib/kiosk/wake-lock";

/**
 * Holds the screen wake lock while the kiosk is open (lib/kiosk/wake-lock.ts).
 * It shows nothing: the status sits on a hidden marker, for e2e only.
 */
export function KeepScreenOn() {
  const [status, setStatus] = useState<WakeLockStatus>("pending");
  useEffect(
    () =>
      keepScreenOn(
        {
          navigator: navigator as WakeLockEnv["navigator"],
          document,
          window,
        },
        setStatus,
      ),
    [],
  );
  return <span hidden data-testid="wake-lock" data-status={status} />;
}
