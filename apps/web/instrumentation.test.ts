import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrumentation register()", () => {
  it("refuses to boot with E2E_TEST_MODE=1 on Vercel", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => register()).toThrow(/refuses to boot/);
  });

  it("boots in test mode off Vercel", () => {
    vi.stubEnv("E2E_TEST_MODE", "1");
    vi.stubEnv("VERCEL_ENV", "");
    expect(() => register()).not.toThrow();
  });
});
