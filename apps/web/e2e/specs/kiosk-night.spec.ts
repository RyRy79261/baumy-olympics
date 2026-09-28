import { expect, test } from "@playwright/test";
import { berlinParts, berlinWallTimeToUtc } from "@baumy/core";
import { advanceClock, resetClock, serverClock } from "../lib/clock";
import { founderAdmin } from "../lib/household";
import { pairedKiosk } from "../lib/kiosk";

// Issue #29, night mode on the kitchen iPad (the raccoon screensaver since
// issue #66): at 23:10 Berlin the kiosk dims to a sleeping Baumy and a
// clock; a tap wakes it, a minute untouched puts it back to sleep, and 06:30
// wakes it (the day's 5-minute idle wait starts then).
//
// It moves the shared SERVER clock (the night is the server's), so it runs
// in the server-clock project, one test at a time (playwright.config.ts
// SHARED_CLOCK_SPECS), on an iPad-sized context of its own, and puts the
// clock back afterwards. Playwright's clock moves the iPad's timers.

test.describe.configure({ mode: "serial" });

const MINUTE = 60_000;

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

test("night mode sleeps, wakes on a touch, and ends in the morning", async ({
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
  // Night mode is off in e2e unless the browser asks for a window, so the
  // other kiosk specs never meet it (lib/kiosk/night.ts kioskNightWindow).
  await context.addCookies([
    {
      name: "baumy_e2e_night",
      value: "23:00-06:30",
      url: new URL(kiosk.url()).origin,
    },
  ]);
  const shell = kiosk.locator("[data-kiosk]");
  const night = kiosk.getByTestId("screensaver");

  // By day (whatever the real time, 12:00 Berlin): no night screen.
  const { now } = await serverClock(page);
  const today = berlinParts(new Date(now));
  const at = (hour: number, minute: number) =>
    berlinWallTimeToUtc(today.year, today.month, today.day, hour, minute);
  await advanceClock(page, at(12, 0).getTime() - Date.parse(now));
  await context.clock.install();
  await kiosk.goto("/kiosk");
  await expect(
    kiosk.getByRole("heading", { name: "Kitchen", level: 1 }),
  ).toBeVisible();
  await expect(shell).toHaveAttribute("data-skin", "day");
  await expect(night).toHaveCount(0);

  // 23:10 Berlin: asleep at once, with the clock and a sleeping Baumy.
  await advanceClock(page, at(23, 10).getTime() - at(12, 0).getTime());
  await kiosk.goto("/kiosk");
  await expect(night).toBeVisible();
  await expect(kiosk.getByTestId("screensaver-time")).toHaveText(/^23:1\d$/);
  await expect(night.locator('[data-state="sleeping"]')).toHaveCount(1);
  await expect(shell).toHaveAttribute("data-skin", "night");

  // A tap wakes it, and the tap does not land on the page underneath.
  await night.click();
  await expect(night).toHaveCount(0);
  await expect(
    kiosk.getByRole("heading", { name: "Kitchen", level: 1 }),
  ).toBeVisible();
  await expect(kiosk).toHaveURL(/\/kiosk$/);

  // A minute untouched: asleep again.
  await context.clock.fastForward(61_000);
  await expect(night).toBeVisible();

  // The morning (06:40 Berlin, server and iPad together) wakes it for good.
  const toMorning = 7 * 60 * MINUTE + 30 * MINUTE;
  await advanceClock(page, toMorning);
  await context.clock.fastForward(toMorning);
  await expect(night).toHaveCount(0);
  await context.clock.fastForward(2 * MINUTE);
  await expect(night).toHaveCount(0);
  await kiosk.reload();
  await expect(shell).toHaveAttribute("data-skin", "day");
  await expect(night).toHaveCount(0);

  await context.close();
});
