import { expect, test } from "@playwright/test";
import { advanceClock, resetClock, serverClock } from "../lib/clock";

// The server test clock, end to end through `next start`. The offset is one
// value per server process, so these tests run serially, and only in
// desktop-chromium (playwright.config.ts ignores this file in the other
// projects): parallel projects would move the same clock under each other.
test.describe.configure({ mode: "serial" });

const DAY = 24 * 60 * 60 * 1000;

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

test("advanceClock moves the server clock and resetClock restores it", async ({
  page,
}) => {
  const before = await serverClock(page);
  expect(before.offsetMs).toBe(0);

  const moved = await advanceClock(page, DAY);
  expect(moved.offsetMs).toBe(DAY);
  // At least a day ahead of where it was, and not more than a minute over.
  const delta = Date.parse(moved.now) - Date.parse(before.now);
  expect(delta).toBeGreaterThanOrEqual(DAY);
  expect(delta).toBeLessThan(DAY + 60_000);

  const reset = await resetClock(page);
  expect(reset.offsetMs).toBe(0);
  expect(Math.abs(Date.parse(reset.now) - Date.now())).toBeLessThan(60_000);
});

test("the clock route rejects a malformed body", async ({ page }) => {
  const res = await page.request.post("/api/test/clock", {
    data: { advanceMs: "a day" },
  });
  expect(res.status()).toBe(400);
  expect((await serverClock(page)).offsetMs).toBe(0);
});
