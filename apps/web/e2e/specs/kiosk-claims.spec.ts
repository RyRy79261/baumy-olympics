import { expect, test } from "@playwright/test";
import { addChore, openChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import {
  expectKioskTargets,
  openKioskActivity,
  openKioskChores,
  pairedKiosk,
  typePin,
} from "../lib/kiosk";

// Issue #15 on the kitchen iPad, in the activity log (issue #150): the
// founder self-claims a chore twice on the kiosk, and Activity (in the
// footer nav) lists both, newest first, as it does with nobody picked. The
// founder (who never set a PIN) undoes one with no PIN (§12 decision 27).
// The partner taps in: there is no Confirm, only Dispute, which asks for
// their PIN in that request.

const PIN = "2580";

test("on the kiosk's Activity, undo needs no PIN, a dispute asks for one, and nothing confirms", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const chore = `Sink ${suffix}`;
  const founder = `Founder ${project}`;
  const partner = `Partner ${suffix}`;

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `kclaims-${project}`);
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

  // With nobody picked, the log is there to read, without buttons.
  await openKioskActivity(kiosk);
  await expect(kiosk.getByTestId(`activity-bounty-${chore}`)).toContainText(
    `${founder} added the bounty ${chore}.`,
  );

  // The founder logs it twice; the Bounties page has no banner any more.
  await openKioskChores(kiosk);
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  for (let i = 0; i < 2; i++) {
    const sheet = await openChore(kiosk, chore);
    await sheet.getByRole("button", { name: "Log it" }).click();
    await expect(sheet).toBeHidden();
  }
  await expect(kiosk.getByText(/needs? your OK/)).toHaveCount(0);

  await openKioskActivity(kiosk);
  const entries = kiosk.getByTestId(`activity-chore-${chore}`);
  await expect(entries).toHaveCount(2);
  await expect(entries.first()).toContainText(`${founder} did ${chore}`);
  await expect(entries.first()).toContainText("+");
  await expectKioskTargets(entries.first());
  // Undo needs no PIN on the kiosk, so the founder's missing PIN is fine.
  await entries.first().getByRole("button", { name: "Undo" }).click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Undid ${chore}.` }),
  ).toBeVisible();
  await expect(entries.first()).toHaveAttribute("data-status", "voided");
  await expect(entries.first()).toContainText("Voided (undone).");
  await expect(
    kiosk.getByRole("dialog", { name: `${founder}'s PIN` }),
  ).toBeHidden();

  // The partner taps in: Dispute on the claim still open, never Confirm.
  await kiosk.getByRole("button", { name: partner, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(partner);
  const open = kiosk.locator(
    `[data-testid="activity-chore-${chore}"][data-status="pending"]`,
  );
  await expect(open).toHaveCount(1);
  await expect(open.getByRole("button", { name: "Dispute" })).toBeVisible();
  await expect(open.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await expect(open.getByRole("button", { name: "Undo" })).toHaveCount(0);

  // Disputing asks for the PIN in that request.
  await open.getByRole("button", { name: "Dispute" }).click();
  await open.getByLabel("Why was it not done?").fill("Still dirty");
  await open.getByRole("button", { name: "Send dispute" }).click();
  const pad = kiosk.getByRole("dialog", { name: `${partner}'s PIN` });
  await expect(pad).toBeVisible();
  await expectKioskTargets(pad);
  await typePin(pad, PIN);
  await expect(pad).toBeHidden();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Disputed ${chore}.` }),
  ).toBeVisible();
  await expect(kiosk.getByTestId(`activity-dispute-${chore}`)).toContainText(
    `${partner} disputed ${founder}'s ${chore}: "Still dirty". Open.`,
  );

  await ipad.context.close();
  await member.context.close();
});
