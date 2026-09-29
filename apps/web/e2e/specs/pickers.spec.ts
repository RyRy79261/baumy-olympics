import { expect, test } from "@playwright/test";
import { founderAdmin, mintCode, newAccount } from "../lib/household";
import { pickTile, tileRadio } from "../lib/pickers";

// Issue #106: pickers show the thing, not its name. A newcomer picks a
// colour swatch and a character on /join (tap and keyboard), the character
// is theirs after joining, Settings changes the hair style on the
// character itself, the admin sees the real character and swatches on the
// member card (with the Telegram id help), and picks a chore's icon.

test.describe.configure({ mode: "default" });

test("a newcomer picks a colour and a character on /join, then a hair style in Settings", async ({
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

  // The hair styles are the character wearing them; the keyboard moves
  // through a group as it does through any radio group.
  const preview = form.getByTestId("avatar-preview");
  await pickTile(form, "Hair style", "Short");
  await expect(preview).toHaveAttribute("data-hair-style", "short");
  await tileRadio(form, "Hair style", "Short").focus();
  await jo.page.keyboard.press("ArrowRight");
  await expect(tileRadio(form, "Hair style", "Long")).toBeChecked();
  await expect(preview).toHaveAttribute("data-hair-style", "long");
  await pickTile(form, "Hair colour", "Platinum");
  await pickTile(form, "Shirt", "Yellow");
  await expect(preview).toHaveAttribute("data-shirt-color", "yellow");

  await form.getByRole("button", { name: "Join the household" }).click();
  await expect(jo.page).toHaveURL(/\/$/);

  // Settings starts on the character picked at the door.
  await jo.page.goto("/settings");
  const settings = jo.page.getByTestId("avatar-form");
  await expect(tileRadio(settings, "Hair style", "Long")).toBeChecked();
  await expect(tileRadio(settings, "Hair colour", "Platinum")).toBeChecked();
  await expect(tileRadio(settings, "Shirt", "Yellow")).toBeChecked();
  const spikyTile = tileRadio(settings, "Hair style", "Spiky").locator(
    "xpath=..",
  );
  await expect(spikyTile.locator("[data-housemate]")).toHaveAttribute(
    "data-hair",
    "spiky",
  );
  await pickTile(settings, "Hair style", "Spiky");
  await settings.getByRole("button", { name: "Save character" }).click();
  await expect(
    jo.page.getByRole("status").filter({ hasText: "Character saved." }),
  ).toBeVisible();
  await jo.page.reload();
  await expect(
    tileRadio(jo.page.getByTestId("avatar-form"), "Hair style", "Spiky"),
  ).toBeChecked();
  await expect(
    jo.page.getByTestId("account-menu").locator("[data-housemate]").first(),
  ).toHaveAttribute("data-hair", "spiky");

  // The admin's member card: the real character, the colour as swatches
  // (Rose chosen), and no legacy avatar select.
  await page.goto("/admin/members");
  const card = page.getByTestId(`member-${name}`);
  await card.getByText("Edit name and colour").click();
  await expect(card.locator("[data-housemate]").first()).toHaveAttribute(
    "data-hair",
    "spiky",
  );
  await expect(tileRadio(card, "Colour", "Rose")).toBeChecked();
  await expect(
    card.getByText(`Only ${name} can change their character`),
  ).toBeVisible();
  await expect(card.getByLabel("Avatar")).toHaveCount(0);
  await jo.context.close();
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
  await expect(
    mine.getByText("Use the Telegram user id: digits only."),
  ).toBeVisible();
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
