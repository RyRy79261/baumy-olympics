// Shake detection (issue #133), ported from camp-404
// `packages/core/src/shake.ts` (itself from intake-tracker's
// use-shake-gesture). A pure state machine: no React, no DOM, and the caller
// passes `now`. apps/web/components/feedback/use-shake-gesture.ts wraps it
// in the React hook and the iOS permission helpers.

export interface ShakeSample {
  x: number;
  y: number;
  z: number;
}

export interface ShakeDetectorConfig {
  /**
   * Change in total acceleration magnitude (m/s²) between samples that counts
   * as a jolt. Magnitude is rotation-invariant: tilting the device moves
   * gravity between the axes but leaves the magnitude near 9.8, so only real
   * movement registers.
   */
  threshold: number;
  /** Jolts within the rolling window needed to fire. */
  requiredJolts: number;
  /** The rolling window the jolts must fall within. */
  windowMs: number;
  /** The least gap between two detections. */
  cooldownMs: number;
}

/** The hook's defaults: a deliberate shake, never a bump. */
export const SHAKE_DEFAULTS: ShakeDetectorConfig = {
  threshold: 8,
  requiredJolts: 5,
  windowMs: 800,
  cooldownMs: 3000,
};

function magnitude(sample: ShakeSample): number {
  return Math.sqrt(
    sample.x * sample.x + sample.y * sample.y + sample.z * sample.z,
  );
}

/**
 * Feed it accelerometer samples through `process`; it returns `true` on the
 * sample that completes a shake.
 */
export function createShakeDetector(config: ShakeDetectorConfig) {
  let lastMagnitude: number | null = null;
  let lastShakeAt = Number.NEGATIVE_INFINITY;
  let jolts: number[] = [];

  return {
    process(sample: ShakeSample, now: number): boolean {
      const mag = magnitude(sample);
      if (lastMagnitude !== null) {
        const delta = Math.abs(mag - lastMagnitude);
        if (delta > config.threshold) jolts.push(now);
      }
      lastMagnitude = mag;

      jolts = jolts.filter((t) => now - t <= config.windowMs);
      if (
        jolts.length >= config.requiredJolts &&
        // `>=`: a gap of exactly cooldownMs counts, like the window's `<=`.
        now - lastShakeAt >= config.cooldownMs
      ) {
        lastShakeAt = now;
        jolts = [];
        return true;
      }
      return false;
    },
  };
}
