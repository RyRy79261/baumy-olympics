import { describe, expect, it } from "vitest";
import {
  AUTH_SESSION,
  authConfigWarnings,
  authMayServe,
  canDeliverAuthEmail,
  isAuthConfigured,
  isEmailProviderConfigured,
  isGoogleConfigured,
  resolveAuthEmailCaptureFile,
  resolveBaseURL,
  resolveRateLimit,
  resolveTrustedOrigins,
  resolveUseSecureCookies,
  SENSITIVE_AUTH_PATHS,
} from "../env";

const SECRET = "a-real-secret-that-is-long-enough-0123456789";

describe("AUTH_SESSION", () => {
  it("lasts 30 days, refreshes daily and caches the cookie for 5 minutes", () => {
    expect(AUTH_SESSION).toEqual({
      expiresInSeconds: 30 * 24 * 60 * 60,
      updateAgeSeconds: 24 * 60 * 60,
      cookieCacheMaxAgeSeconds: 300,
    });
  });
});

describe("isAuthConfigured", () => {
  it("needs a non-blank secret", () => {
    expect(isAuthConfigured({ BETTER_AUTH_SECRET: SECRET })).toBe(true);
    expect(isAuthConfigured({})).toBe(false);
    expect(isAuthConfigured({ BETTER_AUTH_SECRET: "   " })).toBe(false);
  });
});

describe("authMayServe", () => {
  it("serves with a real secret, on Vercel or off it", () => {
    expect(authMayServe({ BETTER_AUTH_SECRET: SECRET })).toBe(true);
    for (const VERCEL_ENV of ["production", "preview", "development"]) {
      expect(authMayServe({ BETTER_AUTH_SECRET: SECRET, VERCEL_ENV })).toBe(
        true,
      );
    }
  });

  it("serves off Vercel without a secret (local dev, CI, e2e)", () => {
    expect(authMayServe({})).toBe(true);
    expect(authMayServe({ VERCEL_ENV: "" })).toBe(true);
    expect(authMayServe({ VERCEL_ENV: "  " })).toBe(true);
  });

  it("fails closed on every Vercel environment without a secret", () => {
    for (const VERCEL_ENV of ["production", "preview", "development"]) {
      expect(authMayServe({ VERCEL_ENV })).toBe(false);
      expect(authMayServe({ VERCEL_ENV, BETTER_AUTH_SECRET: " " })).toBe(false);
    }
  });
});

describe("email delivery", () => {
  it("needs both the Resend key and the sender", () => {
    expect(
      isEmailProviderConfigured({
        RESEND_API_KEY: "re_x",
        RESEND_FROM_EMAIL: "Baumy <hi@example.com>",
      }),
    ).toBe(true);
    expect(isEmailProviderConfigured({ RESEND_API_KEY: "re_x" })).toBe(false);
    expect(isEmailProviderConfigured({ RESEND_FROM_EMAIL: "hi@x" })).toBe(
      false,
    );
    expect(isEmailProviderConfigured({})).toBe(false);
  });

  it("captures to a file only in e2e test mode and off Vercel", () => {
    const e2e = { E2E_TEST_MODE: "1", AUTH_EMAIL_CAPTURE_FILE: " /tmp/m " };
    expect(resolveAuthEmailCaptureFile(e2e)).toBe("/tmp/m");
    expect(
      resolveAuthEmailCaptureFile({ ...e2e, E2E_TEST_MODE: undefined }),
    ).toBeUndefined();
    expect(
      resolveAuthEmailCaptureFile({ ...e2e, E2E_TEST_MODE: "true" }),
    ).toBeUndefined();
    expect(
      resolveAuthEmailCaptureFile({ ...e2e, VERCEL_ENV: "preview" }),
    ).toBeUndefined();
    expect(resolveAuthEmailCaptureFile({ E2E_TEST_MODE: "1" })).toBeUndefined();
  });

  it("can deliver through a provider or the capture file, and nothing else", () => {
    expect(
      canDeliverAuthEmail({ RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "f" }),
    ).toBe(true);
    expect(
      canDeliverAuthEmail({ E2E_TEST_MODE: "1", AUTH_EMAIL_CAPTURE_FILE: "f" }),
    ).toBe(true);
    expect(canDeliverAuthEmail({ AUTH_EMAIL_CAPTURE_FILE: "f" })).toBe(false);
    expect(canDeliverAuthEmail({})).toBe(false);
  });
});

describe("isGoogleConfigured", () => {
  it("needs both the client id and the secret", () => {
    expect(
      isGoogleConfigured({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }),
    ).toBe(true);
    expect(isGoogleConfigured({ GOOGLE_CLIENT_ID: "id" })).toBe(false);
    expect(isGoogleConfigured({ GOOGLE_CLIENT_SECRET: "s" })).toBe(false);
    expect(
      isGoogleConfigured({ GOOGLE_CLIENT_ID: " ", GOOGLE_CLIENT_SECRET: "s" }),
    ).toBe(false);
  });
});

describe("resolveBaseURL", () => {
  it("prefers the explicit value", () => {
    expect(
      resolveBaseURL({
        BETTER_AUTH_URL: " https://baumy.example ",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "baumy.vercel.app",
      }),
    ).toBe("https://baumy.example");
  });

  it("uses the production host in production, not the deployment host", () => {
    expect(
      resolveBaseURL({
        VERCEL_ENV: "production",
        VERCEL_URL: "baumy-abc123.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "baumy.vercel.app",
      }),
    ).toBe("https://baumy.vercel.app");
    expect(
      resolveBaseURL({
        VERCEL_ENV: "production",
        VERCEL_URL: "baumy-abc123.vercel.app",
      }),
    ).toBe("https://baumy-abc123.vercel.app");
  });

  it("uses a preview's own host", () => {
    expect(
      resolveBaseURL({
        VERCEL_ENV: "preview",
        VERCEL_URL: "baumy-xyz.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "baumy.vercel.app",
      }),
    ).toBe("https://baumy-xyz.vercel.app");
  });

  it("is undefined locally, so Better Auth reads the request's host", () => {
    expect(resolveBaseURL({})).toBeUndefined();
  });
});

describe("resolveUseSecureCookies", () => {
  it("keeps Better Auth's default for https and when unknown", () => {
    expect(
      resolveUseSecureCookies({ BETTER_AUTH_URL: "https://b.example" }),
    ).toBeUndefined();
    expect(resolveUseSecureCookies({})).toBeUndefined();
  });

  it("turns Secure off only for an explicit http origin", () => {
    expect(
      resolveUseSecureCookies({ BETTER_AUTH_URL: "http://localhost:3000" }),
    ).toBe(false);
  });
});

describe("resolveRateLimit", () => {
  it("keeps Better Auth's defaults when unset or invalid", () => {
    expect(resolveRateLimit({})).toEqual({});
    expect(
      resolveRateLimit({
        AUTH_RATE_LIMIT_WINDOW_SECONDS: "soon",
        AUTH_RATE_LIMIT_MAX: "-3",
      }),
    ).toEqual({});
    expect(resolveRateLimit({ AUTH_RATE_LIMIT_MAX: "0" })).toEqual({});
  });

  it("raises the global and the sensitive-path limits together", () => {
    const out = resolveRateLimit({
      AUTH_RATE_LIMIT_WINDOW_SECONDS: "30",
      AUTH_RATE_LIMIT_MAX: "500",
    });
    expect(out.window).toBe(30);
    expect(out.max).toBe(500);
    expect(Object.keys(out.customRules ?? {}).sort()).toEqual(
      [...SENSITIVE_AUTH_PATHS].sort(),
    );
    for (const rule of Object.values(out.customRules ?? {})) {
      expect(rule).toEqual({ window: 30, max: 500 });
    }
  });

  it("gives the sensitive paths a 60s window when only max is set", () => {
    const out = resolveRateLimit({ AUTH_RATE_LIMIT_MAX: "50" });
    expect(out.window).toBeUndefined();
    expect(out.customRules?.["/sign-in/email"]).toEqual({
      window: 60,
      max: 50,
    });
  });

  it("changes only the window when only the window is set", () => {
    expect(resolveRateLimit({ AUTH_RATE_LIMIT_WINDOW_SECONDS: "20" })).toEqual({
      window: 20,
    });
  });
});

describe("resolveTrustedOrigins", () => {
  it("lists every absolute origin this deployment is served on", () => {
    expect(
      resolveTrustedOrigins({
        BETTER_AUTH_URL: "https://baumy.example/some/path",
        VERCEL_URL: "baumy-abc.vercel.app",
        VERCEL_BRANCH_URL: "baumy-git-main.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL: "baumy.vercel.app",
      }).sort(),
    ).toEqual(
      [
        "https://baumy.example",
        "https://baumy-abc.vercel.app",
        "https://baumy-git-main.vercel.app",
        "https://baumy.vercel.app",
      ].sort(),
    );
  });

  it("never contains a wildcard, a duplicate or a non-http origin", () => {
    const origins = resolveTrustedOrigins({
      BETTER_AUTH_URL: "https://baumy.example",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "baumy.example",
    });
    expect(origins).toEqual(["https://baumy.example"]);
    expect(
      resolveTrustedOrigins({ BETTER_AUTH_URL: "javascript:alert(1)" }),
    ).toEqual([]);
    expect(resolveTrustedOrigins({ BETTER_AUTH_URL: "not a url" })).toEqual([]);
    expect(resolveTrustedOrigins({ VERCEL_URL: "*.vercel.app" })).toEqual([]);
  });

  it("is empty locally", () => {
    expect(resolveTrustedOrigins({})).toEqual([]);
  });
});

describe("authConfigWarnings", () => {
  it("warns about the placeholder locally and about the closed door on Vercel", () => {
    expect(authConfigWarnings({})).toEqual([
      expect.stringContaining("public placeholder"),
    ]);
    expect(authConfigWarnings({ VERCEL_ENV: "preview" })).toEqual([
      expect.stringContaining("fail closed"),
    ]);
  });

  it("warns when a configured stack cannot deliver a reset link", () => {
    expect(authConfigWarnings({ BETTER_AUTH_SECRET: SECRET })).toEqual([
      expect.stringContaining("RESEND_API_KEY"),
    ]);
  });

  it("warns in production without BETTER_AUTH_URL", () => {
    const warnings = authConfigWarnings({
      BETTER_AUTH_SECRET: SECRET,
      RESEND_API_KEY: "k",
      RESEND_FROM_EMAIL: "f",
      VERCEL_ENV: "production",
    });
    expect(warnings).toEqual([expect.stringContaining("BETTER_AUTH_URL")]);
    expect(
      authConfigWarnings({
        BETTER_AUTH_SECRET: SECRET,
        RESEND_API_KEY: "k",
        RESEND_FROM_EMAIL: "f",
        NODE_ENV: "production",
      }),
    ).toHaveLength(1);
  });

  it("is quiet when everything is set", () => {
    expect(
      authConfigWarnings({
        BETTER_AUTH_SECRET: SECRET,
        BETTER_AUTH_URL: "https://baumy.example",
        RESEND_API_KEY: "k",
        RESEND_FROM_EMAIL: "f",
        VERCEL_ENV: "production",
      }),
    ).toEqual([]);
  });
});
