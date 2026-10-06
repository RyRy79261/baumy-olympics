import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { expectKioskTargets, kioskNav, pairedKiosk } from "../lib/kiosk";
import { pickTile } from "../lib/pickers";

// Issue #134: the kitchen screen's Calendar tab is a manager, not another
// month (the dashboard shows that). On the iPad in portrait (820×1180),
// against the in-memory calendar that stands in for Google under
// E2E_TEST_MODE=1: the list of what is coming up, a big "Add event", and
// add → see it in the list → edit → delete, each change made as the acting
// member with no PIN, by a member who never set one (owner ruling
// 2026-10-02, issue #145), and who each event is for. Then the calendar unconnected and down, for this browser only (the
// `baumy_e2e_calendar` cookie).
//
// Screenshots go to E2E_SHOTS_DIR when it is set (the PR's shots),
// otherwise to the test's own output folder.

function shotsDir(name: string, outputPath: (p: string) => string): string {
  const dir = process.env.E2E_SHOTS_DIR ?? outputPath(name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A Berlin day `days` from now, "YYYY-MM-DD". */
function berlinDay(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("sv-SE", {
    timeZone: "Europe/Berlin",
  });
}

/** A housemate who never set a personal PIN. */
async function newMember(browser: Browser, admin: Page, name: string) {
  const invite = await mintCode(admin, 1);
  const member = await newAccount(
    browser,
    `kiosk-cal-${name.replace(/\s+/g, "-")}`,
  );
  await redeem(member.page, invite, name);
  await expect(member.page).toHaveURL(/\/$/);
  await member.context.close();
}

function eventRow(scope: Page | Locator, title: string): Locator {
  return scope.getByRole("button", { name: new RegExp(`^${title}, `) });
}

test("add, see, edit and delete an event on the kiosk, with no PIN", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const tag = Math.random().toString(36).slice(2, 8);
  const name = `Caller ${tag}`;
  const founder = `Founder ${project}`;
  const title = `Vet ${tag}`;
  const renamed = `Vet visit ${tag}`;
  const date = berlinDay(20);
  const shots = shotsDir("kiosk-calendar", (p) => testInfo.outputPath(p));

  await founderAdmin(page, project);
  await newMember(browser, page, name);
  const ipad = await pairedKiosk(browser, page, `iPad cal ${tag}`);
  const kiosk = ipad.page;

  // Nobody acting: the list reads, but nothing can be changed.
  await kioskNav(kiosk, "Calendar");
  await expect(
    kiosk.getByRole("heading", { name: "Calendar", level: 1 }),
  ).toBeVisible();
  await expect(
    kiosk.getByText("Tap your avatar at the top to add or change an event."),
  ).toBeVisible();
  for (const group of ["Today", "This week", "Later"]) {
    await expect(
      kiosk.getByRole("heading", { name: new RegExp(`^${group}`), level: 2 }),
    ).toBeVisible();
  }
  await expect(kiosk.getByRole("button", { name: "Add event" })).toHaveCount(0);
  // Not the month: the dashboard has that.
  await expect(kiosk.getByTestId("calendar-title")).toHaveCount(0);

  // Tap in. Every target on the page, and in the form, is 56px or more.
  await kiosk.getByRole("button", { name, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(name);
  const add = kiosk.getByRole("button", { name: "Add event" });
  await expect(add).toBeVisible();
  expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(64);
  await expectKioskTargets(kiosk.locator("main"));
  await kiosk.screenshot({ path: join(shots, "1-list.png") });

  // A tap outside closes the empty sheet; once a title is typed it does
  // nothing (owner ruling 2026-10-06, SPEC §12 decision 32), and the ×
  // still closes it (issue #174).
  const sheet = kiosk.getByRole("dialog", { name: "New event" });
  await add.click();
  await expect(sheet).toBeVisible();
  expect((await sheet.boundingBox())!.x).toBeGreaterThan(20);
  await kiosk.mouse.click(10, 10);
  await expect(sheet).toBeHidden();
  await add.click();
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Title").fill(title);
  await kiosk.mouse.click(10, 10);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Title")).toHaveValue(title);
  await sheet.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sheet).toBeHidden();

  // Add: for the founder, three weeks out, 19:00 to 20:00.
  await add.click();
  await expect(sheet).toBeVisible();
  await expectKioskTargets(sheet);
  await sheet.getByLabel("Title").fill(title);
  await sheet.getByLabel("Date").fill(date);
  await sheet.getByLabel("Starts").fill("19:00");
  await sheet.getByLabel("Ends").fill("20:00");
  await pickTile(sheet, "Who is it for?", founder);
  await kiosk.screenshot({ path: join(shots, "2-add.png") });
  await sheet.getByRole("button", { name: "Add event" }).click();

  // No PIN is asked (issue #145): it saves at once.
  await expect(sheet).toBeHidden();
  await expect(
    kiosk
      .getByRole("status")
      .filter({ hasText: `Added ${title} to the calendar.` }),
  ).toBeVisible();

  // It is in the list, under Later, at 19:00 Berlin, for the founder.
  const later = kiosk.getByTestId("upcoming-later");
  const row = eventRow(later, title);
  await expect(row).toBeVisible();
  await expect(row).toContainText("19:00–20:00");
  await expect(row).toContainText(founder);
  await expect(
    eventRow(kiosk.getByTestId("upcoming-today"), title),
  ).toHaveCount(0);
  await row.scrollIntoViewIfNeeded();
  await kiosk.screenshot({ path: join(shots, "4-in-list.png") });

  // The phone reads it back: added by the member acting on the kiosk, for
  // the founder.
  await page.goto(`/calendar?view=day&date=${date}`);
  await page.getByRole("button", { name: new RegExp(`^${title}, `) }).click();
  const details = page.getByRole("dialog", { name: `Edit ${title}` });
  await expect(details.getByTestId("event-added-by")).toHaveText(name);
  await expect(details.getByTestId("event-for-name")).toHaveText(founder);
  await details.getByRole("button", { name: "Cancel" }).click();

  // Edit: a new title, for everyone. Still no PIN.
  await row.click();
  const edit = kiosk.getByRole("dialog", { name: `Edit ${title}` });
  await expect(edit.getByTestId("event-for-name")).toHaveText(founder);
  await expectKioskTargets(edit);
  await edit.getByLabel("Title").fill(renamed);
  await pickTile(edit, "Who is it for?", "Everyone");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  const renamedRow = eventRow(later, renamed);
  await expect(renamedRow).toBeVisible();
  await expect(renamedRow).toContainText("Everyone");
  await expect(eventRow(later, title)).toHaveCount(0);
  await renamedRow.scrollIntoViewIfNeeded();
  await kiosk.screenshot({ path: join(shots, "5-edited.png") });

  // Delete asks first; "Keep it" keeps it.
  await renamedRow.click();
  await kiosk
    .getByRole("dialog", { name: `Edit ${renamed}` })
    .getByRole("button", { name: "Delete…" })
    .click();
  const confirm = kiosk.getByRole("dialog", { name: `Delete ${renamed}?` });
  await expect(confirm).toContainText("19:00–20:00");
  await confirm.getByRole("button", { name: "Keep it" }).click();
  await expect(confirm).toBeHidden();
  await expect(renamedRow).toBeVisible();

  // Then for real, with no PIN.
  await renamedRow.click();
  await kiosk
    .getByRole("dialog", { name: `Edit ${renamed}` })
    .getByRole("button", { name: "Delete…" })
    .click();
  await expectKioskTargets(confirm);
  await confirm.getByRole("button", { name: "Delete event" }).click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Deleted ${renamed}.` }),
  ).toBeVisible();
  await expect(confirm).toBeHidden();
  await expect(eventRow(kiosk, renamed)).toHaveCount(0);
  await kiosk.screenshot({ path: join(shots, "6-deleted.png") });

  await ipad.context.close();
});

test("says so when the calendar is not connected, or Google is down", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const tag = Math.random().toString(36).slice(2, 8);
  const founder = `Founder ${project}`;
  const shots = shotsDir("kiosk-calendar", (p) => testInfo.outputPath(p));

  await founderAdmin(page, project);
  const ipad = await pairedKiosk(browser, page, `iPad cal-off ${tag}`);
  const kiosk = ipad.page;
  await kioskNav(kiosk, "Calendar");
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  await expect(kiosk.getByRole("button", { name: "Add event" })).toBeVisible();

  // Not connected, for this browser only.
  const cookie = (value: string) => ({
    name: "baumy_e2e_calendar",
    value,
    domain: "localhost",
    path: "/",
  });
  await ipad.context.addCookies([cookie("unconfigured")]);
  await kiosk.reload();
  const off = kiosk.getByTestId("calendar-not-configured");
  await expect(off).toContainText("Not connected yet");
  await expect(off).toContainText("An admin can connect it");
  await expect(kiosk.getByRole("button", { name: "Add event" })).toHaveCount(0);
  await kiosk.screenshot({ path: join(shots, "7-not-connected.png") });

  // Down: it says so, and "Try again" reads it afresh once it is back.
  await ipad.context.addCookies([cookie("down")]);
  await kiosk.reload();
  const down = kiosk.getByTestId("calendar-unavailable");
  await expect(down).toContainText("Google Calendar did not answer.");
  await expect(kiosk.getByTestId("calendar-not-configured")).toHaveCount(0);
  await kiosk.screenshot({ path: join(shots, "8-down.png") });
  await ipad.context.clearCookies({ name: "baumy_e2e_calendar" });
  await down.getByRole("link", { name: "Try again" }).click();
  await expect(kiosk.getByRole("button", { name: "Add event" })).toBeVisible();
  await expect(kiosk.getByTestId("calendar-unavailable")).toHaveCount(0);

  await ipad.context.close();
});
