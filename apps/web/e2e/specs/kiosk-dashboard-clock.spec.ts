import { expect, test } from "@playwright/test";
import { berlinParts, berlinWallTimeToUtc } from "@baumy/core";
import { advanceClock, resetClock, serverClock } from "../lib/clock";
import { founderAdmin } from "../lib/household";
import { pairedKiosk } from "../lib/kiosk";

// Issue #65: the kitchen dashboard's clock is the SERVER's (Berlin time),
// whatever the iPad's own clock says, and the home tidies itself after a
// minute untouched: a day sheet or a module closes, and another month goes
// back to this one.
//
// It moves the shared server clock, so it runs in the server-clock project,
// one test at a time (playwright.config.ts SHARED_CLOCK_SPECS), on an
// iPad-sized context of its own, and puts the clock back afterwards.
// Playwright's clock moves the iPad's timers.

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

test("the dashboard shows the server's Berlin time, and tidies itself when idle", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  const suffix = Math.random().toString(36).slice(2, 8);
  await founderAdmin(page, project);
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${suffix}`,
  );

  // 17:42 Berlin today on the server; the iPad's own clock is left alone.
  const { now } = await serverClock(page);
  const today = berlinParts(new Date(now));
  const at = berlinWallTimeToUtc(today.year, today.month, today.day, 17, 42);
  await advanceClock(page, at.getTime() - Date.parse(now));
  await context.clock.install();
  await kiosk.goto("/kiosk");
  await expect(kiosk.getByTestId("clock-time")).toHaveText("17:42");
  const weekday = new Date(
    Date.UTC(today.year, today.month - 1, today.day),
  ).getUTCDay();
  await expect(kiosk.getByTestId("clock-date")).toHaveText(
    `${WEEKDAYS[(weekday + 6) % 7]} ${today.day} ${MONTHS[today.month - 1]}`,
  );
  // It keeps the server's time as it ticks on the iPad.
  await context.clock.fastForward(60_000);
  await expect(kiosk.getByTestId("clock-time")).toHaveText(/^17:4[34]$/);

  // A day sheet left open closes after a minute untouched.
  const todayCell = kiosk.locator('[aria-current="date"]');
  await todayCell.click();
  const sheet = kiosk.locator("[data-sheet]");
  await expect(sheet).toBeVisible();
  await context.clock.fastForward(61_000);
  await expect(sheet).toHaveCount(0);

  // So does a module.
  await kiosk.locator('[data-icon="urgent"]').click();
  const module = kiosk.getByRole("dialog", { name: "Urgent" });
  await expect(module).toBeVisible();
  await context.clock.fastForward(61_000);
  await expect(module).toBeHidden();

  // Another month goes back to this one.
  const title = await kiosk.getByTestId("month-title").textContent();
  await kiosk.getByRole("link", { name: "Next month" }).click();
  await expect(kiosk).toHaveURL(/\?month=/);
  await expect(kiosk.getByTestId("month-title")).not.toHaveText(title!);
  await context.clock.fastForward(61_000);
  await expect(kiosk).toHaveURL(/\/kiosk$/);
  await expect(kiosk.getByTestId("month-title")).toHaveText(title!);

  await context.close();
});
