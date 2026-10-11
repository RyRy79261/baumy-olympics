import { expect, test, type Page } from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { expectKioskTargets, kioskNav, pairedKiosk } from "../lib/kiosk";

// Issue #194 (owner, 2026-10-11: "a message has been on the board for weeks
// and it looks new, theres no way to get rid of it"): on the kitchen screen
// every note has a big Remove for whoever is picked, with no PIN. It asks
// "Remove this note?" first; "Keep it" backs out. With nobody picked the
// screen says how to start instead. The same Remove is in the home's
// Messages list.
//
// The notes are shared by the specs running in parallel, so each has a name
// of its own.

async function addNote(page: Page, title: string) {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  const sheet = page.getByRole("dialog", { name: "New note" });
  await sheet.getByLabel("Title").fill(title);
  await sheet.getByRole("button", { name: "Add note" }).click();
  await expect(sheet).toBeHidden();
}

test("remove a note from the kitchen Board and from Messages, with no PIN", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "mobile-360", "Paired from the phone project.");
  const tag = Math.random().toString(36).slice(2, 8);
  const fridge = `Fridge tag ${tag}`;
  const parcel = `Parcel ${tag}`;
  const founder = `Founder ${project}`;
  await founderAdmin(page, project);
  await addNote(page, fridge);
  await addNote(page, parcel);
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${tag}`,
  );

  // Nobody picked: the note is there, with no Remove, and the page says how
  // to start.
  await kioskNav(kiosk, "Board");
  const note = kiosk.getByTestId(`note-${fridge}`);
  await expect(note).toBeVisible();
  await expect(
    kiosk.getByText(
      "Tap your avatar at the top to add, change or remove a note.",
    ),
  ).toBeVisible();
  await expect(
    note.getByRole("button", { name: `Remove ${fridge}` }),
  ).toHaveCount(0);
  await expect(kiosk.getByText(/asks for your PIN/)).toHaveCount(0);

  // Picked: a 56px Remove on every note.
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  const remove = note.getByRole("button", { name: `Remove ${fridge}` });
  await expect(remove).toBeVisible();
  await expectKioskTargets(note);
  const box = (await remove.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(56);
  await expect(kiosk.getByText(/asks for your PIN/)).toHaveCount(0);

  // It asks first; Keep it keeps the note.
  await remove.click();
  const confirm = kiosk.getByRole("group", { name: `Remove ${fridge}?` });
  await expect(confirm).toContainText("Remove this note?");
  await confirm.getByRole("button", { name: "Keep it" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(note).toBeVisible();

  // Remove, then Remove again: gone, with no PIN pad on the way.
  await note.getByRole("button", { name: `Remove ${fridge}` }).click();
  await confirm.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Removed ${fridge}.` }),
  ).toBeVisible();
  await expect(kiosk.getByRole("dialog")).toHaveCount(0);
  await expect(note).toHaveCount(0);
  await expect(kiosk.getByTestId(`note-${parcel}`)).toBeVisible();
  // Gone for everyone: the phone's Board no longer has it.
  await page.goto("/notes");
  await expect(page.getByTestId(`note-${parcel}`)).toBeVisible();
  await expect(page.getByTestId(`note-${fridge}`)).toHaveCount(0);

  // The home's Messages list has the same Remove for whoever is picked.
  await kioskNav(kiosk, "Home");
  await kiosk.locator('[data-icon="messages"]').click();
  const messages = kiosk.getByRole("dialog", { name: "Messages" });
  const row = messages.getByTestId(`message-${parcel}`);
  await expect(row).toBeVisible();
  await expect(messages.getByTestId("messages-pick-hint")).toHaveCount(0);
  await row.getByRole("button", { name: `Remove ${parcel}` }).click();
  await row
    .getByRole("group", { name: `Remove ${parcel}?` })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(row).toHaveCount(0);
  await messages.getByRole("button", { name: "Close" }).click();
  await kioskNav(kiosk, "Board");
  await expect(kiosk.getByTestId(`note-${parcel}`)).toHaveCount(0);

  // With nobody picked, Messages says how to start, and has no Remove.
  await addNote(page, `Bins day ${tag}`);
  await kioskNav(kiosk, "Home");
  const done = kiosk
    .getByTestId("acting-chip")
    .getByRole("button", { name: "Done" });
  await done.click();
  await expect(kiosk.getByTestId("acting-chip")).toHaveCount(0);
  await kiosk.locator('[data-icon="messages"]').click();
  await expect(messages.getByTestId(`message-Bins day ${tag}`)).toBeVisible();
  await expect(messages.getByTestId("messages-pick-hint")).toHaveText(
    "To remove a note, close this and tap your avatar at the top.",
  );
  await expect(messages.getByRole("button", { name: /^Remove / })).toHaveCount(
    0,
  );

  await context.close();
});
