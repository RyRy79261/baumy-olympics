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
  test.skip(project === "ipad-landscape", "The kiosk has its own spec.");
  const name = `Trash ${Math.random().toString(36).slice(2, 8)}`;
  const me = `Founder ${project}`;

  await founderAdmin(page, project);

  // The starter chores of SPEC §4.7 are seeded.
  await expect(
    page.getByRole("link", { name: "Chores", exact: true }).first(),
  ).toBeVisible();
  await page.goto("/chores");
  await expect(
    page.getByRole("heading", { name: "Chores", level: 1 }),
  ).toBeVisible();
  for (const seeded of ["Trash", "Dishes", "Keller"]) {
    await expect(page.getByTestId(`chore-${seeded}`)).toBeVisible();
  }

  await addChore(page, { name, basePoints: 20, cooldownHours: 48 });

  // The first log: the preview, then the points it promised.
  await page.goto("/chores");
  await expect(tile(page, name)).toContainText("No streak yet");
  let sheet = await openChore(page, name);
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
  await expect(tile(page, name)).toContainText("Again from");

  // The second, inside the 48h cooldown: a toast, and nothing stored.
  sheet = await openChore(page, name);
  await expect(sheet.getByTestId("log-preview")).toContainText("+25, streak 2");
  await sheet.getByRole("button", { name: "Log it" }).click();
  const refused = page
    .getByRole("alert")
    .filter({ hasText: `${name} was done recently.` });
  await expect(refused).toBeVisible();
  await expect(refused).toContainText(
    /You can log it again from (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}, \d\d:\d\d \(Berlin time\)\./,
  );
  await page.reload();
  await expect(tile(page, name)).toContainText(`${me} · streak 1`);

  // The admin changes its points; the tile shows the new base.
  await page.goto("/admin/chores");
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByLabel("Base points").fill("30");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Saved ${name}.` }),
  ).toBeVisible();
  await expect(page.getByTestId(`admin-chore-${name}`)).toContainText("30 pts");

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
  await page.goto("/chores");
  await expect(tile(page, name)).toContainText("30 pts");
});
