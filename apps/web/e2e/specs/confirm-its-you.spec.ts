import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { PASSWORD, freshEmail, signUp } from "../lib/accounts";
import { advanceClock, resetClock } from "../lib/clock";
import { founderAdmin, redeem } from "../lib/household";
import { waitForAuthMail } from "../lib/mail";
import { totp } from "../lib/totp";

// "Confirm it's you" (issue #135), GitHub's sudo mode: creating a service
// token on /admin/connections asks for any way in the admin has, through one
// dialog, and a success lets the next sensitive change through for 10
// minutes without asking again. A sign-in under 10 minutes old counts too,
// so each spec first moves the SERVER clock past it; that clock is shared, so
// this file runs in the server-clock project (playwright.config.ts
// SHARED_CLOCK_SPECS) and puts the clock back afterwards.

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

const PAST_WINDOW = 11 * 60_000;
const rand = () => Math.random().toString(36).slice(2, 8);
/** A Telegram user id nobody else in this run uses. */
const tgId = () => 8_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

function dialog(page: Page) {
  return page.getByRole("dialog", { name: "Confirm it's you" });
}

/** Press Create token for `name` on /admin/connections. */
async function createToken(page: Page, name: string) {
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create token" }),
  });
  await form.getByLabel("Name").fill(name);
  await form.getByRole("button", { name: "Create token" }).click();
}

/** The token for `name` was shown once, and is listed as live. */
async function tokenShown(page: Page, name: string) {
  await expect(page.getByTestId("service-token-shown")).toContainText(name);
  await expect(page.getByTestId("service-token-plaintext")).toHaveText(
    /^baumy_st_/,
  );
  await expect(page.getByTestId(`service-token-${name}-live`)).toBeVisible();
}

async function openConnections(page: Page) {
  await page.goto("/admin/connections");
  await expect(
    page.getByRole("heading", { name: "Connections", level: 1 }),
  ).toBeVisible();
}

test("the password confirms it, the window skips the next prompt, then it closes", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  // A sign-in under 10 minutes old is proof enough: move past it.
  await advanceClock(page, PAST_WINDOW);
  await openConnections(page);

  const first = `e2e-sudo-${rand()}`;
  await createToken(page, first);
  const ask = dialog(page);
  await expect(ask).toBeVisible();
  // The founder has a password and nothing else here: only it is offered.
  await expect(ask.getByLabel("Your password")).toBeVisible();
  await expect(ask.getByRole("button", { name: "Use a passkey" })).toHaveCount(
    0,
  );
  await expect(ask.getByLabel("6-digit code")).toHaveCount(0);

  await ask.getByLabel("Your password").fill("not-the-password-at-all");
  await ask.getByRole("button", { name: "Confirm with password" }).click();
  await expect(ask.getByText("That password is not right.")).toBeVisible();
  await expect(page.getByTestId(`service-token-${first}-live`)).toHaveCount(0);

  await ask.getByLabel("Your password").fill(PASSWORD);
  await ask.getByRole("button", { name: "Confirm with password" }).click();
  await expect(ask).toBeHidden();
  await tokenShown(page, first);

  // Within the window: no prompt at all.
  const second = `e2e-sudo-${rand()}`;
  await createToken(page, second);
  await tokenShown(page, second);
  await expect(dialog(page)).toBeHidden();

  // Revoking is sensitive too, and the window still covers it.
  const live = page.getByTestId(`service-token-${second}-live`);
  await live.getByRole("button", { name: `Revoke ${second}` }).click();
  await live.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `${second} is revoked.` }),
  ).toBeVisible();
  await expect(dialog(page)).toBeHidden();

  // Ten minutes on (server time), it asks again; cancelling changes nothing.
  await advanceClock(page, PAST_WINDOW);
  const third = `e2e-sudo-${rand()}`;
  await createToken(page, third);
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(
    page.getByRole("alert").filter({ hasText: "Confirm it's you first" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId(`service-token-${first}-live`)).toBeVisible();
  await expect(page.getByTestId(`service-token-${third}-live`)).toHaveCount(0);
});

/** An admin invite code, minted by the founder on /admin/members. */
async function adminCode(founder: Page): Promise<string> {
  await founder.goto("/admin/members");
  const form = founder.locator("form").filter({
    has: founder.getByRole("button", { name: "Create invite code" }),
  });
  await form.getByLabel("Uses").fill("1");
  await form.getByLabel("Role").selectOption("admin");
  await form.getByRole("button", { name: "Create invite code" }).click();
  const code = (await founder.getByTestId("minted-code").textContent())!;
  return code.trim();
}

/**
 * A second admin with every way in: a password, a passkey (Chromium's
 * virtual authenticator), two-factor and a linked Telegram account.
 */
async function adminWithEverything(
  founder: Page,
  browser: Browser,
  project: string,
) {
  await founderAdmin(founder, project);
  const code = await adminCode(founder);
  const email = freshEmail(`sudo-${project}`);
  const name = `Sudo ${rand()}`;
  const context = await browser.newContext({
    // Its own address, so redeem_invite's per-IP limit counts it alone.
    extraHTTPHeaders: {
      "x-forwarded-for": `203.0.113.${1 + Math.floor(Math.random() * 254)}`,
    },
  });
  const page = await context.newPage();
  await signUp(page, email);
  await page.waitForURL(/\/join$/);
  // Passkeys and two-factor need a confirmed address.
  await page.goto(await waitForAuthMail(email, "verify"));
  await page.goto("/join");
  await redeem(page, code, name);
  await expect(page).toHaveURL(/\/$/);

  const cdp = await context.newCDPSession(page);
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
  await page.goto("/settings/security");
  const passkeys = page.getByTestId("passkeys-card");
  await passkeys.getByRole("button", { name: "Add a passkey" }).click();
  await passkeys.getByLabel("Name this passkey").fill("Laptop");
  await passkeys.getByRole("button", { name: "Create passkey" }).click();
  await expect(passkeys).toContainText("1 set up");

  const twoFactor = page.getByTestId("two-factor-card");
  await twoFactor.getByRole("button", { name: "Turn on two-factor" }).click();
  await twoFactor.getByLabel("Your password").fill(PASSWORD);
  await twoFactor.getByRole("button", { name: "Continue" }).click();
  const secret = (await twoFactor
    .getByTestId("totp-secret")
    .textContent())!.replace(/\s/g, "");
  await twoFactor.getByLabel("6-digit code").fill(totp(secret));
  await twoFactor.getByRole("button", { name: "Verify and turn on" }).click();
  await twoFactor.getByRole("button", { name: /I.ve saved them/ }).click();
  await expect(twoFactor).toContainText("On");

  const tg = tgId();
  await founder.goto("/admin/members");
  const row = founder.getByTestId(`member-${name}`);
  await row.locator("summary", { hasText: "Telegram" }).click();
  await row.getByLabel("Telegram user id", { exact: true }).fill(String(tg));
  await row.getByRole("button", { name: "Save Telegram id" }).click();
  await expect(row.getByText("Telegram id saved.")).toBeVisible();

  return { page, secret, tg };
}

/** The newest approval DM the fake brain sent `tg`. */
async function dmFor(request: APIRequestContext, tg: number) {
  let choices: number[] = [];
  await expect
    .poll(async () => {
      const res = await request.get(
        `/api/test/brain/login?telegramUserId=${tg}`,
      );
      const message = (await res.json()).message as {
        choices: number[];
      } | null;
      choices = message?.choices ?? [];
      return choices.length;
    })
    .toBeGreaterThan(0);
  return choices;
}

test("a passkey, a two-factor code or a Telegram tap confirms it too", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const admin = await adminWithEverything(page, browser, testInfo.project.name);
  const p = admin.page;
  await advanceClock(p, PAST_WINDOW);
  await openConnections(p);

  // Every way in this admin has is offered.
  const withPasskey = `e2e-sudo-${rand()}`;
  await createToken(p, withPasskey);
  const ask = dialog(p);
  await expect(
    ask.getByRole("button", { name: "Use a passkey" }),
  ).toBeVisible();
  await expect(ask.getByLabel("6-digit code")).toBeVisible();
  await expect(
    ask.getByRole("button", { name: "Approve in Telegram" }),
  ).toBeVisible();
  await expect(ask.getByLabel("Your password")).toBeVisible();

  // The passkey: the browser's prompt (the virtual authenticator) is enough.
  await ask.getByRole("button", { name: "Use a passkey" }).click();
  await expect(ask).toBeHidden();
  await tokenShown(p, withPasskey);

  // The window skips the second prompt.
  const inWindow = `e2e-sudo-${rand()}`;
  await createToken(p, inWindow);
  await tokenShown(p, inWindow);
  await expect(dialog(p)).toBeHidden();

  // Ten minutes on: the two-factor code.
  await advanceClock(p, PAST_WINDOW);
  const withCode = `e2e-sudo-${rand()}`;
  await createToken(p, withCode);
  await expect(dialog(p)).toBeVisible();
  await dialog(p).getByLabel("6-digit code").fill(totp(admin.secret));
  await dialog(p).getByRole("button", { name: "Confirm with code" }).click();
  await expect(dialog(p)).toBeHidden();
  await tokenShown(p, withCode);

  // Ten more: a tap on the number in Telegram (the fake brain's DM).
  await advanceClock(p, PAST_WINDOW);
  const withTap = `e2e-sudo-${rand()}`;
  await createToken(p, withTap);
  await dialog(p).getByRole("button", { name: "Approve in Telegram" }).click();
  const shown = dialog(p).getByTestId("step-up-baumy-code");
  await expect(shown).toHaveText(/^\d{2}$/);
  const number = Number(await shown.textContent());
  expect(await dmFor(request, admin.tg)).toContain(number);
  const tapped = await request.post("/api/test/brain/login", {
    data: { telegramUserId: admin.tg, tap: number },
  });
  expect(tapped.status()).toBe(200);
  await expect(dialog(p)).toBeHidden();
  await tokenShown(p, withTap);

  await p.context().close();
});
