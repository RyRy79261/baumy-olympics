import { expect, test } from "@playwright/test";
import { advanceClock, resetClock } from "../lib/clock";
import { founderAdmin } from "../lib/household";
import { kioskNav, pairedKiosk } from "../lib/kiosk";

// Issue #194 (owner, 2026-10-11): a note stops looking new 3 days after it
// was posted or last changed, for everyone. A fresh note is in the kitchen's
// Messages list and its count; 3 days on (the server's clock moved) it is in
// neither, for nobody picked or someone picked. It is still on the Board.
// (The phone's count runs through the same window: notes.test.ts. Using the
// phone's session three days on would leave it refreshed in the future for
// the specs after this one.)
//
// It moves the shared server clock, so it runs in the server-clock project
// (playwright.config.ts SHARED_CLOCK_SPECS), and puts the clock back.

test.describe.configure({ mode: "serial" });

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

/** 3 days (NOTE_NEW_MS in lib/notes/view.ts) and a minute. */
const PAST_NEW_MS = 3 * 24 * 60 * 60_000 + 60_000;

test("a note 3 days old is not new any more, for anyone", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  const tag = Math.random().toString(36).slice(2, 8);
  const title = `Old fridge note ${tag}`;
  const founder = `Founder ${project}`;
  await founderAdmin(page, project);
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  const sheet = page.getByRole("dialog", { name: "New note" });
  await sheet.getByLabel("Title").fill(title);
  await sheet.getByRole("button", { name: "Add note" }).click();
  await expect(sheet).toBeHidden();

  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${tag}`,
  );
  const icon = kiosk.locator('[data-icon="messages"]');
  const messages = kiosk.getByRole("dialog", { name: "Messages" });

  // Fresh: the other members have not read it, so it is a message.
  await expect(icon).toHaveAttribute("data-count", /^[1-9]\d*$/);
  await icon.click();
  await expect(messages.getByTestId(`message-${title}`)).toBeVisible();
  await messages.getByRole("button", { name: "Close" }).click();
  await expect(messages).toBeHidden();

  // Three days and a minute later, on the server's clock.
  await advanceClock(page, PAST_NEW_MS);

  // Nobody picked: not in the list. Every note in this household is at
  // least that old now, so the count is zero and the icon dim.
  await kiosk.goto("/kiosk");
  await expect(icon).toHaveAttribute("aria-label", "Messages: 0");
  await icon.click();
  await expect(messages).toBeVisible();
  await expect(messages.getByTestId(`message-${title}`)).toHaveCount(0);
  await expect(messages).toContainText("No new notes. Older ones are on the Board.");
  await messages.getByRole("button", { name: "Close" }).click();

  // Someone picked: still nothing new for them.
  await kioskNav(kiosk, "Calendar");
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await kioskNav(kiosk, "Home");
  await expect(icon).toHaveAttribute("aria-label", "Messages: 0");

  // Still on the Board, though: only its "new" ended.
  await kioskNav(kiosk, "Board");
  await expect(kiosk.getByTestId(`note-${title}`)).toBeVisible();

  await context.close();
});
