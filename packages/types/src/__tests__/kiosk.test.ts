import { describe, expect, it } from "vitest";
import {
  KIOSK_DEVICE_NAME_MAX,
  KioskDeviceName,
  KioskPairingCode,
} from "../kiosk";

describe("KioskDeviceName", () => {
  it("trims, and accepts 1 to 40 characters", () => {
    expect(KioskDeviceName.parse("  Kitchen iPad ")).toBe("Kitchen iPad");
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
    expect(KioskPairingCode.parse("abcd-2345")).toBe("ABCD2345");
    expect(KioskPairingCode.parse(" AB CD 23 45 ")).toBe("ABCD2345");
  });

  it("refuses anything but 8 letters and digits", () => {
    for (const bad of ["", "ABCD234", "ABCD23456", "ABCD-23#5", "ÄBCD2345"]) {
      expect(KioskPairingCode.safeParse(bad).success).toBe(false);
    }
    expect(KioskPairingCode.safeParse("abc").error?.issues[0]?.message).toBe(
      "Enter the 8-character code from the admin page.",
    );
  });
});
