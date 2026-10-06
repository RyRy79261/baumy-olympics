import { expect, test, type Locator } from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import {
  expectKioskTargets,
  openBaumySheet,
  openKioskSettings as openSettings,
  pairedKiosk,
  setPersonalPin,
  typePin,
} from "../lib/kiosk";

// Issue #147 on the kitchen iPad (SPEC §12 decision 28): the screen's own
// Settings page sets how long it waits before it forgets who is acting
// (saved on this screen), and an admin, with their PIN, changes a bounty's
// points there and adds a bounty through Baumy. A member sees the idle
// setting but no admin card, and Baumy greys their bounty card.

const PIN = "1357";

async function say(sheet: Locator, text: string) {
  await sheet.getByLabel("Message to Baumy").fill(text);
  await sheet.getByRole("button", { name: "Send" }).click();
}

test("on the kiosk: the idle minutes, and an admin's points and bounty with a PIN", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const tag = Math.random().toString(36).slice(2, 8);
  const chore = `Fridge ${tag}`;
  // Sorts before the Fridge, so the Fridge is not the list's first option:
  // a form reset that falls back to the first option changed this one
  // instead (issue #177).
  const decoy = `Aardvark ${tag}`;
  const bounty = `Gutters ${tag}`;
  const founder = `Founder ${project}`;
  const partner = `Partner ${tag}`;

  await founderAdmin(page, project);
  await setPersonalPin(page, PIN);
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `kadmin-${project}`);
  await redeem(member.page, invite, partner);
  await expect(member.page).toHaveURL(/\/$/);
  await member.context.close();
  await addChore(page, { name: decoy, basePoints: 10, cooldownHours: 24 });
  await addChore(page, { name: chore, basePoints: 10, cooldownHours: 24 });

  const ipad = await pairedKiosk(browser, page, `iPad ${tag}`);
  const kiosk = ipad.page;

  // Nobody picked: the idle setting says to tap in first.
  await openSettings(kiosk);
  await expect(kiosk.getByText("Now: 2 min.")).toBeVisible();
  await expect(
    kiosk.getByText("Tap your avatar at the top to change it."),
  ).toBeVisible();

  // A member: the idle minutes, and no admin card.
  await kiosk.getByRole("button", { name: partner, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(partner);
  const idle = kiosk.getByRole("form", { name: "Forget who is acting after" });
  await expect(idle).toBeVisible();
  await expectKioskTargets(idle);
  await expect(
    idle.getByRole("button", { name: "2 min", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await idle.getByRole("button", { name: "5 min", exact: true }).click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: "after 5 min" }),
  ).toBeVisible();
  await expect(
    idle.getByRole("button", { name: "5 min", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(kiosk.getByTestId("kiosk-points-form")).toHaveCount(0);
  // Nor the bounty editor (issue #175).
  await expect(kiosk.getByTestId("bounty-bulk-editor")).toHaveCount(0);
  // It is this screen's: still 5 after a reload.
  await kiosk.reload();
  await expect(kiosk.getByText("Now: 5 min.")).toBeVisible();

  // The admin: the points form asks for their PIN in that request.
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  const points = kiosk.getByTestId("kiosk-points-form");
  await expect(points).toBeVisible();
  const picker = points.getByLabel("Bounty");
  await expect(picker.locator("option").first()).not.toHaveText(chore);
  await expect(picker.locator("option", { hasText: decoy })).toHaveCount(1);
  await picker.selectOption({ label: chore });
  await points.getByLabel("Points").fill("42");
  await points.getByLabel("Reason (optional)").fill("Takes ages");
  await expectKioskTargets(points);
  await points.getByRole("button", { name: "Schedule change" }).click();
  const pad = kiosk.getByRole("dialog", { name: `${founder}'s PIN` });
  await expect(pad).toBeVisible();
  // The fields are kept for the PIN's second send.
  await expect(picker.locator("option:checked")).toHaveText(chore);
  await expect(points.getByLabel("Points")).toHaveValue("42");
  await typePin(pad, PIN);
  await expect(pad).toBeHidden();
  // The toast names the bounty the server changed.
  await expect(
    kiosk.getByRole("status").filter({ hasText: `${chore}: Applies` }),
  ).toBeVisible();
  // The phone's Activity shows the change scheduled on the picked bounty,
  // and none on the list's first one.
  const scheduledOn = (name: string) =>
    page.locator(
      `[data-testid="activity-points-${name}"][data-event="scheduled"]`,
    );
  await page.goto("/activity");
  await expect(scheduledOn(chore)).toContainText("10 → 42 pts");
  await expect(scheduledOn(chore)).toContainText("Takes ages");
  await expect(scheduledOn(decoy)).toHaveCount(0);

  // A bounty through Baumy: the card needs the admin's PIN.
  const sheet = await openBaumySheet(kiosk);
  await say(sheet, `Add a bounty for ${bounty}, 15 points`);
  const card = sheet.getByTestId("suggestion-create_bounty");
  await expect(card).toContainText(`New bounty: ${bounty}`);
  await expect(card).toContainText("Needs your PIN");
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  await typePin(
    sheet.getByRole("group", { name: `${founder}'s PIN` }),
    PIN,
    "Confirm all",
  );
  await expect(card.getByTestId("proposal-state")).toHaveText("Done");
  await page.goto("/chores");
  await expect(page.getByTestId(`chore-${bounty}`)).toBeVisible();

  await ipad.context.close();
});
