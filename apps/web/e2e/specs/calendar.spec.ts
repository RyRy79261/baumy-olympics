import { expect, test, type Locator, type Page } from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { expectKioskTargets, pairedKiosk } from "../lib/kiosk";

// Issue #19, against the in-memory calendar that stands in for Google under
// E2E_TEST_MODE=1 (lib/integrations/calendar-memory.ts). The fake takes the
// same request bodies as Google and reads a local `dateTime` plus
// `timeZone: "Europe/Berlin"` as Google does, so "19:00 in January and in
// July both show at 19:00" checks what the app sends.
//
// The fake is one calendar for the whole server, shared by specs running in
// parallel, so each event has a title of its own.

interface NewEvent {
  title: string;
  date: string;
  start: string;
  end: string;
}

function eventButton(page: Page | Locator, title: string): Locator {
  return page.getByRole("button", { name: new RegExp(`^${title}, `) });
}

async function addEvent(page: Page, e: NewEvent) {
  await page.getByRole("button", { name: "New event" }).click();
  const sheet = page.getByRole("dialog", { name: "New event" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Title").fill(e.title);
  await sheet.getByLabel("Date").fill(e.date);
  await sheet.getByLabel("Starts").fill(e.start);
  await sheet.getByLabel("Ends").fill(e.end);
  await sheet.getByRole("button", { name: "Add event" }).click();
  await expect(sheet).toBeHidden();
  return sheet;
}

test("add, edit and delete an event on /calendar", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-landscape", "The kiosk has its own spec below.");
  const tag = Math.random().toString(36).slice(2, 8);
  const title = `Dinner ${tag}`;
  const renamed = `Supper ${tag}`;

  await founderAdmin(page, project);
  await page.getByRole("link", { name: "Calendar" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Calendar", level: 1 }),
  ).toBeVisible();

  await page.goto("/calendar?view=week&date=2027-01-15");
  await expect(page.getByTestId("calendar-title")).toHaveText(
    "Mon 11 Jan – Sun 17 Jan 2027",
  );
  await addEvent(page, {
    title,
    date: "2027-01-15",
    start: "19:00",
    end: "20:30",
  });
  const day = page.getByTestId("day-2027-01-15");
  await expect(eventButton(day, title)).toContainText("19:00");

  // The month view shows it too.
  await page.getByRole("link", { name: "Month" }).click();
  await expect(page.getByTestId("calendar-title")).toHaveText("Jan 2027");
  await expect(eventButton(page, title)).toBeVisible();

  // Edit: a new title and a later start.
  await eventButton(page, title).click();
  const edit = page.getByRole("dialog", { name: `Edit ${title}` });
  await expect(edit.getByTestId("event-when")).toHaveText(
    "Fri 15 Jan, 19:00–20:30",
  );
  await edit.getByLabel("Title").fill(renamed);
  await edit.getByLabel("Starts").fill("19:30");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  await expect(eventButton(page, renamed)).toBeVisible();
  await expect(eventButton(page, title)).toHaveCount(0);

  // Delete asks first; "Keep it" keeps it.
  await eventButton(page, renamed).click();
  await page
    .getByRole("dialog", { name: `Edit ${renamed}` })
    .getByRole("button", { name: "Delete…" })
    .click();
  const confirm = page.getByRole("dialog", { name: `Delete ${renamed}?` });
  await expect(confirm).toContainText("Fri 15 Jan, 19:30–20:30");
  await confirm.getByRole("button", { name: "Keep it" }).click();
  await expect(confirm).toBeHidden();
  await expect(eventButton(page, renamed)).toBeVisible();

  // Then delete it for real.
  await eventButton(page, renamed).click();
  await page
    .getByRole("dialog", { name: `Edit ${renamed}` })
    .getByRole("button", { name: "Delete…" })
    .click();
  await confirm.getByRole("button", { name: "Delete event" }).click();
  await expect(confirm).toBeHidden();
  await expect(eventButton(page, renamed)).toHaveCount(0);
});

test("on the kiosk, 19:00 in January and in July both stay 19:00", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-landscape", "The kiosk is an iPad in landscape.");
  const tag = Math.random().toString(36).slice(2, 8);
  const founder = `Founder ${project}`;

  await founderAdmin(page, project);
  const ipad = await pairedKiosk(browser, page, `iPad cal ${tag}`);
  const kiosk = ipad.page;
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  await kiosk.getByRole("link", { name: "Calendar" }).click();
  await expect(
    kiosk.getByRole("heading", { name: "Calendar", level: 1 }),
  ).toBeVisible();

  for (const [date, label] of [
    ["2027-01-15", "Fri 15 Jan"],
    ["2027-07-15", "Thu 15 Jul"],
  ] as const) {
    const title = `Kiosk ${date} ${tag}`;
    await kiosk.goto(`/kiosk/calendar?view=day&date=${date}`);
    await kiosk.getByRole("button", { name: "New event" }).click();
    const sheet = kiosk.getByRole("dialog", { name: "New event" });
    await expectKioskTargets(sheet);
    await sheet.getByLabel("Title").fill(title);
    await sheet.getByLabel("Date").fill(date);
    await sheet.getByLabel("Starts").fill("19:00");
    await sheet.getByLabel("Ends").fill("20:00");
    await sheet.getByRole("button", { name: "Add event" }).click();
    await expect(sheet).toBeHidden();
    await expect(eventButton(kiosk, title)).toContainText("19:00");

    // The phone reads it back from the calendar at 19:00 too, added by the
    // member acting on the kiosk.
    await page.goto(`/calendar?view=day&date=${date}`);
    await eventButton(page, title).click();
    const details = page.getByRole("dialog", { name: `Edit ${title}` });
    await expect(details.getByTestId("event-when")).toHaveText(
      `${label}, 19:00–20:00`,
    );
    await expect(details.getByTestId("event-added-by")).toHaveText(founder);
    await details.getByRole("button", { name: "Cancel" }).click();
  }
  await ipad.context.close();
});
