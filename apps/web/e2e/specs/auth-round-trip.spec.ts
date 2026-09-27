import { expect, test, type Page } from "@playwright/test";
import { PASSWORD_MIN_LENGTH } from "@baumy/auth/password";
import { readMail, waitForAuthMail } from "../lib/mail";

// The real login, end to end, against Docker Postgres (issue #6): sign up,
// sign out, a refused sign-in that says nothing about whether the account
// exists, sign in, a bearer token on GET /api/me, and a password reset whose
// link is read from the e2e mail capture file (nothing is ever sent).

const password = "first-passphrase-".padEnd(PASSWORD_MIN_LENGTH + 2, "x");
const newPassword = "second-passphrase-".padEnd(PASSWORD_MIN_LENGTH + 2, "y");

/** A fresh address per test and project, since the database is shared. */
function freshEmail(project: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `member-${project}-${id}@example.com`;
}

async function signIn(page: Page, email: string, pw: string) {
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pw);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * Signed in, but not in the household: the gate sends a new account to /join
 * (issue #9), which says who is signed in.
 */
async function expectSignedInAs(page: Page, email: string) {
  await expect(page).toHaveURL(/\/join$/);
  await expect(page.getByTestId("signed-in-as")).toHaveText(email);
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ actor: { kind: "member", email } });
}

/** The one neutral refusal. Filtered, because Next's route announcer is an alert too. */
async function expectRefused(page: Page) {
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid email or password." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
}

async function signOut(page: Page) {
  await page.getByRole("link", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect((await page.request.get("/api/me")).status()).toBe(401);
}

test("sign up, sign out, a refused sign-in, sign in, and reset the password", async ({
  page,
}, testInfo) => {
  const email = freshEmail(testInfo.project.name);

  // Signed out, /api/me refuses and home offers sign-in.
  expect((await page.request.get("/api/me")).status()).toBe(401);

  // Sign up: Better Auth signs the new account straight in.
  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expectSignedInAs(page, email);
  const cookies = await page.context().cookies();
  expect(cookies.map((c) => c.name)).toContain("baumy.session_token");

  await signOut(page);

  // A wrong password and an unknown account read exactly the same.
  await signIn(page, email, "not-the-password-at-all");
  await expectRefused(page);
  await signIn(page, freshEmail("nobody"), "not-the-password-at-all");
  await expectRefused(page);
  expect((await page.request.get("/api/me")).status()).toBe(401);

  // The right password gets in.
  await signIn(page, email, password);
  await expectSignedInAs(page, email);
  await signOut(page);

  // Forgot password: the link arrives in the capture file, not an inbox.
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByRole("heading", { name: "Reset link sent" }),
  ).toBeVisible();

  // Better Auth's /api/auth/reset-password/<token> checks the token and
  // redirects to our form with it.
  const link = await waitForAuthMail(email, "reset");
  await page.goto(link);
  await expect(page).toHaveURL(/\/auth\/reset-password\?token=/);
  await page.getByLabel("New password").fill(newPassword);
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password changed" }),
  ).toBeVisible();

  // The old password no longer works; the new one does.
  await signIn(page, email, password);
  await expectRefused(page);
  await signIn(page, email, newPassword);
  await expectSignedInAs(page, email);
});

test("forgot password says the same for an address with no account", async ({
  page,
}, testInfo) => {
  const nobody = freshEmail(`nobody-${testInfo.project.name}`);
  await page.goto("/auth/forgot-password");
  await page.getByLabel("Email").fill(nobody);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "If an account uses that email, we've sent it a link to reset the password.",
  );
  expect((await readMail()).filter((m) => m.to === nobody)).toEqual([]);
});

test("a failed Google round trip lands on sign-in with a sentence", async ({
  page,
}) => {
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: "Google" }),
  ).toHaveCount(0);
  // Where Better Auth's onAPIError.errorURL sends an OAuth failure.
  await page.goto("/auth/sign-in?error=please_restart_the_process");
  await expect(
    page.getByRole("alert").filter({ hasText: "Google didn't finish" }),
  ).toBeVisible();
  await expect(page.getByText("please_restart_the_process")).toHaveCount(0);
});

test("a bearer token from sign-in authenticates GET /api/me without cookies", async ({
  playwright,
  baseURL,
}, testInfo) => {
  const email = freshEmail(`bearer-${testInfo.project.name}`);
  const fresh = () => playwright.request.newContext({ baseURL });

  const signUpCtx = await fresh();
  const signUp = await signUpCtx.post("/api/auth/sign-up/email", {
    data: { email, password, name: email },
  });
  expect(signUp.status()).toBe(200);
  await signUpCtx.dispose();

  // A bare HTTP client with no cookie jar and no Origin, like a native shell.
  // (A request that carries a session cookie but no Origin is refused by
  // Better Auth's CSRF check, which is why this is a fresh context.)
  const native = await fresh();
  const signInRes = await native.post("/api/auth/sign-in/email", {
    data: { email, password },
  });
  expect(signInRes.status()).toBe(200);
  const token = signInRes.headers()["set-auth-token"];
  expect(token).toBeTruthy();
  await native.dispose();

  // Another fresh context, so only the header can authenticate.
  const bare = await fresh();
  const me = await bare.get("/api/me", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(me.status()).toBe(200);
  expect(await me.json()).toMatchObject({ actor: { kind: "member", email } });

  expect((await bare.get("/api/me")).status()).toBe(401);
  const forged = await bare.get("/api/me", {
    headers: { authorization: `Bearer ${token!.split(".")[0]}.forged` },
  });
  expect(forged.status()).toBe(401);
  await bare.dispose();
});
