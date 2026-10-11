import { expect, test } from "@playwright/test";
import { addChore, openChore, tile } from "../lib/chores";
import { founderAdmin } from "../lib/household";

// Issue #14 on a phone and a desktop: the seeded chores are there, an admin
// adds a chore, logging it shows the preview, then a floating "+N"; logging
// it again inside the cooldown shows a toast with the retry time in Berlin
// time and stores nothing; an admin edits and archives it.
//
// Every run adds its own chore, so projects running in parallel on one
// database, and repeated local runs, never share a cooldown.

test("log a chore, then meet its cooldown", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-portrait", "The kiosk has its own spec.");
  const name = `Trash ${Math.random().toString(36).slice(2, 8)}`;
  const me = `Founder ${project}`;

  await founderAdmin(page, project);

  // The starter chores of SPEC §4.7 are seeded.
  await expect(
    page.getByRole("link", { name: "Bounties", exact: true }).first(),
  ).toBeVisible();
  await page.goto("/chores");
  await expect(
    page.getByRole("heading", { name: "Bounties", level: 1 }),
  ).toBeVisible();
  for (const seeded of ["Trash", "Dishes", "Keller"]) {
    await expect(page.getByTestId(`chore-${seeded}`)).toBeVisible();
  }

  await addChore(page, { name, basePoints: 20, cooldownHours: 48 });

  // Never done and just added: a new maintenance bounty, ready to log.
  // There is no due date and no Urgent tab (SPEC §12 decision 35, issue
  // #189). The hub's New tile opens the board on its tab, and the other
  // tabs narrow it.
  await page.goto("/");
  const newTile = page.getByTestId("hub-tile-new");
  await expect(newTile).toHaveAccessibleName(/^New: [1-9]\d*$/);
  await newTile.click();
  await expect(page).toHaveURL(/\/chores\?show=new$/);
  const tabs = page.getByRole("group", { name: "Show" });
  await expect(tabs.getByRole("button", { name: /^New/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(tile(page, name)).toContainText("New");
  // Ready: "Log it", and no status line at all (nearly every bounty is
  // ready, so saying so on each row would be noise).
  await expect(tile(page, name)).toContainText("Log it");
  await expect(tile(page, name)).toBeEnabled();
  await expect(tile(page, name).locator("[data-bounty-status]")).toHaveCount(0);
  await expect(tile(page, name)).not.toContainText(/\b(never done|due)\b/i);
  await expect(tile(page, name)).toContainText("Maintenance");
  await expect(tabs.getByRole("button", { name: /^All/ })).toBeVisible();
  await expect(tabs.getByRole("button", { name: /^Urgent/ })).toHaveCount(0);
  await tabs.getByRole("button", { name: /^Consumables/ }).click();
  await expect(
    tabs.getByRole("button", { name: /^Consumables/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId(`chore-${name}`)).toHaveCount(0);
  // The tab is kept in the address, so a reload shows it again.
  await expect(page).toHaveURL(/\/chores\?show=consumable$/);
  await page.reload();
  await expect(
    tabs.getByRole("button", { name: /^Consumables/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await tabs.getByRole("button", { name: /^Maintenance/ }).click();
  await expect(tile(page, name)).toBeVisible();

  // The first log, from the Maintenance tab: the preview, then the points
  // it promised; the tab stays in the address through the log.
  // A tab tap fetches and remounts nothing: a sheet opened straight after
  // it is still open once the page has settled.
  await page.goto("/chores");
  await expect(tile(page, name)).toContainText("No streak yet");
  // A second tab opens the same bounty while it is still ready, to meet
  // the cooldown once the first log lands: the board itself never opens a
  // bounty that is cooling down.
  const other = await page.context().newPage();
  await other.goto("/chores");
  const stale = await openChore(other, name);
  await tabs.getByRole("button", { name: /^Maintenance/ }).click();
  const sheet = await openChore(page, name);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\/chores\?show=maintenance$/);
  await expect(sheet.getByTestId("log-preview")).toContainText("+20, streak 1");
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("score-pop")).toHaveText("+20");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: `Logged ${name} for ${me}: +20.` }),
  ).toBeVisible();
  await expect(tile(page, name)).toContainText(`${me} · streak 1`);
  // Cooling down: when it can be logged again, "Not yet" and disabled, as
  // on the kitchen screen; never a due date.
  await expect(tile(page, name).locator("[data-bounty-status]")).toHaveText(
    /^Again from (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d$/,
  );
  await expect(tile(page, name)).toContainText("Not yet");
  await expect(tile(page, name)).toBeDisabled();
  await expect(tile(page, name)).not.toContainText(/\b(Log it|due)\b/i);
  await expect(page).toHaveURL(/\/chores\?show=maintenance$/);
  await page.reload();
  await expect(
    tabs.getByRole("button", { name: /^Maintenance/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(tile(page, name)).toBeVisible();

  // The second, from the tab opened before, inside the 48h cooldown: a
  // toast, and nothing stored.
  await stale.getByRole("button", { name: "Log it" }).click();
  const refused = other
    .getByRole("alert")
    .filter({ hasText: `${name} was done recently.` });
  await expect(refused).toBeVisible();
  await expect(refused).toContainText(
    /You can log it again from (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d \(Berlin time\)\./,
  );
  await other.close();
  await page.reload();
  await expect(tile(page, name)).toContainText(`${me} · streak 1`);

  // The admin changes its points; the tile shows the new base.
  // It is a maintenance bounty until the admin makes it a consumable.
  await page.goto("/admin/chores");
  await expect(page.getByTestId(`admin-chore-${name}`)).toContainText(
    "maintenance",
  );
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByLabel("Base points").fill("30");
  await edit.getByLabel("Kind").selectOption("consumable");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Saved ${name}.` }),
  ).toBeVisible();
  await expect(page.getByTestId(`admin-chore-${name}`)).toContainText("30 pts");
  await expect(page.getByTestId(`admin-chore-${name}`)).toContainText(
    "consumable",
  );

  // Archived, it leaves the grid; restored, it is back.
  await page.getByRole("button", { name: `Archive ${name}` }).click();
  await expect(page.getByTestId(`admin-chore-${name}`)).toContainText(
    "archived",
  );
  await page.goto("/chores");
  await expect(page.getByTestId("chore-Trash")).toBeVisible();
  await expect(page.getByTestId(`chore-${name}`)).toHaveCount(0);
  await page.goto("/admin/chores");
  await page.getByRole("button", { name: `Restore ${name}` }).click();
  await expect(page.getByTestId(`admin-chore-${name}`)).not.toContainText(
    "archived",
  );
  await page.goto("/chores?show=consumable");
  await expect(tile(page, name)).toContainText("30 pts");
  await expect(tile(page, name)).toContainText("Consumable");
});
