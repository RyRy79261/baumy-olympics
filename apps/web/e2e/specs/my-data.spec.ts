import { expect, test, type Locator, type Page } from "@playwright/test";
import { PHOTO_RETENTION_DAYS } from "@baumy/core";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #144, with the scripted fake Claude (lib/integrations/claude-fake.ts):
// a member asks Baumy "what do you keep about me?", Baumy reads get_my_data
// and answers with their own counts, the retention rules and the privacy
// page, with nothing to approve. Settings shows the same in "Your data".
//
// The member joins for this run only, so their counts are theirs alone.

async function openBaumy(page: Page): Promise<Locator> {
  await page.goto("/");
  await page.getByRole("button", { name: "Ask Baumy" }).click();
  const sheet = page.getByRole("dialog", { name: "Ask Baumy" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("a member asks what Baumy keeps about them and sees their counts and the retention rules", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(
    project === "ipad-portrait",
    "The kitchen iPad never shows one member's data.",
  );
  const tag = Math.random().toString(36).slice(2, 8);
  const player = `Curious ${tag}`;
  const title = `Mine ${tag}`;

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `my-data-${project}`);
  await redeem(member.page, invite, player);
  await expect(member.page).toHaveURL(/\/$/);
  const me = member.page;

  // One note of their own, so there is something to count.
  await me.goto("/notes");
  await me.getByRole("button", { name: "New note" }).click();
  const noteSheet = me.getByRole("dialog", { name: "New note" });
  await noteSheet.getByLabel("Title").fill(title);
  await noteSheet.getByLabel("Note").fill("Private thoughts");
  await noteSheet.getByRole("button", { name: "Add note" }).click();
  await expect(noteSheet).toBeHidden();
  await expect(me.getByTestId(`note-${title}`)).toBeVisible();

  const sheet = await openBaumy(me);
  await sheet.getByLabel("Message to Baumy").fill("What do you keep about me?");
  await sheet.getByRole("button", { name: "Send" }).click();
  const says = sheet.getByTestId("baumy-says");
  await expect(says).toContainText("Here's what I keep about you:");
  await expect(says).toContainText(
    "0 completions, 1 note (0 deleted but kept), 0 proof photos",
  );
  await expect(says).toContainText(/\d+ audit-log entr(y|ies)/);
  await expect(says).toContainText(/1 Baumy command and \d+ signed-in device/);
  await expect(says).toContainText(
    `Proof photos are deleted ${PHOTO_RETENTION_DAYS} days after their claim settles`,
  );
  await expect(says).toContainText("/privacy");
  // Nothing written leaks into the answer, and there is nothing to approve.
  await expect(says).not.toContainText("Private thoughts");
  await expect(
    sheet.getByRole("region", { name: "Baumy's suggestions" }),
  ).toHaveCount(0);

  // Settings shows the same answer, with the rules and the policy link.
  await me.goto("/settings");
  const card = me.getByTestId("your-data");
  await expect(card).toBeVisible();
  await expect(card.getByTestId("your-data-notes")).toContainText(
    "1 written, 0 deleted but kept",
  );
  await expect(card.getByTestId("your-data-completions")).toContainText("0");
  await expect(card.getByTestId("your-data-photos")).toContainText("none");
  await expect(card.getByTestId("your-data-ai")).toContainText("1 command");
  await expect(card.getByTestId("your-data-profile")).toContainText(player);
  await expect(card.getByTestId("your-data-retention")).toContainText(
    `Proof photos are deleted ${PHOTO_RETENTION_DAYS} days after their claim was settled.`,
  );
  await card.getByRole("link", { name: "privacy page" }).click();
  await expect(me).toHaveURL(/\/privacy$/);
  await expect(
    me.getByRole("heading", { name: "Privacy", level: 1 }),
  ).toBeVisible();
  await member.context.close();
});
