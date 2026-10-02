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
// it. Since the owner's ruling of 2026-10-02 (issue #145, SPEC §12 decision
// 27) only a dispute asks for the PIN: the founder (who never set a PIN)
// undoes one of their own claims and the partner confirms one with no PIN,
// then disputes the last with theirs.

const PIN = "2580";

test("on the kiosk, undo and confirm need no PIN; a dispute asks for one", async ({
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

  // The founder logs it three times; the banner offers to undo them.
  await openKioskChores(kiosk);
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  for (let i = 0; i < 3; i++) {
    const sheet = await openChore(kiosk, chore);
    await sheet.getByRole("button", { name: "Log it" }).click();
    await expect(sheet).toBeHidden();
  }
  const banner = kiosk.getByTestId("needs-ok-banner");
  const mine = banner.getByTestId(`claim-${chore}`);
  await expect(mine).toHaveCount(3);
  await expectKioskTargets(mine.first());
  // Undo needs no PIN on the kiosk, so the founder's missing PIN is fine.
  await mine.first().getByRole("button", { name: "Undo" }).click();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Undid ${chore}.` }),
  ).toBeVisible();
  await expect(mine).toHaveCount(2);
  await expect(
    kiosk.getByRole("dialog", { name: `${founder}'s PIN` }),
  ).toBeHidden();

  // The partner taps in: the banner counts what waits on them.
  await kiosk.getByRole("button", { name: partner, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(partner);
  await expect(
    banner.getByRole("heading", { name: /^\d+ claims? needs? your OK$/ }),
  ).toBeVisible();
  const theirs = banner.getByTestId(`claim-${chore}`);
  await expect(theirs.first()).toContainText(`${founder} did ${chore}`);
  // Confirming asks no PIN.
  await theirs.first().getByRole("button", { name: "Confirm" }).click();
  await expect(
    kiosk
      .getByRole("status")
      .filter({ hasText: `Confirmed: ${founder} did ${chore}.` }),
  ).toBeVisible();
  await expect(
    kiosk.getByRole("dialog", { name: `${partner}'s PIN` }),
  ).toBeHidden();
  await expect(theirs).toHaveCount(1);

  // Disputing does: the pad opens in that request.
  await theirs.getByRole("button", { name: "Dispute" }).click();
  await theirs.getByLabel("Why was it not done?").fill("Still dirty");
  await theirs.getByRole("button", { name: "Send dispute" }).click();
  const pad = kiosk.getByRole("dialog", { name: `${partner}'s PIN` });
  await expect(pad).toBeVisible();
  await expectKioskTargets(pad);
  await typePin(pad, PIN);
  await expect(pad).toBeHidden();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Disputed ${chore}.` }),
  ).toBeVisible();

  await ipad.context.close();
  await member.context.close();
});
