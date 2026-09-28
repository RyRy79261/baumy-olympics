import { expect, test } from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { pairedKiosk } from "../lib/kiosk";

// Issue #66 (ADR 0005 §6), on the kitchen iPad: by day, 5 minutes untouched
// bring on the raccoon screensaver (a dim room, the clock, Baumy asleep and
// three raccoons); a tap wakes it and never reaches the page; a touch
// before the 5 minutes starts the wait again. Only the iPad's clock moves
// (Playwright's), so it runs alongside everything else.

const MINUTE = 60_000;

test("the screensaver comes on after 5 minutes untouched and a tap wakes it", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad.");
  const suffix = Math.random().toString(36).slice(2, 8);
  await founderAdmin(page, project);
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${suffix}`,
  );
  await context.clock.install();
  await kiosk.goto("/kiosk");
  await kiosk.waitForLoadState("networkidle");
  const shell = kiosk.locator("[data-kiosk]");
  const saver = kiosk.getByTestId("screensaver");
  await expect(shell).toBeVisible();
  await expect(saver).toHaveCount(0);

  // 4 minutes, a touch, 4 more: still awake.
  await context.clock.fastForward(4 * MINUTE);
  await expect(saver).toHaveCount(0);
  await kiosk.mouse.click(5, 5);
  await context.clock.fastForward(4 * MINUTE);
  await expect(saver).toHaveCount(0);

  // A minute and a bit more, untouched: the screensaver. (Stepped, so a
  // screen that hydrated late still gets its 5 minutes; the exact timing is
  // components/kiosk/screensaver.test.tsx's.)
  await context.clock.fastForward(MINUTE + 2_000);
  await expect(async () => {
    if (!(await saver.isVisible())) await context.clock.fastForward(30_000);
    await expect(saver).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(kiosk.getByTestId("screensaver-time")).toHaveText(
    /^\d{2}:\d{2}$/,
  );
  await expect(saver).toContainText("all quiet");
  await expect(saver.locator('[data-state="sleeping"]')).toHaveCount(1);
  await expect(saver.locator("[data-raccoon]")).toHaveCount(3);

  // A tap in the middle of the screen wakes it, and lands on nothing else.
  const url = kiosk.url();
  await saver.click();
  await expect(saver).toHaveCount(0);
  await expect(shell).toBeVisible();
  expect(kiosk.url()).toBe(url);

  await context.close();
});
