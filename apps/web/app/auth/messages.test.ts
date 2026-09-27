import { describe, expect, it } from "vitest";
import {
  forgotPasswordErrorSentence,
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
