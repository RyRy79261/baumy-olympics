import { describe, expect, it, vi } from "vitest";
import { isKioskBusy, setKioskBusy, subscribeKioskBusy } from "./busy";

describe("kiosk busy", () => {
  it("is busy while any holder is, and tells listeners of each change", () => {
    const heard = vi.fn();
    const stop = subscribeKioskBusy(heard);
    expect(isKioskBusy()).toBe(false);
    setKioskBusy("cat", true);
    expect(isKioskBusy()).toBe(true);
    setKioskBusy("cat", true);
    expect(heard).toHaveBeenCalledTimes(1);
    setKioskBusy("sheet", true);
    setKioskBusy("cat", false);
    expect(isKioskBusy()).toBe(true);
    setKioskBusy("sheet", false);
    expect(isKioskBusy()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(4);
    stop();
    setKioskBusy("cat", true);
    expect(heard).toHaveBeenCalledTimes(4);
    setKioskBusy("cat", false);
  });
});
