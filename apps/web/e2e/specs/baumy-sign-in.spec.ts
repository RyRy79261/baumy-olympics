import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from "@playwright/test";
import { freshEmail, signUp } from "../lib/accounts";
import { founderAdmin, mintCode, redeem } from "../lib/household";

// "Sign in with Baumy" end to end (issue #80), against Docker Postgres. The
// member's Telegram is the fake brain of E2E_TEST_MODE: /api/test/brain/login
// shows the DM brain would have sent and taps its buttons, through the real
// /api/v1/actions endpoint as brain's button handler does.

const rand = () => Math.random().toString(36).slice(2, 8);
/** A Telegram user id nobody else in this run uses. */
const tgId = () => 8_000_000_000 + Math.floor(Math.random() * 1_000_000_000);

interface Housemate {
  email: string;
  name: string;
  tg: number;
}

/** A new member with a password account, linked to a Telegram id by the admin. */
async function linkedHousemate(
  page: Page,
  browser: Browser,
  project: string,
): Promise<Housemate> {
  await founderAdmin(page, project);
  const code = await mintCode(page, 1);
  const email = freshEmail(`baumy-sign-in-${project}`);
  const name = `Tapper ${rand()}`;
  const context = await browser.newContext();
  const member = await context.newPage();
  await signUp(member, email);
  await redeem(member, code, name);
  await expect(member).toHaveURL(/\/$/);
  await context.close();

  const tg = tgId();
  await page.goto("/admin/members");
  const row = page.getByTestId(`member-${name}`);
  await row.locator("summary", { hasText: "Telegram" }).click();
  await row.getByLabel("Telegram user id").fill(String(tg));
  await row.getByRole("button", { name: "Save Telegram id" }).click();
  await expect(row.getByText("Telegram id saved.")).toBeVisible();
  return { email, name, tg };
}

interface Dm {
  requestId: string;
  device: string;
  choices: number[];
}

/**
 * The newest DM the fake brain sent this Telegram user, once one arrives
 * that is not `after` (brain sends it after the page got its answer).
 */
async function dmFor(
  request: APIRequestContext,
  tg: number,
  after?: string,
): Promise<Dm> {
  let message: Dm | null = null;
  await expect
    .poll(async () => {
      const res = await request.get(
        `/api/test/brain/login?telegramUserId=${tg}`,
      );
      message = (await res.json()).message as Dm | null;
      return message !== null && message.requestId !== after;
    })
    .toBe(true);
  return message!;
}

/** Signed out: ask Baumy to sign in as `email`; returns the number shown. */
async function askBaumy(page: Page, email: string): Promise<number> {
  await page.goto("/auth/sign-in?callbackURL=%2Fsettings");
  await page.getByRole("button", { name: "Sign in with Baumy" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign in with Baumy" }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send to Telegram" }).click();
  const shown = page.getByTestId("baumy-login-code");
  await expect(shown).toHaveText(/^\d{2}$/);
  await expect(
    page.getByText("If this account is linked to Telegram"),
  ).toBeVisible();
  return Number(await shown.textContent());
}

function tap(request: APIRequestContext, tg: number, tapped: number | "deny") {
  return request.post("/api/test/brain/login", {
    data: { telegramUserId: tg, tap: tapped },
  });
}

test("a member signs in by tapping the number in Telegram", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const who = await linkedHousemate(page, browser, testInfo.project.name);
  const context = await browser.newContext();
  const phone = await context.newPage();

  const code = await askBaumy(phone, who.email);
  const dm = await dmFor(request, who.tg);
  expect(dm.choices).toHaveLength(5);
  expect(dm.choices).toContain(code);

  const res = await tap(request, who.tg, code);
  expect(res.status()).toBe(200);
  expect((await res.json()).data.outcome).toBe("approved");

  // The waiting page trades the approval for a session and goes on.
  await phone.waitForURL((url) => url.pathname === "/settings");
  await expect(
    phone.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();

  // The same tap again (brain retrying with its key) replays the answer;
  // Deny afterwards changes nothing: the request was answered.
  const replay = await tap(request, who.tg, code);
  expect((await replay.json()).data.outcome).toBe("approved");
  const late = await tap(request, who.tg, "deny");
  expect((await late.json()).code).toBe("INVALID_STATE");
  await context.close();
});

test("Deny denies the sign-in and pauses the method for that member", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const who = await linkedHousemate(page, browser, testInfo.project.name);
  const context = await browser.newContext();
  const phone = await context.newPage();

  await askBaumy(phone, who.email);
  const first = await dmFor(request, who.tg);
  const denied = await tap(request, who.tg, "deny");
  expect((await denied.json()).data.outcome).toBe("denied");
  await expect(
    phone.getByRole("alert").filter({ hasText: "denied in Telegram" }),
  ).toBeVisible();
  await expect(phone).toHaveURL(/\/auth\/sign-in/);

  // Asking again shows the same screen, but no DM goes out for 15 minutes.
  await phone.getByRole("button", { name: "Try again" }).click();
  await phone.getByRole("button", { name: "Send to Telegram" }).click();
  await expect(phone.getByTestId("baumy-login-code")).toHaveText(/^\d{2}$/);
  await phone.waitForTimeout(2_000);
  expect((await dmFor(request, who.tg)).requestId).toBe(first.requestId);
  await context.close();
});

test("a number that is not on the screen blocks the sign-in", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const who = await linkedHousemate(page, browser, testInfo.project.name);
  const context = await browser.newContext();
  const phone = await context.newPage();

  const code = await askBaumy(phone, who.email);
  const dm = await dmFor(request, who.tg);
  expect(dm.choices).toHaveLength(5);
  expect(dm.choices).toContain(code);
  const decoy = dm.choices.find((n) => n !== code)!;
  const blocked = await tap(request, who.tg, decoy);
  expect((await blocked.json()).data.outcome).toBe("blocked");
  await expect(
    phone.getByRole("alert").filter({ hasText: "denied in Telegram" }),
  ).toBeVisible();

  // Still signed out: the session page sends us to sign in.
  await phone.goto("/settings");
  await expect(phone).toHaveURL(/\/auth\/sign-in/);
  await context.close();
});

test("every address gets the same screen, linked or not", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const code = await askBaumy(page, `nobody-${rand()}@example.com`);
  expect(code).toBeGreaterThanOrEqual(10);
  await expect(page.getByText(/Waiting for your tap/)).toBeVisible();
  await page.getByRole("button", { name: "Use your password instead" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await context.close();
});
