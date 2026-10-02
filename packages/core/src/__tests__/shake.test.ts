import { describe, expect, it } from "vitest";
import { SHAKE_DEFAULTS, createShakeDetector } from "../feedback/shake";

// Ported from camp-404 `packages/core/src/__tests__/shake.test.ts`. The
// detector fires when `requiredJolts` magnitude changes above `threshold`
// land within `windowMs`, with `cooldownMs` between fires. Magnitude is
// rotation-invariant, so turning the device never fires.

const CONFIG = {
  threshold: 8,
  requiredJolts: 3,
  windowMs: 800,
  cooldownMs: 3000,
};

// z=9.8 (rest) ↔ z=20 swings give a magnitude change of ~10.2 > threshold.
const REST = { x: 0, y: 0, z: 9.8 };
const SWING = { x: 0, y: 0, z: 20 };

describe("createShakeDetector", () => {
  it("does not fire on the first sample or a single jolt", () => {
    const d = createShakeDetector(CONFIG);
    expect(d.process(REST, 0)).toBe(false);
    expect(d.process(SWING, 60)).toBe(false);
  });

  it("fires once enough jolts land within the window", () => {
    const d = createShakeDetector(CONFIG);
    expect(d.process(REST, 0)).toBe(false);
    expect(d.process(SWING, 60)).toBe(false);
    expect(d.process(REST, 120)).toBe(false);
    expect(d.process(SWING, 180)).toBe(true);
  });

  it("ignores reorientation across many axis flips", () => {
    const d = createShakeDetector(CONFIG);
    expect(d.process({ x: 0, y: 0, z: 9.8 }, 0)).toBe(false);
    expect(d.process({ x: 9.8, y: 0, z: 0 }, 60)).toBe(false);
    expect(d.process({ x: 0, y: 0, z: 9.8 }, 120)).toBe(false);
    expect(d.process({ x: 9.8, y: 0, z: 0 }, 180)).toBe(false);
    expect(d.process({ x: 0, y: 0, z: 9.8 }, 240)).toBe(false);
  });

  it("does not fire again within the cooldown", () => {
    const d = createShakeDetector(CONFIG);
    d.process(REST, 0);
    d.process(SWING, 60);
    d.process(REST, 120);
    expect(d.process(SWING, 180)).toBe(true);
    expect(d.process(REST, 240)).toBe(false);
    expect(d.process(SWING, 300)).toBe(false);
    expect(d.process(REST, 360)).toBe(false);
  });

  it("fires again once exactly cooldownMs has passed", () => {
    const d = createShakeDetector(CONFIG);
    d.process(REST, 0);
    d.process(SWING, 60);
    d.process(REST, 120);
    expect(d.process(SWING, 180)).toBe(true);
    expect(d.process(REST, 3060)).toBe(false);
    expect(d.process(SWING, 3120)).toBe(false);
    expect(d.process(REST, 3180)).toBe(true);
  });

  it("expires jolts outside the window", () => {
    const d = createShakeDetector(CONFIG);
    d.process(REST, 0);
    d.process(SWING, 60);
    d.process(REST, 120);
    expect(d.process(SWING, 1000)).toBe(false);
  });

  it("keeps a jolt exactly windowMs old, and drops one a ms older", () => {
    const kept = createShakeDetector(CONFIG);
    kept.process(REST, 0);
    kept.process(SWING, 100);
    kept.process(REST, 160);
    expect(kept.process(SWING, 900)).toBe(true);

    const dropped = createShakeDetector(CONFIG);
    dropped.process(REST, 0);
    dropped.process(SWING, 100);
    dropped.process(REST, 160);
    expect(dropped.process(SWING, 901)).toBe(false);
  });

  it("needs five jolts by default, so a bump never opens the reporter", () => {
    const d = createShakeDetector(SHAKE_DEFAULTS);
    const at = [0, 60, 120, 180, 240];
    const samples = [REST, SWING, REST, SWING, REST];
    expect(at.map((t, i) => d.process(samples[i]!, t))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(d.process(SWING, 300)).toBe(true);
  });
});
