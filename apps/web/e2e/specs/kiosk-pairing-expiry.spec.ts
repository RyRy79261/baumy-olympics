import { expect, test } from "@playwright/test";
import { advanceClock, resetClock } from "../lib/clock";
import { founderAdmin, uniqueAddress } from "../lib/household";
import { KIOSK_VIEWPORT, shownPairing } from "../lib/kiosk";

// Issue #126: the iPad's pairing code lasts 10 minutes on the SERVER's
// clock. Past that, the admin's phone is told it has expired, and the iPad
// shows a fresh code by itself, which still pairs.
//
// It moves the shared server clock, so it runs in the server-clock project
// (playwright.config.ts SHARED_CLOCK_SPECS) and puts the clock back
// afterwards.

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

const TTL_MS = 10 * 60_000;

test("an expired code cannot be approved, and the iPad shows a new one", async ({
  page,
  browser,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  const ipad = await browser.newContext({
    viewport: KIOSK_VIEWPORT,
    hasTouch: true,
    extraHTTPHeaders: { "x-forwarded-for": uniqueAddress() },
  });
  const kiosk = await ipad.newPage();
  await kiosk.goto("/kiosk/pair");
  const first = await shownPairing(kiosk);

  // Still inside its 10 minutes, the phone could approve it.
  await page.goto(first.url);
  await expect(
    page.getByRole("button", { name: "Make it the kitchen screen" }),
  ).toBeVisible();

  // The server's clock passes the code's 10 minutes.
  await advanceClock(page, TTL_MS);
  await page
    .getByRole("button", { name: "Make it the kitchen screen" })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "That code has expired" }),
  ).toBeVisible();
  await page.goto(first.url);
  await expect(
    page.getByRole("alert").filter({ hasText: "That code has expired" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Make it the kitchen screen" }),
  ).toHaveCount(0);

  // The iPad's next poll finds it expired and shows a new code.
  await expect(kiosk.getByTestId("pairing-code")).not.toHaveText(first.code, {
    timeout: 15_000,
  });
  const second = await shownPairing(kiosk);
  expect(second.url).not.toBe(first.url);
  await expect(kiosk).toHaveURL(/\/kiosk\/pair$/);

  // The new one pairs.
  await page.goto(second.url);
  await page
    .getByRole("button", { name: "Make it the kitchen screen" })
    .click();
  await expect(kiosk).toHaveURL(/\/kiosk$/);
  await ipad.close();
});
