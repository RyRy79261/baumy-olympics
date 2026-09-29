import { expect, test, type Locator, type Page } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #107 with the scripted fake Claude (lib/integrations/claude-fake.ts):
// an admin asks Baumy to add a bounty and to put money in the pot; each is
// a suggestion card, and Confirm all makes it real (the Bounties page and
// the pot show it). A member asking the same gets a greyed card that says
// only an admin can, and nothing to confirm.

async function openBaumy(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: "Ask Baumy" }).click();
  const sheet = page.getByRole("dialog", { name: "Ask Baumy" });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function say(sheet: Locator, text: string) {
  await sheet.getByLabel("Message to Baumy").fill(text);
  await sheet.getByRole("button", { name: "Send" }).click();
}

test("an admin asks Baumy for a bounty and pot money, and confirms them", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-portrait", "Admin work is for a phone.");
  const tag = Math.random().toString(36).slice(2, 8);
  const bounty = `Recycling ${tag}`;
  const cents = String(10 + Math.floor(Math.random() * 89));
  const amount = `3${cents.slice(0, 1)}.${cents}`;

  await founderAdmin(page, project);

  // A bounty: one card in plain words, nothing on the board until confirmed.
  let sheet = await openBaumy(page);
  await say(sheet, `Add a bounty for ${bounty}, 15 points`);
  const card = sheet.getByTestId("suggestion-create_bounty");
  await expect(card).toContainText(
    `New bounty: ${bounty} · maintenance · 15 pts`,
  );
  await expect(card.getByTestId("proposal-state")).toHaveText(
    "Waiting for you",
  );
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  await expect(card.getByTestId("proposal-state")).toHaveText("Done");
  await sheet.getByRole("button", { name: "Done" }).click();
  await page.goto("/chores");
  await expect(page.getByTestId(`chore-${bounty}`)).toBeVisible();

  // Money in the pot.
  sheet = await openBaumy(page);
  await say(sheet, `put €${amount} in the pot`);
  const pot = sheet.getByTestId("suggestion-add_pot_contribution");
  await expect(pot).toContainText(`Add €${amount} to the pot`);
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  await expect(pot.getByTestId("proposal-state")).toHaveText("Done");
  await page.goto("/pot");
  await expect(page.getByTestId("pot-months")).toContainText(`€${amount}`);

  // A member asking the same gets a greyed card that cannot run.
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `baumy-admin-${project}`);
  await redeem(member.page, invite, `Housemate ${tag}`);
  await expect(member.page).toHaveURL(/\/$/);
  sheet = await openBaumy(member.page);
  await say(sheet, `Add a bounty for Other ${tag}, 5 points`);
  const refused = sheet.getByTestId("suggestion-create_bounty");
  await expect(refused).toContainText(`New bounty: Other ${tag}`);
  await expect(refused).toHaveAttribute("data-tone", "invalid");
  await expect(refused).toContainText("Only a household admin can do this.");
  await expect(
    sheet.getByRole("button", { name: "Confirm all" }),
  ).toBeDisabled();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await member.page.goto("/chores");
  await expect(
    member.page.getByRole("heading", { name: "Bounties", level: 1 }),
  ).toBeVisible();
  await expect(member.page.getByTestId(`chore-Other ${tag}`)).toHaveCount(0);
  await member.context.close();
});
