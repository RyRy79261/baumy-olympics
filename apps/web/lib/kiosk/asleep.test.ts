import { describe, expect, it, vi } from "vitest";
import { isKioskAsleep, setKioskAsleep, subscribeKioskAsleep } from "./asleep";

describe("kiosk asleep", () => {
  it("holds the last value and tells listeners of each change only", () => {
    const heard = vi.fn();
    const stop = subscribeKioskAsleep(heard);
    expect(isKioskAsleep()).toBe(false);
    setKioskAsleep(true);
    expect(isKioskAsleep()).toBe(true);
    setKioskAsleep(true);
    expect(heard).toHaveBeenCalledTimes(1);
    setKioskAsleep(false);
    expect(isKioskAsleep()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    setKioskAsleep(true);
    expect(heard).toHaveBeenCalledTimes(2);
    setKioskAsleep(false);
  });
});
