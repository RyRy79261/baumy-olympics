import { expect, test, type Locator } from "@playwright/test";
import { addChore, openChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { openBaumySheet, openKioskChores, pairedKiosk } from "../lib/kiosk";

// Issue #145, as the household hit it: Felix talked to the kitchen cat and
// it asked for a PIN he never set. Now (owner ruling 2026-10-02, SPEC §12
// decision 27) a member with no PIN asks Baumy for a note, and Confirm all
// saves it with no PinPad; confirming a housemate's chore needs none
// either. Only a dispute needs the PIN, and for him the card waits under
// "Felix hasn't set a personal PIN yet" with a QR code to Settings, never a
// PinPad he cannot use.

async function say(sheet: Locator, text: string) {
  await sheet.getByLabel("Message to Baumy").fill(text);
  await sheet.getByRole("button", { name: "Send" }).click();
}

test("a member with no PIN: notes and confirming need none, a dispute shows how to set one", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const chore = `Kettle ${suffix}`;
  const note = `Bins out ${suffix}`;
  const founder = `Founder ${project}`;
  const felix = `Felix ${suffix}`;

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  // Felix joins and never sets a PIN.
  const member = await newAccount(browser, `knopin-${project}`);
  await redeem(member.page, invite, felix);
  await expect(member.page).toHaveURL(/\/$/);
  await member.context.close();

  await addChore(page, { name: chore, basePoints: 10, cooldownHours: 0 });
  const ipad = await pairedKiosk(browser, page, `iPad ${suffix}`);
  const kiosk = ipad.page;

  // The founder logs the chore twice, as their own claims.
  await openKioskChores(kiosk);
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  for (let i = 0; i < 2; i++) {
    const sheet = await openChore(kiosk, chore);
    await sheet.getByRole("button", { name: "Log it" }).click();
    await expect(sheet).toBeHidden();
  }

  // Felix taps in and asks the cat for a note: no PIN, no pad.
  await kiosk.getByRole("button", { name: felix, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(felix);
  const sheet = await openBaumySheet(kiosk);
  const pad = sheet.getByRole("group", { name: `${felix}'s PIN` });
  await say(sheet, `add a note: ${note}`);
  const noteCard = sheet.getByTestId("suggestion-create_note");
  await expect(noteCard).toContainText(note);
  await expect(noteCard).not.toContainText("Needs your PIN");
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  await expect(noteCard.getByTestId("proposal-state")).toHaveText("Done");
  await expect(pad).toHaveCount(0);
  await expect(sheet.getByTestId("no-pin-notice")).toHaveCount(0);

  // Confirming the founder's chore needs no PIN either.
  await say(sheet, `confirm the ${chore}`);
  const confirmCard = sheet.getByTestId("suggestion-confirm_completion");
  await expect(confirmCard).toContainText(chore);
  await expect(confirmCard).not.toContainText("Needs your PIN");
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  await expect(confirmCard.getByTestId("proposal-state")).toHaveText("Done");
  await expect(pad).toHaveCount(0);

  // A dispute does need a PIN, and Felix has none: no pad, but who has no
  // PIN, what it is for, and the QR code to Settings; the card waits.
  await say(sheet, `dispute the ${chore}`);
  const disputeCard = sheet.getByTestId("suggestion-dispute_completion");
  await expect(disputeCard).toContainText(chore);
  await expect(disputeCard).toContainText("Needs your PIN");
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  const notice = sheet.getByTestId("no-pin-notice");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(`${felix} hasn't set a personal PIN yet`);
  await expect(notice).toContainText("only to dispute a chore");
  await expect(
    notice.getByRole("img", {
      name: "QR code: set your personal PIN in Settings",
    }),
  ).toBeVisible();
  await expect(pad).toHaveCount(0);
  await expect(disputeCard.getByTestId("proposal-state")).toHaveText(
    "Waiting for you",
  );
  await expect(disputeCard).toContainText(
    `${felix} hasn't set a personal PIN yet.`,
  );

  // On the Board, the note is there, by Felix.
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await kiosk.goto("/kiosk/notes");
  await expect(kiosk.getByTestId(`note-${note}`)).toContainText(`By ${felix}`);

  await ipad.context.close();
});
