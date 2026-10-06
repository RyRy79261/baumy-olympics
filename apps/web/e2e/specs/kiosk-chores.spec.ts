import { expect, test } from "@playwright/test";
import { addChore, openChore, tile } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { expectKioskTargets, openKioskChores, pairedKiosk } from "../lib/kiosk";

// Issue #14 on the kitchen iPad: the chore grid acts as the member whose
// avatar was tapped. The founder builds a streak of 2; the partner breaks it
// and sees STREAK BROKEN with the broken length; then the partner logs one
// FOR the founder, which vouches for them and, since the owner's ruling of
// 2026-10-02 (issue #145), needs no PIN.
//
// The chore has no cooldown, so the three logs can follow each other.

const PIN = "3690";

test("on the kiosk, break the partner's streak and log for someone else", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
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
  await openKioskChores(kiosk);
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

  // The partner logs one for the founder: a vouch, with no PIN.
  sheet = await openChore(kiosk, chore);
  await sheet.getByText(founder, { exact: true }).click();
  await expect(sheet.getByTestId("log-preview")).toContainText("+24, streak 1");
  await expect(sheet).toContainText(`You are vouching that ${founder} did it.`);
  await expect(sheet).not.toContainText("your PIN is needed");
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(kiosk.getByTestId("score-pop")).toHaveText("+24");
  await expect(
    kiosk.getByRole("dialog", { name: `${partner}'s PIN` }),
  ).toBeHidden();
  await expect(
    kiosk
      .getByRole("status")
      .filter({ hasText: `Logged ${chore} for ${founder}: +24.` }),
  ).toBeVisible();
  await expect(tile(kiosk, chore)).toContainText(`${founder} · streak 1`);

  await ipad.context.close();
  await member.context.close();
});

// Issue #181, owner ruling 2026-10-06: the floating "+N" says the toast's
// points and floats where the bounty was when it was tapped, though logging
// re-sorts the board (its cooldown sends it to the end); the page never
// scrolls. The logged bounty is not the first row.
test("on the kiosk, the floating score floats where the bounty was tapped", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const first = `Aaa first ${suffix}`;
  const chore = `Take the bins out ${suffix}`;
  const founder = `Founder ${project}`;

  await founderAdmin(page, project);
  await addChore(page, { name: first, basePoints: 26, cooldownHours: 0 });
  await addChore(page, { name: chore, basePoints: 5, cooldownHours: 24 });
  const ipad = await pairedKiosk(browser, page, `iPad ${suffix}`);
  const kiosk = ipad.page;
  await openKioskChores(kiosk);
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);

  const rows = kiosk.getByRole("list", { name: "Bounties" }).locator("li");
  const order = () =>
    rows.evaluateAll((lis) => lis.map((li) => li.getAttribute("data-testid")));
  await expect(rows.first()).toBeVisible();
  const before = await order();
  expect(before).toContain(`chore-${first}`);
  expect(before.indexOf(`chore-${chore}`)).toBeGreaterThan(0);

  // Where the row is on the screen when it is tapped, and where the page is.
  const row = tile(kiosk, chore);
  await row.scrollIntoViewIfNeeded();
  const tapped = (await row.boundingBox())!;
  const heading = kiosk.getByRole("heading", { name: "Bounties", level: 1 });
  const headingY = (await heading.boundingBox())!.y;
  const sheet = await openChore(kiosk, chore);
  await expect(sheet.getByTestId("log-preview")).toContainText("+5, streak 1");
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(sheet).toBeHidden();

  const toast = kiosk
    .getByRole("status")
    .filter({ hasText: `Logged ${chore} for ${founder}:` });
  await expect(toast).toContainText(`Logged ${chore} for ${founder}: +5.`);
  const pop = kiosk.getByTestId("score-pop");
  await expect(pop).toHaveText("+5");
  const box = (await pop.boundingBox())!;
  // The board re-sorted: the logged bounty went to the end.
  await expect.poll(async () => (await order()).at(-1)).toBe(`chore-${chore}`);
  // The "+5" sits where the row was tapped (give or take the 6px hop).
  const middle = box.y + box.height / 2;
  expect(middle).toBeGreaterThanOrEqual(tapped.y);
  expect(middle).toBeLessThanOrEqual(tapped.y + tapped.height);
  expect(Math.abs(box.x - tapped.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - tapped.width)).toBeLessThanOrEqual(1);
  // And the page did not scroll.
  expect((await heading.boundingBox())!.y).toBe(headingY);

  await ipad.context.close();
});
