import { describe, expect, it } from "vitest";
import {
  forgotPasswordErrorSentence,
  PASSKEY_DIDNT_FINISH,
  passkeyErrorSentence,
  twoFactorErrorSentence,
  RESET_LINK_SENT,
  SIGN_IN_REFUSED,
  signInErrorSentence,
  signUpErrorSentence,
  SOMETHING_WENT_WRONG,
  TOO_MANY_ATTEMPTS,
} from "./messages";

describe("signInErrorSentence", () => {
  it("says the same thing for an unknown email and a wrong password", () => {
    expect(
      signInErrorSentence({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }),
    ).toBe(SIGN_IN_REFUSED);
    // Whatever else Better Auth might answer, never anything account-specific.
    expect(
      signInErrorSentence({ status: 403, code: "EMAIL_NOT_VERIFIED" }),
    ).toBe(SIGN_IN_REFUSED);
    expect(signInErrorSentence({ status: 404, code: "USER_NOT_FOUND" })).toBe(
      SIGN_IN_REFUSED,
    );
    expect(SIGN_IN_REFUSED).not.toMatch(/exist|found|registered/i);
  });

  it("says when it is rate limited", () => {
    expect(signInErrorSentence({ status: 429 })).toBe(TOO_MANY_ATTEMPTS);
  });

  it("does not blame the password when the server failed", () => {
    expect(signInErrorSentence({ status: 503 })).toBe(SOMETHING_WENT_WRONG);
    expect(signInErrorSentence({ status: 500 })).toBe(SOMETHING_WENT_WRONG);
    expect(signInErrorSentence({})).toBe(SIGN_IN_REFUSED);
  });
});

describe("signUpErrorSentence", () => {
  it("points an existing address at sign-in", () => {
    expect(
      signUpErrorSentence({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" }),
    ).toMatch(/already an account/);
  });

  it("passes Better Auth's password-length sentence through", () => {
    expect(
      signUpErrorSentence({ code: "PASSWORD_TOO_SHORT", message: "Too short" }),
    ).toBe("Too short");
    expect(signUpErrorSentence({ code: "PASSWORD_TOO_LONG" })).toBe(
      SOMETHING_WENT_WRONG,
    );
  });

  it("falls back to a neutral sentence", () => {
    expect(signUpErrorSentence({ status: 429 })).toBe(TOO_MANY_ATTEMPTS);
    expect(signUpErrorSentence({ status: 500, message: "stack trace" })).toBe(
      SOMETHING_WENT_WRONG,
    );
  });
});

describe("forgot password", () => {
  it("never says whether the account exists", () => {
    expect(RESET_LINK_SENT).toMatch(/^If an account uses that email/);
    expect(forgotPasswordErrorSentence({ status: 429 })).toBe(
      TOO_MANY_ATTEMPTS,
    );
    expect(forgotPasswordErrorSentence({ status: 404 })).toBe(
      SOMETHING_WENT_WRONG,
    );
  });
});

describe("passkeys and two-factor", () => {
  it("says what a passkey failure means without naming an account", () => {
    expect(passkeyErrorSentence({ status: 400 })).toBe(PASSKEY_DIDNT_FINISH);
    expect(passkeyErrorSentence({ status: 429 })).toBe(TOO_MANY_ATTEMPTS);
    expect(passkeyErrorSentence({ status: 500 })).toBe(SOMETHING_WENT_WRONG);
    expect(
      passkeyErrorSentence({ status: 503, code: "PASSKEYS_NOT_CONFIGURED" }),
    ).toMatch(/aren't set up/);
    expect(
      passkeyErrorSentence({ status: 403, code: "EMAIL_NOT_VERIFIED" }),
    ).toMatch(/^Confirm your email first/);
    expect(
      passkeyErrorSentence({ status: 403, code: "SESSION_NOT_FRESH" }),
    ).toMatch(/sign out and in again/);
    expect(PASSKEY_DIDNT_FINISH).not.toMatch(/exist|found|registered/i);
  });

  it("says what a refused code means, for either kind of code", () => {
    expect(twoFactorErrorSentence({ status: 401 }, "totp")).toMatch(
      /newest one/,
    );
    expect(twoFactorErrorSentence({ status: 401 }, "backup")).toMatch(
      /used already/,
    );
    expect(twoFactorErrorSentence({ status: 429 }, "totp")).toBe(
      TOO_MANY_ATTEMPTS,
    );
    expect(
      twoFactorErrorSentence(
        { status: 403, code: "ACCOUNT_TEMPORARILY_LOCKED" },
        "totp",
      ),
    ).toMatch(/15 minutes/);
    expect(
      twoFactorErrorSentence(
        { status: 401, code: "INVALID_TWO_FACTOR_COOKIE" },
        "backup",
      ),
    ).toMatch(/Start again/);
    expect(twoFactorErrorSentence({ status: 502 }, "totp")).toBe(
      SOMETHING_WENT_WRONG,
    );
  });
});
