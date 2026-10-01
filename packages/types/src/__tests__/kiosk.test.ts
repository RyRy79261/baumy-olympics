import { describe, expect, it } from "vitest";
import {
  KIOSK_DEVICE_NAME_MAX,
  KioskDeviceName,
  KioskPairingCode,
} from "../kiosk";

describe("KioskDeviceName", () => {
  it("trims, and accepts 1 to 40 characters", () => {
    expect(KioskDeviceName.parse("  Kitchen ")).toBe("Kitchen");
    expect(
      KioskDeviceName.safeParse("x".repeat(KIOSK_DEVICE_NAME_MAX)).success,
    ).toBe(true);
    expect(
      KioskDeviceName.safeParse("x".repeat(KIOSK_DEVICE_NAME_MAX + 1)).success,
    ).toBe(false);
    expect(KioskDeviceName.safeParse("  ").success).toBe(false);
  });
});

describe("KioskPairingCode", () => {
  it("ignores case, spaces and dashes", () => {
    expect(KioskPairingCode.parse("abc-234")).toBe("ABC234");
    expect(KioskPairingCode.parse(" AB C2 34 ")).toBe("ABC234");
  });

  it("refuses anything but 6 letters and digits", () => {
    for (const bad of ["", "ABC23", "ABC2345", "ABC-2#4", "ÄBC234"]) {
      expect(KioskPairingCode.safeParse(bad).success).toBe(false);
    }
    expect(KioskPairingCode.safeParse("abc").error?.issues[0]?.message).toBe(
      "Enter the 6-character code shown on the iPad.",
    );
  });
});
