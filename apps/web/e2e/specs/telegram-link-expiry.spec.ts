import { expect, test, type Page } from "@playwright/test";
import { advanceClock, resetClock } from "../lib/clock";
import { founderAdmin } from "../lib/household";

// Issue #118: Settings' Telegram link watches the SERVER's clock. With the
// browser's clock two hours fast it still asks the server while the code
// waits, and once the server's clock passes the code's 10 minutes the card
// switches to an expired state that offers a new link.
//
// It moves the shared server clock, so it runs in the server-clock project
// (playwright.config.ts SHARED_CLOCK_SPECS) and puts the clock back
// afterwards.

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

const HOUR = 60 * 60_000;
const TTL_MS = 10 * 60_000;

/** The card's next ask of the server (a server action POST to /settings). */
function nextAsk(page: Page) {
  return page.waitForRequest(
    (req) =>
      req.method() === "POST" &&
      new URL(req.url()).pathname === "/settings" &&
      req.headers()["next-action"] !== undefined,
    { timeout: 15_000 },
  );
}

test("an expired link asks for a new one, on the server's clock", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  await page.clock.install({ time: Date.now() + 2 * HOUR });
  await page.goto("/settings");

  await page.getByRole("button", { name: "Link Telegram" }).click();
  const openTelegram = page.getByRole("link", { name: "Open Telegram" });
  await expect(openTelegram).toBeVisible();
  const first = await openTelegram.getAttribute("href");
  const waiting = page
    .getByRole("status")
    .filter({ hasText: "Waiting for Telegram" });
  await expect(waiting).toBeVisible();

  // Past the code's expiry by the browser's clock, it still asks and waits.
  await nextAsk(page);
  await expect(waiting).toBeVisible();

  // The server's clock passes the code's expiry: the next ask says so.
  await advanceClock(page, TTL_MS);
  await nextAsk(page);
  await expect(
    page.getByText("That link has expired. Make a new one."),
  ).toBeVisible();
  await expect(openTelegram).toHaveCount(0);
  await expect(page.getByTestId("telegram-link-code")).toHaveCount(0);

  // A new link waits again.
  await page.getByRole("button", { name: "Make a new link" }).click();
  await expect(openTelegram).toBeVisible();
  expect(await openTelegram.getAttribute("href")).not.toBe(first);
  await expect(waiting).toBeVisible();
  await expect(
    page.getByText("That link has expired. Make a new one."),
  ).toHaveCount(0);
});
