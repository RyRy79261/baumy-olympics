import { expect, test, type Page } from "@playwright/test";
import { addChore, openChore } from "../lib/chores";
import { advanceClock, resetClock } from "../lib/clock";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #17 (SPEC §4.4): a chore worth 40 is done every hour, so once the
// weekly compute runs, /admin/weights suggests 30 (the 25% step down) from 6
// gaps. The founder edits it to 32 and schedules it; on /inbox the founder
// cannot veto their own change, and the partner vetoes it.
//
// The compute is the daily job's (issue #18); here the test-only
// /api/test/weights runs it at the server clock. The spec moves the shared
// server clock, so it runs serially in desktop-chromium only
// (playwright.config.ts), and puts the clock back afterwards.

test.describe.configure({ mode: "serial" });

const HOUR = 60 * 60 * 1000;

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

async function log(page: Page, chore: string) {
  await page.goto("/chores");
  const sheet = await openChore(page, chore);
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("score-pop")).toBeVisible();
}

function toast(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

test("a suggestion is scheduled on /admin/weights and vetoed by the partner", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  const tag = Math.random().toString(36).slice(2, 8);
  const chore = `Wipe ${tag}`;

  await founderAdmin(page, project);
  // No cooldown, so it can be done every hour.
  await addChore(page, { name: chore, basePoints: 40, cooldownHours: 0 });
  const invite = await mintCode(page, 1);
  const partner = await newAccount(browser, `weights-${project}`);
  await redeem(partner.page, invite, `Partner ${tag}`);
  await expect(partner.page).toHaveURL(/\/$/);

  // 7 completions an hour apart: 6 gaps, the least that is measured.
  for (let i = 0; i < 7; i += 1) {
    if (i > 0) await advanceClock(page, HOUR);
    await log(page, chore);
  }
  // Self-claims count once they finalize, 24h after logging.
  await advanceClock(page, 25 * HOUR);
  const res = await page.request.post("/api/test/weights", {
    data: { run: "compute" },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).suggested).toBeGreaterThanOrEqual(1);

  await page.goto("/admin/weights");
  await expect(
    page.getByRole("heading", { name: "Weights", level: 1 }),
  ).toBeVisible();
  const row = page.getByTestId(`weight-${chore}`);
  await expect(row).toContainText("40 pts");
  await expect(row).toContainText("6 gaps");
  await expect(row).toContainText("The formula says 30 pts.");
  await expect(row.getByRole("img")).toHaveAttribute(
    "aria-label",
    `Gaps between completions: ${Array(6).fill("1 h").join(", ")}.`,
  );
  const suggestion = row.getByTestId("suggestion");
  await expect(suggestion).toHaveAttribute("data-status", "open");
  await expect(suggestion).toContainText("40 → 30 pts");

  // Edit & schedule.
  const form = suggestion.getByRole("form", { name: `Schedule ${chore}` });
  await form.getByLabel("Points").fill("32");
  await form.getByRole("button", { name: "Schedule" }).click();
  await expect(toast(page, "unless someone vetoes it")).toBeVisible();
  await expect(suggestion).toHaveAttribute("data-status", "scheduled");
  await expect(suggestion).toContainText("40 → 32 pts");

  // The founder scheduled it, so the founder cannot veto it.
  await page.goto("/inbox");
  const mine = page.getByTestId(`scheduled-${chore}`);
  await expect(mine).toContainText("You scheduled this.");
  await expect(mine.getByRole("button", { name: /Veto/ })).toHaveCount(0);

  // The partner can.
  const p = partner.page;
  await p.goto("/inbox");
  const theirs = p.getByTestId(`scheduled-${chore}`);
  await expect(theirs).toContainText("40 → 32 pts");
  await theirs
    .getByRole("button", { name: `Veto the ${chore} change` })
    .click();
  await expect(toast(p, "Vetoed.")).toBeVisible();
  await expect(p.getByTestId(`scheduled-${chore}`)).toHaveCount(0);

  // It is gone from the admin panel, and the points stay at 40.
  await page.goto("/admin/weights");
  await expect(row).toContainText("40 pts");
  await expect(row.getByTestId("suggestion")).toHaveCount(0);
  await partner.context.close();
});
