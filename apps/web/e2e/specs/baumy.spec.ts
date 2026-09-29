import { expect, test, type Locator, type Page } from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #21 (SPEC §10 flow 7), with the scripted fake Claude
// (lib/integrations/claude-fake.ts): a member types "I took out the …" to
// Baumy, sees a log_completion suggestion card with its points, confirms it
// (Confirm all), and the scoreboard counts it once, even when the approval is
// sent again.
// "Who's winning?" is answered with no proposal.
//
// The member joins for this run only, so specs running in parallel on the
// same database cannot move their total.

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

test("type a chore to Baumy, approve it, and the scoreboard counts it once", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-portrait", "The kiosk has its own spec.");
  const tag = Math.random().toString(36).slice(2, 8);
  const chore = `Pail ${tag}`;
  const player = `Asker ${tag}`;

  await founderAdmin(page, project);
  await addChore(page, { name: chore, basePoints: 20, cooldownHours: 48 });
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `baumy-${project}`);
  await redeem(member.page, invite, player);
  await expect(member.page).toHaveURL(/\/$/);
  const me = member.page;

  // A question is answered in the bubble, with nothing to approve.
  let sheet = await openBaumy(me);
  await say(sheet, "Who's winning?");
  const says = sheet.getByTestId("baumy-says");
  await expect(says).toContainText(
    /is winning with \d+ points|Nobody is ahead/,
  );
  await expect(sheet.getByTestId("suggestion-log_completion")).toHaveCount(0);
  await expect(
    sheet.getByRole("region", { name: "Baumy's suggestions" }),
  ).toHaveCount(0);

  // A chore is proposed with the points it will score; nothing is logged yet.
  await say(sheet, `I took out the ${chore}`);
  await expect(says).toContainText(`logging ${chore}`);
  const row = sheet.getByTestId("suggestion-log_completion");
  await expect(row).toContainText(`Log ${chore} for ${player}: +20 (streak 1)`);
  await expect(row.getByTestId("proposal-state")).toHaveText("Waiting for you");
  await expect(
    sheet.getByRole("button", { name: "Confirm all" }),
  ).toBeVisible();
  // Cancel rejects it and closes the sheet.
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await me.goto("/scores");
  const standing = me.getByTestId(`standing-${player}`);
  await expect(standing.getByTestId("points")).toHaveText("0");

  // Confirm all: it saves once, with the previewed points.
  sheet = await openBaumy(me);
  await say(sheet, `I took out the ${chore}`);
  const run = me.waitForRequest("**/api/actions/run");
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  const approved = await run;
  await expect(
    sheet
      .getByTestId("suggestion-log_completion")
      .getByTestId("proposal-state"),
  ).toHaveText("Done");
  await expect(sheet.getByTestId("suggestion-log_completion")).toContainText(
    "Saved: +20 points.",
  );
  await sheet.getByRole("button", { name: "Done" }).click();

  // The same approval again (a retry, a double tap) replays the stored
  // result instead of logging it twice.
  const first = await (await approved.response())!.json();
  const again = await me.evaluate(async (body) => {
    const res = await fetch("/api/actions/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    return res.json();
  }, approved.postData()!);
  expect(first.ok).toBe(true);
  expect(again).toEqual(first);

  await me.goto("/scores");
  await expect(standing.getByTestId("points")).toHaveText("20");
  await expect(
    me.getByTestId("recent").getByRole("row").filter({ hasText: chore }),
  ).toHaveCount(1);
  await member.context.close();
});
