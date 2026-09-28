import { expect, test, type Page } from "@playwright/test";
import { addChore, openChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #16: after a few logs, /scores shows the expected totals, dims the
// points that can still be disputed and breaks each completion down; an
// admin records money on /pot and sees it in the month's list.
//
// The logs are by a member who joins for this run only, so specs running in
// parallel on the same database (the founder logs chores elsewhere) cannot
// move this member's total.

async function log(page: Page, chore: string) {
  await page.goto("/chores");
  const sheet = await openChore(page, chore);
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("score-pop")).toBeVisible();
}

test("the scoreboard adds up a few logs, and the pot takes money", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-portrait", "The kiosk has no scoreboard yet.");
  const tag = Math.random().toString(36).slice(2, 8);
  const player = `Player ${tag}`;
  const trash = `Bins ${tag}`;
  const dishes = `Plates ${tag}`;

  await founderAdmin(page, project);
  await addChore(page, { name: trash, basePoints: 20, cooldownHours: 48 });
  // No cooldown, so it can be logged twice in a row for a streak.
  await addChore(page, { name: dishes, basePoints: 10, cooldownHours: 0 });
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `scores-${project}`);
  await redeem(member.page, invite, player);
  await expect(member.page).toHaveURL(/\/$/);

  // Before any log: a row at zero.
  await member.page.goto("/scores");
  await expect(
    member.page.getByRole("heading", { name: "Scores", level: 1 }),
  ).toBeVisible();
  const row = member.page.getByTestId(`standing-${player}`);
  await expect(row.getByTestId("points")).toHaveText("0");

  // 20 for the bins, then 10 and 13 for a streak of two on the plates
  // (125% of 10 is 12.5, which rounds up).
  await log(member.page, trash);
  await log(member.page, dishes);
  await log(member.page, dishes);

  await member.page.goto("/scores");
  await expect(row.getByTestId("points")).toHaveText("43");
  // Self-claims can still be disputed for 24h: all of it is dimmed.
  await expect(row).toContainText("(43 pending)");
  const recent = member.page.getByTestId("recent");
  await expect(
    recent.getByRole("row").filter({ hasText: trash }),
  ).toContainText("20 base");
  await expect(
    recent.getByRole("row").filter({ hasText: dishes }).first(),
  ).toContainText("10 base + 3 streak (2 in a row)");
  await expect(member.page.getByTestId("current-streaks")).toContainText(
    `${player} on ${dishes}`,
  );
  await expect(member.page.getByTestId("prize-mode")).toContainText(
    "winner takes the whole pot",
  );
  // A member sees the pot but cannot add to it.
  await member.page.goto("/pot");
  await expect(
    member.page.getByRole("heading", { name: "Pot", level: 1 }),
  ).toBeVisible();
  await expect(
    member.page.getByRole("button", { name: "Add to the pot" }),
  ).toHaveCount(0);
  await member.context.close();

  // The admin records money for this month.
  await page.goto("/pot");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add to the pot" }),
  });
  await form.getByLabel("Amount (€)").fill("12.34");
  await form.getByLabel("Note (optional)").fill(`Run ${tag}`);
  await form.getByRole("button", { name: "Add to the pot" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added €12.34 to the pot." }),
  ).toBeVisible();
  await expect(page.getByTestId("pot-months")).toContainText(
    `€12.34 (Run ${tag})`,
  );
  await expect(page.getByTestId("pot-total")).toContainText("€");
});
