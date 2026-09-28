import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthOptions,
  createAuth,
  getAuth,
  PLACEHOLDER_SECRET,
} from "../config";
import { AUTH_RP_NAME, AUTH_SESSION } from "../env";
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

  it("turns on bearer, two-factor, passkeys, the last-used hint, the guards and Sign in with Baumy", () => {
    expect(options.plugins.map((p) => p.id)).toEqual([
      "bearer",
      "two-factor",
      "passkey",
      "last-login-method",
      "baumy-email-proof",
      "baumy-trusted-devices",
      "baumy-new-way-in",
      "baumy-approval-sign-in",
    ]);
    expect(options.plugins[0]?.options).toEqual({ requireSignature: true });
  });

  it("encrypts backup codes, names the authenticator entry and allows passwordless members", () => {
    const tf = options.plugins.find((p) => p.id === "two-factor")!;
    expect(tf.options).toMatchObject({
      issuer: AUTH_RP_NAME,
      backupCodeOptions: { storeBackupCodes: "encrypted" },
      allowPasswordless: true,
    });
  });

  it("binds passkeys to the base URL's host and origin", () => {
    const pk = buildAuthOptions({
      BETTER_AUTH_URL: "https://olympics.baumy.example",
      PASSKEY_RP_ID: "baumy.example",
    }).plugins.find((p) => p.id === "passkey")!;
    expect(pk.options).toMatchObject({
      rpID: "baumy.example",
      rpName: AUTH_RP_NAME,
      origin: ["https://olympics.baumy.example"],
    });
  });

  it("switches passkeys off, failing closed, when there is no host to bind them to", () => {
    const ids = buildAuthOptions({
      BETTER_AUTH_URL: "https://olympics.baumy.example",
      PASSKEY_RP_ID: "elsewhere.example",
    }).plugins.map((p) => p.id);
    expect(ids).toContain("passkey");
    expect(ids.indexOf("baumy-passkeys-off")).toBeGreaterThan(-1);
    expect(ids.indexOf("baumy-passkeys-off")).toBeLessThan(
      ids.indexOf("baumy-email-proof"),
    );
    expect(options.plugins.map((p) => p.id)).not.toContain(
      "baumy-passkeys-off",
    );
  });

  it("maps the two-factor and passkey tables for the adapter", () => {
    // The drizzle adapter reads its schema map from its closure; building an
    // instance proves the plugins' models resolve (it throws otherwise).
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => createAuth({})).not.toThrow();
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

  it("switches off the endpoints an audited action replaces", () => {
    expect(options.disabledPaths).toEqual([
      "/passkey/delete-passkey",
      "/passkey/update-passkey",
      "/unlink-account",
      "/revoke-session",
      "/revoke-sessions",
      "/revoke-other-sessions",
    ]);
  });

  it("links Google only when the member asks, never on sign-in", () => {
    expect(options.account.accountLinking.disableImplicitLinking).toBe(true);
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
