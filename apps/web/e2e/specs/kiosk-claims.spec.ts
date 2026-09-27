import { expect, test } from "@playwright/test";
import { addChore, openChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import {
  expectKioskTargets,
  openKioskChores,
  pairedKiosk,
  typePin,
} from "../lib/kiosk";

// Issue #15 on the kitchen iPad: the founder self-claims a chore on the
// kiosk; when the partner taps their avatar, the "Needs your OK" banner shows
// it, and confirming it asks for the partner's PIN in that request. The
// founder's own claims show there with Undo, which asks for their PIN.

const PIN = "2580";

test("on the kiosk, confirm a housemate's claim with a PIN; undo asks for one too", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-landscape", "The kiosk is an iPad in landscape.");
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

  // The founder logs it twice; the banner offers to undo them.
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  await openKioskChores(kiosk);
  for (let i = 0; i < 2; i++) {
    const sheet = await openChore(kiosk, chore);
    await sheet.getByRole("button", { name: "Log it" }).click();
    await expect(sheet).toBeHidden();
  }
  const banner = kiosk.getByTestId("needs-ok-banner");
  const mine = banner.getByTestId(`claim-${chore}`);
  await expect(mine).toHaveCount(2);
  await expectKioskTargets(mine.first());
  await mine.first().getByRole("button", { name: "Undo" }).click();
  // On the kiosk, undo asks for the logger's PIN too; the founder backs out.
  const founderPad = kiosk.getByRole("dialog", { name: `${founder}'s PIN` });
  await expect(founderPad).toBeVisible();
  await founderPad.getByRole("button", { name: "Cancel" }).click();

  // The partner taps in: the banner counts what waits on them.
  await kiosk.getByRole("button", { name: partner, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(partner);
  await expect(
    banner.getByRole("heading", { name: /^\d+ claims? needs? your OK$/ }),
  ).toBeVisible();
  const theirs = banner.getByTestId(`claim-${chore}`).first();
  await expect(theirs).toContainText(`${founder} did ${chore}`);
  await theirs.getByRole("button", { name: "Confirm" }).click();
  const pad = kiosk.getByRole("dialog", { name: `${partner}'s PIN` });
  await expect(pad).toBeVisible();
  await expectKioskTargets(pad);
  await typePin(pad, PIN);
  await expect(pad).toBeHidden();
  await expect(
    kiosk
      .getByRole("status")
      .filter({ hasText: `Confirmed: ${founder} did ${chore}.` }),
  ).toBeVisible();
  await expect(banner.getByTestId(`claim-${chore}`)).toHaveCount(1);

  await ipad.context.close();
  await member.context.close();
});
