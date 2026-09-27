import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthOptions,
  createAuth,
  getAuth,
  PLACEHOLDER_SECRET,
} from "../config";
import { AUTH_SESSION } from "../env";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../password";

// The options that make this login safe. Each is a line someone could delete
// without any other test noticing.

describe("buildAuthOptions", () => {
  const options = buildAuthOptions({});

  it("enforces the forms' password rule on the server", () => {
    expect(options.emailAndPassword.minPasswordLength).toBe(
      PASSWORD_MIN_LENGTH,
    );
    expect(options.emailAndPassword.maxPasswordLength).toBe(
      PASSWORD_MAX_LENGTH,
    );
  });

  it("signs every device out on a password reset", () => {
    expect(options.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
  });

  it("keeps the change-email endpoint unmounted", () => {
    expect(options.user.changeEmail.enabled).toBe(false);
  });

  it("keeps sessions for 30 days, refreshed daily, with a 300s cookie cache", () => {
    expect(options.session).toEqual({
      expiresIn: AUTH_SESSION.expiresInSeconds,
      updateAge: AUTH_SESSION.updateAgeSeconds,
      cookieCache: { enabled: true, maxAge: 300 },
    });
  });

  it("stores rate-limit counters in the database, shared by every instance", () => {
    expect(options.rateLimit.storage).toBe("database");
    expect(options.rateLimit.modelName).toBe("rateLimit");
  });

  it("turns the bearer plugin on, and only it", () => {
    expect(options.plugins.map((p) => p.id)).toEqual(["bearer"]);
    expect(options.plugins[0]?.options).toEqual({ requireSignature: true });
  });

  it("names cookies baumy.* and sends no telemetry", () => {
    expect(options.advanced.cookiePrefix).toBe("baumy");
    expect(options.telemetry.enabled).toBe(false);
  });

  it("offers Google only when both keys are set", () => {
    expect("socialProviders" in options).toBe(false);
    const withGoogle = buildAuthOptions({
      GOOGLE_CLIENT_ID: " id ",
      GOOGLE_CLIENT_SECRET: " s ",
    });
    expect(
      "socialProviders" in withGoogle && withGoogle.socialProviders?.google,
    ).toEqual({ clientId: "id", clientSecret: "s" });
    expect(
      "socialProviders" in buildAuthOptions({ GOOGLE_CLIENT_ID: "id" }),
    ).toBe(false);
  });

  it("never links Google to an account whose email is unconfirmed", () => {
    // Better Auth refuses such a link unless this is set to false.
    const linking: { enabled?: boolean; requireLocalEmailVerified?: boolean } =
      options.account.accountLinking;
    expect(linking.requireLocalEmailVerified).not.toBe(false);
    expect(linking.enabled).toBe(true);
  });

  it("sends an OAuth failure to our sign-in form", () => {
    expect(options.onAPIError.errorURL).toBe("/auth/sign-in");
  });

  it("sends a verification mail on sign-up only when one can be delivered", () => {
    expect(options.emailVerification.sendOnSignUp).toBe(false);
    expect(
      buildAuthOptions({ RESEND_API_KEY: "k", RESEND_FROM_EMAIL: "f" })
        .emailVerification.sendOnSignUp,
    ).toBe(true);
  });

  it("signs with the real secret when set, and the placeholder otherwise", () => {
    expect(options.secret).toBe(PLACEHOLDER_SECRET);
    expect(PLACEHOLDER_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(buildAuthOptions({ BETTER_AUTH_SECRET: " real " }).secret).toBe(
      "real",
    );
  });

  it("takes the base URL, origins and secure-cookie flag from the env", () => {
    const local = buildAuthOptions({
      BETTER_AUTH_URL: "http://localhost:3000",
    });
    expect(local.baseURL).toBe("http://localhost:3000");
    expect(local.trustedOrigins).toEqual(["http://localhost:3000"]);
    expect(local.advanced.useSecureCookies).toBe(false);
    expect("baseURL" in options).toBe(false);
    expect("useSecureCookies" in options.advanced).toBe(false);
  });
});

describe("createAuth and getAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the config warnings once, when an instance is built", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createAuth({ VERCEL_ENV: "preview" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fail closed"));
  });

  it("builds the app's instance on first use and reuses it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = getAuth();
    expect(getAuth()).toBe(first);
    expect(typeof first.handler).toBe("function");
  });
});
