import { describe, expect, it } from "vitest";
import {
  LOGIN_CODE_MAX,
  LOGIN_CODE_MIN,
  LoginApprovalStart,
  LoginCode,
  LoginRequestId,
} from "../login";

describe("LoginCode", () => {
  it("takes two-digit integers only", () => {
    expect(LoginCode.parse(LOGIN_CODE_MIN)).toBe(10);
    expect(LoginCode.parse(LOGIN_CODE_MAX)).toBe(99);
    for (const bad of [9, 100, 12.5, "47", null]) {
      expect(LoginCode.safeParse(bad).success).toBe(false);
    }
  });
});

describe("LoginRequestId", () => {
  it("is a uuid", () => {
    expect(
      LoginRequestId.safeParse("0b0e6c1a-3a7e-4c38-9a53-6f1f3f0d2a11").success,
    ).toBe(true);
    expect(LoginRequestId.safeParse("req-1").success).toBe(false);
  });
});

describe("LoginApprovalStart", () => {
  it("trims the email and refuses anything else", () => {
    expect(LoginApprovalStart.parse({ email: " a@b.io " })).toEqual({
      email: "a@b.io",
    });
    expect(LoginApprovalStart.safeParse({ email: "" }).success).toBe(false);
    expect(LoginApprovalStart.safeParse({ email: "nope" }).success).toBe(false);
    expect(
      LoginApprovalStart.safeParse({ email: "a@b.io", extra: 1 }).success,
    ).toBe(false);
  });
});
