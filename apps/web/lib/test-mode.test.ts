import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTestModeAllowed, isTestMode } from "./test-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isTestMode", () => {
  it("is on only for E2E_TEST_MODE=1", () => {
    expect(isTestMode({ E2E_TEST_MODE: "1" })).toBe(true);
    expect(isTestMode({})).toBe(false);
    expect(isTestMode({ E2E_TEST_MODE: "0" })).toBe(false);
    expect(isTestMode({ E2E_TEST_MODE: "true" })).toBe(false);
    expect(isTestMode({ E2E_TEST_MODE: "" })).toBe(false);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    expect(isTestMode()).toBe(true);
    vi.stubEnv("E2E_TEST_MODE", "");
    expect(isTestMode()).toBe(false);
  });
});

describe("assertTestModeAllowed", () => {
  it.each(["production", "preview", "development"])(
    "throws when test mode is on and VERCEL_ENV=%s",
    (vercelEnv) => {
      expect(() =>
        assertTestModeAllowed({ E2E_TEST_MODE: "1", VERCEL_ENV: vercelEnv }),
      ).toThrow(`VERCEL_ENV=${vercelEnv}`);
    },
  );

  it("allows test mode off Vercel", () => {
    expect(() => assertTestModeAllowed({ E2E_TEST_MODE: "1" })).not.toThrow();
    expect(() =>
      assertTestModeAllowed({ E2E_TEST_MODE: "1", VERCEL_ENV: "  " }),
    ).not.toThrow();
  });

  it("allows Vercel without test mode", () => {
    expect(() =>
      assertTestModeAllowed({ VERCEL_ENV: "production" }),
    ).not.toThrow();
    expect(() =>
      assertTestModeAllowed({ E2E_TEST_MODE: "0", VERCEL_ENV: "preview" }),
    ).not.toThrow();
  });

  it("reads process.env by default", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => assertTestModeAllowed()).toThrow(/refuses to boot/);
  });
});
