"use client";

import { useRouter } from "next/navigation";
import { clearPickAction } from "@/app/kiosk/actions";
import { KIOSK_IDLE_MS } from "@/lib/kiosk/constants";
import { useIdle } from "./use-idle";

/**
 * After 60 seconds untouched, forget who is acting and go back to the kiosk
 * home. A basic version; the polish (a countdown, night mode) is issue #29.
 */
export function IdleReset({ active }: { active: boolean }) {
  const router = useRouter();
  useIdle(active, KIOSK_IDLE_MS, () => {
    void clearPickAction().then(() => {
      router.replace("/kiosk");
      router.refresh();
    });
  });
  return null;
}
