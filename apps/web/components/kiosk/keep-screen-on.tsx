"use client";

import { useEffect, useState } from "react";
import { KioskIndicator } from "@baumy/ui";
import {
  keepScreenOn,
  wakeLockNotice,
  type WakeLockEnv,
  type WakeLockStatus,
} from "@/lib/kiosk/wake-lock";

/**
 * Holds the screen wake lock while the kiosk is open (lib/kiosk/wake-lock.ts)
 * and shows a tag in the corner whenever it is not held.
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
  const notice = wakeLockNotice(status);
  if (!notice) return null;
  return (
    <KioskIndicator data-testid="wake-lock-notice">{notice}</KioskIndicator>
  );
}
