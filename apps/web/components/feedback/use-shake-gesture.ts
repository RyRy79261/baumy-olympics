"use client";

import { useEffect, useRef } from "react";
import { SHAKE_DEFAULTS, createShakeDetector } from "@baumy/core";

// Shake to report (issue #133), ported from camp-404
// `apps/web/components/feedback/use-shake-gesture.ts`: pure web
// DeviceMotion, the detector in @baumy/core (feedback/shake.ts).

/**
 * iOS 13+ Safari (the kitchen iPad) gates `devicemotion` behind a permission
 * that must be asked for from a user gesture. `requestPermission` only
 * exists there; elsewhere motion fires without asking.
 */
export type MotionPermission = "granted" | "denied" | "unsupported";

type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** True on browsers (iOS 13+) that ask before sending motion events. */
export function motionPermissionNeeded(): boolean {
  if (
    typeof window === "undefined" ||
    typeof DeviceMotionEvent === "undefined"
  ) {
    return false;
  }
  return (
    typeof (DeviceMotionEvent as DeviceMotionEventWithPermission)
      .requestPermission === "function"
  );
}

/** Ask for motion events. Call it from a tap: iOS refuses otherwise. */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (
    typeof window === "undefined" ||
    typeof DeviceMotionEvent === "undefined"
  ) {
    return "unsupported";
  }
  const request = (DeviceMotionEvent as DeviceMotionEventWithPermission)
    .requestPermission;
  if (typeof request !== "function") return "granted";
  try {
    return await request.call(DeviceMotionEvent);
  } catch {
    return "denied";
  }
}

/** Where the answer to the iOS prompt is remembered on this device. */
export const MOTION_ANSWER_KEY = "baumy:motion-permission";

export function rememberedMotionAnswer(): MotionPermission | null {
  try {
    const v = window.localStorage.getItem(MOTION_ANSWER_KEY);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function rememberMotionAnswer(answer: MotionPermission): void {
  try {
    window.localStorage.setItem(MOTION_ANSWER_KEY, answer);
  } catch {
    // Private mode: it is asked again next time, which is fine.
  }
}

/**
 * Fires `onShake` when the device is shaken: five jolts within 800 ms, so a
 * bump, or an iPad being straightened on its stand, does not.
 */
export function useShakeGesture({
  enabled,
  onShake,
}: {
  enabled: boolean;
  onShake: () => void;
}) {
  const onShakeRef = useRef(onShake);
  onShakeRef.current = onShake;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const detector = createShakeDetector(SHAKE_DEFAULTS);
    const SAMPLE_THROTTLE_MS = 60;
    let lastSampleAt = Number.NEGATIVE_INFINITY;

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x == null || acc.y == null || acc.z == null) return;
      const now = event.timeStamp;
      if (now - lastSampleAt < SAMPLE_THROTTLE_MS) return;
      lastSampleAt = now;
      if (detector.process({ x: acc.x, y: acc.y, z: acc.z }, now)) {
        onShakeRef.current();
      }
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, [enabled]);
}
