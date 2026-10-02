import { expect, test, type Page } from "@playwright/test";
import { addChore, openChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #17 (SPEC §4.4): a chore worth 40 is done again and again within a
// few seconds, so once the weekly compute runs, /admin/weights suggests 30
// (the 25% step down) from 6 gaps. The founder edits it to 32 and schedules
// it; in Activity the founder cannot veto their own change, and the partner
// vetoes it.
//
// The founder logs each one for the partner, so each is confirmed at once
// (SPEC §4.3) and counts without waiting out the 24h window: the spec never
// moves the shared server clock. The compute is the daily job's (issue #18);
// here the test-only /api/test/weights runs it.

async function logFor(page: Page, chore: string, doer: string) {
  await page.goto("/chores");
  const sheet = await openChore(page, chore);
  await sheet.getByText(doer, { exact: true }).click();
  await expect(sheet.getByRole("radio", { name: doer })).toBeChecked();
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(sheet).toBeHidden();
}

function toast(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

test("a suggestion is scheduled on /admin/weights and vetoed by the partner", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-portrait", "The kiosk has no weights panel.");
  const tag = Math.random().toString(36).slice(2, 8);
  const chore = `Wipe ${tag}`;
  const partnerName = `Partner ${tag}`;

  await founderAdmin(page, project);
  // No cooldown, so it can be logged again straight away.
  await addChore(page, { name: chore, basePoints: 40, cooldownHours: 0 });
  const invite = await mintCode(page, 1);
  const partner = await newAccount(browser, `weights-${project}`);
  await redeem(partner.page, invite, partnerName);
  await expect(partner.page).toHaveURL(/\/$/);

  // 7 completions: 6 gaps, the least that is measured.
  for (let i = 0; i < 7; i += 1) await logFor(page, chore, partnerName);
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
    /^Gaps between completions: /,
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
  const scheduledIn = (p: Page) =>
    p.locator(
      `[data-testid="activity-points-${chore}"][data-event="scheduled"]`,
    );
  await page.goto("/activity");
  await expect(scheduledIn(page)).toContainText("40 → 32 pts");
  await expect(scheduledIn(page).getByRole("button")).toHaveCount(0);

  // The partner can.
  const p = partner.page;
  await p.goto("/activity");
  const theirs = scheduledIn(p);
  await expect(theirs).toContainText("40 → 32 pts");
  await theirs.getByRole("button", { name: "Veto" }).click();
  await expect(toast(p, "Vetoed.")).toBeVisible();
  await expect(scheduledIn(p).getByRole("button")).toHaveCount(0);
  await expect(
    p.locator(`[data-testid="activity-points-${chore}"][data-event="vetoed"]`),
  ).toContainText(`${partnerName} vetoed new points for ${chore}`);

  // It is gone from the admin panel, and the points stay at 40.
  await page.goto("/admin/weights");
  await expect(row).toContainText("40 pts");
  await expect(row.getByTestId("suggestion")).toHaveCount(0);
  await partner.context.close();
});
