import { expect, test, type Locator, type Page } from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import {
  expectKioskTargets,
  openKioskChores,
  pairedKiosk,
  typePin,
} from "../lib/kiosk";

// Issue #21 on the kitchen iPad, with the scripted fake Claude: the founder
// logs a chore through Baumy (their own claim, no PIN); the partner then
// asks Baumy to confirm it, and approving that proposal opens the PIN pad
// in the row: a wrong PIN saves nothing, the right one confirms it.

const PIN = "2580";

async function openBaumy(kiosk: Page): Promise<Locator> {
  await kiosk.getByRole("button", { name: "Ask Baumy" }).click();
  const sheet = kiosk.getByRole("dialog", { name: "Ask Baumy" });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function say(sheet: Locator, text: string) {
  await sheet.getByLabel("Message to Baumy").fill(text);
  await sheet.getByRole("button", { name: "Send" }).click();
}

test("on the kiosk, approving Baumy's confirmation asks for the PIN", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const chore = `Kettle ${suffix}`;
  const founder = `Founder ${project}`;
  const partner = `Partner ${suffix}`;

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `kbaumy-${project}`);
  await redeem(member.page, invite, partner);
  await expect(member.page).toHaveURL(/\/$/);
  await member.page.goto("/settings");
  await member.page.getByLabel("PIN", { exact: true }).fill(PIN);
  await member.page.getByLabel("Type it again").fill(PIN);
  await member.page.getByRole("button", { name: "Set PIN" }).click();
  await expect(
    member.page.getByRole("status").filter({ hasText: "PIN saved." }),
  ).toBeVisible();

  await addChore(page, { name: chore, basePoints: 10, cooldownHours: 0 });
  const ipad = await pairedKiosk(browser, page, `iPad ${suffix}`);
  const kiosk = ipad.page;

  // Nobody tapped in: Baumy asks who is there.
  let sheet = await openBaumy(kiosk);
  await say(sheet, `I cleaned the ${chore}`);
  await expect(sheet.getByTestId("baumy-says")).toHaveText(
    "Tap your avatar first, then ask Baumy.",
  );

  // On the dashboard the avatars are in the sheet itself: the founder taps
  // in there and logs it through Baumy (their own claim needs no PIN).
  const who = sheet.getByRole("region", { name: "Who's asking?" });
  await expect(who).toBeVisible();
  await expectKioskTargets(who);
  await who.getByRole("button", { name: founder, exact: true }).click();
  await expect(who).toHaveCount(0);
  await say(sheet, `I cleaned the ${chore}`);
  const log = sheet.getByTestId("proposal-log_completion");
  await expect(log).toContainText(`Log ${chore} for ${founder}: +10`);
  await expect(log).not.toContainText("Needs your PIN");
  await expectKioskTargets(sheet);
  await log.getByRole("button", { name: "Approve" }).click();
  await expect(log.getByTestId("proposal-state")).toHaveText("Done");
  await sheet.getByRole("button", { name: "Close" }).click();

  // The partner asks Baumy to confirm it (tapping in on another page, where
  // the avatar bar is): the row needs their PIN.
  await openKioskChores(kiosk);
  await kiosk.getByRole("button", { name: partner, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(partner);
  sheet = await openBaumy(kiosk);
  await say(sheet, `confirm the ${chore}`);
  const confirm = sheet.getByTestId("proposal-confirm_completion");
  await expect(confirm).toContainText(chore);
  await expect(confirm).toContainText("Needs your PIN");
  await confirm.getByRole("button", { name: "Approve" }).click();
  let pad = confirm.getByRole("group", { name: `${partner}'s PIN` });
  await expect(pad).toBeVisible();
  await expectKioskTargets(confirm);

  // A wrong PIN saves nothing.
  await typePin(pad, "1397");
  await expect(confirm.getByText("That PIN is not right.")).toBeVisible();
  await expect(confirm.getByTestId("proposal-state")).toHaveText(
    "Waiting for you",
  );

  // The right one confirms it.
  await confirm.getByRole("button", { name: "Approve" }).click();
  pad = confirm.getByRole("group", { name: `${partner}'s PIN` });
  await typePin(pad, PIN);
  await expect(confirm.getByTestId("proposal-state")).toHaveText("Done");

  await ipad.context.close();
  await member.context.close();
});
