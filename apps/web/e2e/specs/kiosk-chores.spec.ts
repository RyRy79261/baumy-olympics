import { expect, test } from "@playwright/test";
import { addChore, openChore, tile } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { expectKioskTargets, pairedKiosk, typePin } from "../lib/kiosk";

// Issue #14 on the kitchen iPad: the chore grid acts as the member whose
// avatar was tapped. The founder builds a streak of 2; the partner breaks it
// and sees STREAK BROKEN with the broken length; then the partner logs one
// FOR the founder, which needs the partner's PIN in that request.
//
// The chore has no cooldown, so the three logs can follow each other.

const PIN = "3690";

test("on the kiosk, break the partner's streak and log for someone else", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-landscape", "The kiosk is an iPad in landscape.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const chore = `Bins ${suffix}`;
  const founder = `Founder ${project}`;
  const partner = `Partner ${suffix}`;

  // The founder (admin) and a partner with a kiosk PIN.
  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `chores-${project}`);
  await redeem(member.page, invite, partner);
  await expect(member.page).toHaveURL(/\/$/);
  await member.page.goto("/settings");
  await member.page.getByLabel("PIN", { exact: true }).fill(PIN);
  await member.page.getByLabel("Type it again").fill(PIN);
  await member.page.getByRole("button", { name: "Set PIN" }).click();
  await expect(
    member.page.getByRole("status").filter({ hasText: "PIN saved." }),
  ).toBeVisible();

  await addChore(page, { name: chore, basePoints: 20, cooldownHours: 0 });
  const ipad = await pairedKiosk(browser, page, `iPad ${suffix}`);
  const kiosk = ipad.page;

  // The founder does it twice: a streak of 2.
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  for (const [points, streak] of [
    [20, 1],
    [25, 2],
  ]) {
    const sheet = await openChore(kiosk, chore);
    await expectKioskTargets(sheet);
    await expect(sheet.getByTestId("log-preview")).toContainText(
      `+${points}, streak ${streak}`,
    );
    await sheet.getByRole("button", { name: "Log it" }).click();
    await expect(sheet).toBeHidden();
    await expect(kiosk.getByTestId("score-pop")).toHaveText(`+${points}`);
    await expect(tile(kiosk, chore)).toContainText(
      `${founder} · streak ${streak}`,
    );
  }

  // The partner breaks it: 20 plus 20% of 20 per broken length.
  await kiosk.getByRole("button", { name: partner, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(partner);
  let sheet = await openChore(kiosk, chore);
  const preview = sheet.getByTestId("log-preview");
  await expect(preview).toContainText("+28, streak 1");
  await expect(preview).toContainText(
    `Breaks ${founder}'s streak of 2: +8 bonus`,
  );
  await sheet.getByRole("button", { name: "Log it" }).click();
  const banner = kiosk.getByTestId("streak-broken");
  await expect(banner).toContainText("STREAK BROKEN");
  await expect(banner).toContainText(
    `${founder}'s streak of 2 is over: +8 bonus.`,
  );
  await expect(kiosk.getByTestId("score-pop")).toHaveText("+28");
  await expect(tile(kiosk, chore)).toContainText(`${partner} · streak 1`);

  // The partner logs one for the founder: the partner's PIN, in the request.
  sheet = await openChore(kiosk, chore);
  await sheet.getByText(founder, { exact: true }).click();
  await expect(sheet.getByTestId("log-preview")).toContainText("+24, streak 1");
  await expect(sheet).toContainText("your PIN is needed");
  await sheet.getByRole("button", { name: "Log it" }).click();
  const pad = kiosk.getByRole("dialog", { name: `${partner}'s PIN` });
  await expect(pad).toBeVisible();
  await expectKioskTargets(pad);
  await typePin(pad, PIN);
  await expect(pad).toBeHidden();
  await expect(kiosk.getByTestId("score-pop")).toHaveText("+24");
  await expect(
    kiosk
      .getByRole("status")
      .filter({ hasText: `Logged ${chore} for ${founder}: +24.` }),
  ).toBeVisible();
  await expect(tile(kiosk, chore)).toContainText(`${founder} · streak 1`);

  await ipad.context.close();
  await member.context.close();
});
