import { expect, test } from "@playwright/test";
import { founderAdmin, mintCode, newAccount } from "../lib/household";
import { pickTile, tileRadio } from "../lib/pickers";
import { MEMBER_COLORS, TELEGRAM_ID_MESSAGE } from "@baumy/types";

// Issue #106: pickers show the thing, not its name. A newcomer picks a
// colour swatch on /join (tap and keyboard); with no gallery character they
// show as their initial in that colour (issue #116: nothing draws a person,
// so there is no hair, skin or shirt to pick); the admin sees that tile and
// the swatches on the member card (with the Telegram id help), and picks a
// chore's icon.

const ROSE = MEMBER_COLORS[5];
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

test.describe.configure({ mode: "default" });

test("a newcomer picks a colour on /join and shows as their initial in it", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.setTimeout(180_000);
  const name = `Picky ${Math.random().toString(36).slice(2, 8)}`;
  await founderAdmin(page, project);
  const code = await mintCode(page, 1);

  const jo = await newAccount(browser, `picker-${project}`);
  await expect(jo.page).toHaveURL(/\/join$/);
  const form = jo.page.locator("form").filter({
    has: jo.page.getByRole("button", { name: "Join the household" }),
  });
  await form.getByLabel("Invite code").fill(code);
  await form.getByLabel("Your name").fill(name);

  // Colours are swatches named by colour; no hex is shown.
  const orange = tileRadio(form, "Colour", "Orange");
  await expect(orange).toBeChecked();
  await expect(form.getByTestId("invite-color")).not.toContainText("#");
  await pickTile(form, "Colour", "Rose");
  await expect(tileRadio(form, "Colour", "Rose")).toBeChecked();
  await expect(orange).not.toBeChecked();

  // The keyboard moves through the swatches as through any radio group.
  await tileRadio(form, "Colour", "Rose").focus();
  await jo.page.keyboard.press("ArrowLeft");
  await expect(tileRadio(form, "Colour", "Mustard")).toBeChecked();
  await jo.page.keyboard.press("ArrowRight");
  await expect(tileRadio(form, "Colour", "Rose")).toBeChecked();
  // Nothing to draw a person with (issue #116).
  await expect(form.getByRole("group", { name: "Colour" })).toBeVisible();
  await expect(form.getByRole("group", { name: "Hair style" })).toHaveCount(0);
  await expect(form.getByTestId("avatar-preview")).toHaveCount(0);

  await form.getByRole("button", { name: "Join the household" }).click();
  await expect(jo.page).toHaveURL(/\/$/);

  // The header: their initial, in Rose.
  const mine = jo.page.getByTestId("account-menu");
  const tile = mine.locator("[data-member-initial]").first();
  await expect(tile).toHaveText("P");
  await expect(tile).toHaveCSS("background-color", rgb(ROSE));
  await expect(mine.locator("[data-housemate]")).toHaveCount(0);
  await jo.context.close();

  // The admin's member card: the same tile, the colour as swatches (Rose
  // chosen), and no legacy avatar select.
  await page.goto("/admin/members");
  const card = page.getByTestId(`member-${name}`);
  await card.getByText("Edit name and colour").click();
  const cardTile = card.locator("[data-member-initial]").first();
  await expect(cardTile).toHaveText("P");
  await expect(cardTile).toHaveCSS("background-color", rgb(ROSE));
  await expect(tileRadio(card, "Colour", "Rose")).toBeChecked();
  await expect(
    card.getByText(`Only ${name} can change their character`),
  ).toBeVisible();
  await expect(card.getByLabel("Avatar")).toHaveCount(0);
});

// React resets a form after every action, which puts radios back to their
// page-load choice while the tiles still show the pick (issue #106 review).
// Each form here is submitted twice without a reload (the join after a
// failure, the admin card saved twice); the second submit must still send
// what the tiles show.
test("picks survive a failed join and a second save", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.setTimeout(180_000);
  const name = `Twice ${Math.random().toString(36).slice(2, 8)}`;
  await founderAdmin(page, project);
  const code = await mintCode(page, 1);
  const posted = (p: typeof page) =>
    p.waitForResponse((r) => r.request().method() === "POST");

  // A wrong code first, then the right one: the join keeps the colour
  // picked before the failure.
  const jo = await newAccount(browser, `twice-${project}`);
  const form = jo.page.locator("form").filter({
    has: jo.page.getByRole("button", { name: "Join the household" }),
  });
  await form.getByLabel("Invite code").fill("NOPENOPE1");
  await form.getByLabel("Your name").fill(name);
  await pickTile(form, "Colour", "Rose");
  await form.getByRole("button", { name: "Join the household" }).click();
  await expect(form.getByText("That invite code doesn't exist")).toBeVisible();
  await expect(tileRadio(form, "Colour", "Rose")).toBeChecked();
  await form.getByLabel("Invite code").fill(code);
  await form.getByLabel("Your name").fill(name);
  await form.getByRole("button", { name: "Join the household" }).click();
  await expect(jo.page).toHaveURL(/\/$/);

  await jo.context.close();

  // The admin card: Rose from the join; a new colour saved twice stays.
  await page.goto("/admin/members");
  const card = page.getByTestId(`member-${name}`);
  await card.getByText("Edit name and colour").click();
  await expect(tileRadio(card, "Colour", "Rose")).toBeChecked();
  await pickTile(card, "Colour", "Green");
  const save = card.getByRole("button", { name: "Save", exact: true });
  let done = posted(page);
  await save.click();
  await done;
  await expect(card.getByText("Saved.", { exact: true })).toBeVisible();
  done = posted(page);
  await save.click();
  await done;
  await expect(card.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  const again = page.getByTestId(`member-${name}`);
  await again.getByText("Edit name and colour").click();
  await expect(tileRadio(again, "Colour", "Green")).toBeChecked();
});

test("the admin's own card links to Settings and helps find a Telegram id", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  await page.goto("/admin/members");
  const mine = page
    .locator('[data-testid^="member-"]')
    .filter({ hasText: "· you" })
    .first();
  await mine.getByText("Edit name and colour").click();
  await expect(
    mine.getByRole("link", { name: "Change your character" }),
  ).toHaveAttribute("href", "/settings#character");

  await mine
    .locator("summary")
    .filter({ hasText: /^Telegram/ })
    .click();
  const id = mine.getByLabel("Telegram user id", { exact: true });
  const save = mine.getByRole("button", { name: "Save Telegram id" });
  await id.fill("@me");
  await expect(mine.getByText(TELEGRAM_ID_MESSAGE)).toBeVisible();
  await expect(save).toBeDisabled();
  await id.fill("");
  await expect(save).toBeEnabled();

  await mine.getByRole("button", { name: "How do I find this?" }).click();
  const help = page.getByRole("dialog", { name: "Finding a Telegram user id" });
  await expect(help).toBeVisible();
  await expect(help).toContainText("@baumy_bot");
  await expect(help).toContainText("@userinfobot");
  await help.getByRole("button", { name: "Got it" }).click();
  await expect(help).toBeHidden();
});

test("an admin picks a chore's icon from the glyphs", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  const name = `Water ${Math.random().toString(36).slice(2, 8)}`;
  await page.goto("/admin/chores");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add chore" }),
  });
  await expect(tileRadio(form, "Icon", "Automatic")).toBeChecked();
  await form.getByLabel("Name", { exact: true }).fill(name);
  await pickTile(form, "Icon", "Plant");
  await form.getByLabel("Base points").fill("15");
  await form.getByLabel("Cooldown (hours)").fill("24");
  await form.getByRole("button", { name: "Add chore" }).click();
  const row = page.getByTestId(`admin-chore-${name}`);
  await expect(row.locator("[data-sprite]")).toHaveAttribute(
    "data-sprite",
    "plant",
  );

  // Editing starts on its icon, and another sticks.
  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await expect(tileRadio(edit, "Icon", "Plant")).toBeChecked();
  await pickTile(edit, "Icon", "Kettle");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(row.locator("[data-sprite]")).toHaveAttribute(
    "data-sprite",
    "kettle",
  );
});
