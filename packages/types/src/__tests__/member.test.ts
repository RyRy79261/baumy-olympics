import { describe, expect, it } from "vitest";
import {
  AVATAR_SPRITES,
  AvatarSprite,
  DISPLAY_NAME_MAX,
  DisplayName,
  KIOSK_PIN_MAX_DIGITS,
  KIOSK_PIN_MIN_DIGITS,
  DEFAULT_KIOSK_IDLE_MINUTES,
  KIOSK_IDLE_MINUTES_CHOICES,
  KioskIdleMinutes,
  KioskPin,
  MEMBER_COLORS,
  MemberColor,
  MemberRole,
  TelegramLinkCode,
  TelegramUserId,
} from "../member";

describe("DisplayName", () => {
  it("trims, and accepts 1 to 40 characters", () => {
    expect(DisplayName.parse("  Ryan ")).toBe("Ryan");
    expect(DisplayName.parse("x".repeat(DISPLAY_NAME_MAX))).toHaveLength(40);
  });

  it("refuses blank and overlong names", () => {
    expect(DisplayName.safeParse("   ").success).toBe(false);
    expect(
      DisplayName.safeParse("x".repeat(DISPLAY_NAME_MAX + 1)).success,
    ).toBe(false);
  });
});

describe("MemberColor", () => {
  it("lowercases a #rrggbb colour", () => {
    expect(MemberColor.parse("#AABBCC")).toBe("#aabbcc");
  });

  it("refuses anything else", () => {
    for (const bad of ["red", "#abc", "aabbcc", "#gggggg"]) {
      expect(MemberColor.safeParse(bad).success).toBe(false);
    }
  });

  it("offers only valid colours", () => {
    expect(MEMBER_COLORS.length).toBeGreaterThan(0);
    for (const c of MEMBER_COLORS) expect(MemberColor.parse(c)).toBe(c);
  });
});

describe("AvatarSprite and MemberRole", () => {
  it("accept the listed values only", () => {
    for (const s of AVATAR_SPRITES) expect(AvatarSprite.parse(s)).toBe(s);
    expect(AvatarSprite.safeParse("dragon").success).toBe(false);
    expect(MemberRole.parse("admin")).toBe("admin");
    expect(MemberRole.safeParse("owner").success).toBe(false);
  });
});

describe("KioskIdleMinutes (issue #147)", () => {
  it("accepts the kiosk's choices only, the default among them", () => {
    for (const m of KIOSK_IDLE_MINUTES_CHOICES) {
      expect(KioskIdleMinutes.parse(m)).toBe(m);
    }
    expect(KIOSK_IDLE_MINUTES_CHOICES).toContain(DEFAULT_KIOSK_IDLE_MINUTES);
    for (const bad of [0, 3, 2.5, 16, 60, "2"]) {
      expect(KioskIdleMinutes.safeParse(bad).success, String(bad)).toBe(false);
    }
    expect(KioskIdleMinutes.safeParse(3).error?.issues[0]?.message).toBe(
      "Pick 1, 2, 5, 10, 15 minutes.",
    );
  });
});

describe("KioskPin", () => {
  it("accepts 4 to 6 digits", () => {
    for (const pin of ["1234", "12345", "123456"]) {
      expect(KioskPin.parse(pin)).toBe(pin);
    }
  });

  it("takes its length from the digit constants", () => {
    expect(KIOSK_PIN_MIN_DIGITS).toBe(4);
    expect(KIOSK_PIN_MAX_DIGITS).toBe(6);
    expect(KioskPin.safeParse("1".repeat(KIOSK_PIN_MIN_DIGITS)).success).toBe(
      true,
    );
    expect(KioskPin.safeParse("1".repeat(KIOSK_PIN_MAX_DIGITS)).success).toBe(
      true,
    );
    expect(KioskPin.safeParse("12").error?.issues[0]?.message).toBe(
      "Use 4 to 6 digits.",
    );
  });

  it("refuses short, long and non-digit PINs", () => {
    for (const pin of ["123", "1234567", "12a4", " 1234", ""]) {
      expect(KioskPin.safeParse(pin).success).toBe(false);
    }
  });
});

describe("TelegramUserId", () => {
  it("takes a positive integer, as a number or as digits", () => {
    expect(TelegramUserId.parse(123456789)).toBe(123456789);
    expect(TelegramUserId.parse(" 5000000001 ")).toBe(5000000001);
    expect(TelegramUserId.parse(String(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("refuses anything else", () => {
    for (const bad of [
      0,
      -5,
      1.5,
      "",
      "0",
      "012",
      "12a",
      "1e5",
      "-1",
      "99999999999999999",
      Number.MAX_SAFE_INTEGER + 1,
      null,
    ]) {
      expect(TelegramUserId.safeParse(bad).success).toBe(false);
    }
  });
});

describe("TelegramLinkCode", () => {
  it("trims a code of letters and digits", () => {
    expect(TelegramLinkCode.parse(" AB12cd34EF ")).toBe("AB12cd34EF");
  });

  it("refuses short, long and odd codes", () => {
    for (const bad of ["ABC1234", "A".repeat(33), "AB12-CD34", "AB12 CD34"]) {
      expect(TelegramLinkCode.safeParse(bad).success).toBe(false);
    }
  });
});
