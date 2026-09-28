import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { PASSWORD, freshEmail, signIn, signUp } from "../lib/accounts";
import { founderAdmin, mintCode, redeem } from "../lib/household";
import { waitForAuthMail, waitForNotice } from "../lib/mail";
import { totp } from "../lib/totp";

// Settings, Security (issue #79): two-factor, passkeys, the last-used hint
// on sign-in and signing other devices out, each through the real pages
// against Docker Postgres. Passkeys use Chromium's virtual authenticator
// (CDP WebAuthn); two-factor codes are computed from the setup key the page
// shows, as an authenticator app would.

/** A new housemate with a confirmed email, signed in on their own browser. */
async function confirmedMember(
  founder: Page,
  browser: Browser,
  project: string,
  label: string,
): Promise<{ context: BrowserContext; page: Page; email: string }> {
  await founderAdmin(founder, project);
  const code = await mintCode(founder, 1);
  const email = freshEmail(`${label}-${project}`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, email);
  await page.waitForURL(/\/join$/);
  // The link sent on sign-up, read from the e2e capture file.
  await page.goto(await waitForAuthMail(email, "verify"));
  await page.goto("/join");
  await joinWith(page, code, `${label} ${project}`);
  return { context, page, email };
}

/**
 * Redeem an invite, waiting out redeem_invite's per-IP limit: every spec in
 * the suite joins from the same address, so late in a run the bucket can be
 * empty for a few seconds ("Too many tries. Wait 2s and try again.").
 */
async function joinWith(page: Page, code: string, name: string) {
  const limited = page
    .getByRole("alert")
    .filter({ hasText: /Too many tries\. Wait \d+s/ });
  for (let attempt = 0; attempt < 5; attempt++) {
    await redeem(page, code, name);
    const joined = page
      .waitForURL((url) => url.pathname === "/")
      .then(() => "in" as const);
    const refused = limited.waitFor().then(() => "limited" as const);
    // The loser keeps waiting and rejects later (at its timeout, or when the
    // page closes); give it a handler so that is not an unhandled rejection.
    joined.catch(() => {});
    refused.catch(() => {});
    const outcome = await Promise.race([joined, refused]);
    if (outcome === "in") return;
    const text = (await limited.textContent()) ?? "";
    const seconds = Number(/Wait (\d+)s/.exec(text)?.[1] ?? 5);
    await page.waitForTimeout((seconds + 1) * 1000);
    await page.goto("/join");
  }
  await expect(page).toHaveURL(/\/$/);
}

async function openSecurity(page: Page) {
  await page.goto("/settings/security");
  await expect(
    page.getByRole("heading", { name: "Security", level: 1 }),
  ).toBeVisible();
}

async function signOut(page: Page) {
  await page.goto("/auth/sign-out");
  await page.waitForURL(/\/auth\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

test("two-factor: turn it on, then sign in with a code and with a backup code", async ({
  page,
  browser,
}, testInfo) => {
  const { page: p, email } = await confirmedMember(
    page,
    browser,
    testInfo.project.name,
    "twofa",
  );
  await openSecurity(p);
  const card = p.getByTestId("two-factor-card");
  await expect(card).toContainText("Off");

  await card.getByRole("button", { name: "Turn on two-factor" }).click();
  await card.getByLabel("Your password").fill(PASSWORD);
  await card.getByRole("button", { name: "Continue" }).click();
  await expect(
    card.getByRole("img", { name: "QR code for your authenticator app" }),
  ).toBeVisible();
  const secret = (await card.getByTestId("totp-secret").textContent())!;
  expect(secret.replace(/\s/g, "")).toMatch(/^[A-Z2-7]{16,}$/);

  // A wrong code is refused and nothing turns on.
  const right = totp(secret);
  await card
    .getByLabel("6-digit code")
    .fill(right === "000000" ? "111111" : "000000");
  await card.getByRole("button", { name: "Verify and turn on" }).click();
  await expect(card.getByRole("alert")).toContainText("didn't match");

  await card.getByLabel("6-digit code").fill(totp(secret));
  await card.getByRole("button", { name: "Verify and turn on" }).click();
  const codes = card.getByRole("list", { name: "Backup codes" });
  await expect(codes.getByRole("listitem").first()).toBeVisible();
  const backup = (await codes.getByRole("listitem").first().textContent())!;
  await card.getByRole("button", { name: /I.ve saved them/ }).click();
  await expect(card).toContainText("On");

  // A password alone no longer signs in: the form asks for the code.
  await signOut(p);
  await signIn(p, email);
  await expect(p.getByRole("heading", { name: "One more step" })).toBeVisible();
  await p.getByLabel("6-digit code").fill(totp(secret));
  await p.getByRole("button", { name: "Verify" }).click();
  await expect(p).toHaveURL(/\/$/);

  // The code step finished an email sign-in, and sign-in says so next time.
  await signOut(p);
  await expect(p.getByTestId("last-used")).toHaveText(
    "Last used: email and password",
  );

  // Lost phone: a backup code works once.
  await signIn(p, email);
  await p
    .getByRole("button", { name: "Lost your phone? Use a backup code" })
    .click();
  await p.getByLabel("Backup code").fill(backup.trim());
  await p.getByRole("button", { name: "Verify" }).click();
  await expect(p).toHaveURL(/\/$/);
  await signOut(p);
  await signIn(p, email);
  await p
    .getByRole("button", { name: "Lost your phone? Use a backup code" })
    .click();
  await p.getByLabel("Backup code").fill(backup.trim());
  await p.getByRole("button", { name: "Verify" }).click();
  await expect(
    p.getByRole("alert").filter({ hasText: "used already" }),
  ).toBeVisible();
  expect((await p.request.get("/api/me")).status()).toBe(401);
});

test("passkeys: add, rename, sign in with one, and remove it", async ({
  page,
  browser,
}, testInfo) => {
  const { page: p, email } = await confirmedMember(
    page,
    browser,
    testInfo.project.name,
    "passkey",
  );
  // Chromium's virtual authenticator: a platform authenticator that holds
  // discoverable credentials and always verifies the user.
  const cdp = await p.context().newCDPSession(p);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await openSecurity(p);
  const card = p.getByTestId("passkeys-card");
  await expect(card).toContainText("None yet");
  await card.getByRole("button", { name: "Add a passkey" }).click();
  await card.getByLabel("Name this passkey").fill("Test key");
  await card.getByRole("button", { name: "Create passkey" }).click();
  await expect(
    p.getByRole("status").filter({ hasText: "Passkey added." }),
  ).toBeVisible();
  const row = card.getByTestId("passkey-row");
  await expect(row).toContainText("Test key");
  await expect(card).toContainText("1 set up");
  // A new way in is announced to the owner.
  await waitForNotice(email, "passkey-added");

  await row.getByRole("button", { name: "Rename" }).click();
  await row.getByLabel("Passkey name").fill("Kitchen laptop");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(row).toContainText("Kitchen laptop");

  // Signed out, the passkey alone signs in: no email, no password.
  await signOut(p);
  await p.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(p).toHaveURL(/\/$/);
  await signOut(p);
  await expect(p.getByTestId("last-used")).toHaveText("Last used");
  await expect(
    p
      .getByTestId("last-used")
      .locator("..")
      .getByRole("button", { name: "Sign in with a passkey" }),
  ).toBeVisible();

  // The password is still a way in, so the passkey may go.
  await signIn(p, email);
  await expect(p).toHaveURL(/\/$/);
  await openSecurity(p);
  await card.getByRole("button", { name: "Remove Kitchen laptop" }).click();
  // A destructive change asks first; keeping it changes nothing.
  await card.getByRole("button", { name: "Keep it" }).click();
  await expect(card.getByTestId("passkey-row")).toContainText("Kitchen laptop");
  await card.getByRole("button", { name: "Remove Kitchen laptop" }).click();
  await card.getByRole("button", { name: "Yes, remove it" }).click();
  await expect(
    p.getByRole("status").filter({ hasText: "Passkey removed." }),
  ).toBeVisible();
  await expect(card).toContainText("None yet");
  await expect(card.getByTestId("passkey-row")).toHaveCount(0);
});

test("devices: this device is marked, and other devices can be signed out", async ({
  page,
  browser,
}, testInfo) => {
  const { page: p, email } = await confirmedMember(
    page,
    browser,
    testInfo.project.name,
    "devices",
  );
  // Two more browsers signed in as the same member.
  const others = await Promise.all(
    [1, 2].map(async () => {
      const context = await browser.newContext();
      const other = await context.newPage();
      await signIn(other, email);
      await expect(other).toHaveURL(/\/$/);
      return { context, page: other };
    }),
  );

  await openSecurity(p);
  const card = p.getByTestId("devices-card");
  await expect(card.getByTestId("session-row")).toHaveCount(3);
  await expect(card.getByTestId("session-row").first()).toContainText(
    "This device",
  );
  await expect(card.getByTestId("revocation-lag")).toContainText("5 minutes");

  // Sign one out. Its cached cookie can keep it going for up to 5 minutes;
  // without the cache, the server refuses it at once.
  const [first, second] = others;
  await card
    .getByTestId("session-row")
    .nth(1)
    .getByRole("button", { name: /^Sign out / })
    .click();
  await expect(
    p.getByRole("status").filter({ hasText: "is signed out." }),
  ).toBeVisible();
  await expect(card.getByTestId("session-row")).toHaveCount(2);

  // Then every other device.
  await card
    .getByRole("button", { name: "Sign out every other device" })
    .click();
  await expect(
    p.getByRole("status").filter({ hasText: "1 other device is signed out." }),
  ).toBeVisible();
  await expect(card.getByTestId("session-row")).toHaveCount(1);

  for (const other of [first!, second!]) {
    // Present before absent: the cookie cache is there, then it is dropped.
    const jar = await other.context.cookies();
    expect(jar.map((c) => c.name)).toContain("baumy.session_data");
    await other.context.clearCookies({ name: "baumy.session_data" });
    expect((await other.page.request.get("/api/me")).status()).toBe(401);
    await other.context.close();
  }
  // This device is still signed in.
  expect((await p.request.get("/api/me")).status()).toBe(200);
});

test("an unconfirmed email cannot add a passkey or two-factor", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  await founderAdmin(page, project);
  const code = await mintCode(page, 1);
  const context = await browser.newContext();
  const p = await context.newPage();
  await signUp(p, freshEmail(`unconfirmed-${project}`));
  await p.waitForURL(/\/join$/);
  await joinWith(p, code, `Unconfirmed ${project}`);
  await expect(p).toHaveURL(/\/$/);

  await openSecurity(p);
  await expect(
    p.getByRole("heading", { name: "Confirm your email" }),
  ).toBeVisible();
  await expect(
    p
      .getByTestId("two-factor-card")
      .getByRole("button", { name: "Turn on two-factor" }),
  ).toBeDisabled();
  await expect(
    p
      .getByTestId("passkeys-card")
      .getByRole("button", { name: "Add a passkey" }),
  ).toBeDisabled();
  // And the server refuses it too, whatever the page shows.
  const res = await p.request.post("/api/auth/two-factor/enable", {
    data: { password: PASSWORD },
    headers: { origin: new URL(p.url()).origin },
  });
  expect(res.status()).toBe(403);
  expect(await res.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
  await context.close();
});
