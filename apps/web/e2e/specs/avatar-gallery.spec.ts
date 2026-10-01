import { expect, test, type Locator } from "@playwright/test";
import sharp from "sharp";
import { founderAdmin, mintCode, newAccount } from "../lib/household";
import { kioskNav, pairedKiosk } from "../lib/kiosk";

// Issue #111: an admin uploads a character SET to the gallery (one sheet
// with three poses side by side, cleaned on the way in; before, after and
// the app's sizes shown; the poses reassigned), a new member joins with a
// code and picks it in Settings, and it is what the hub's header, Settings and the kitchen screen's
// avatar bar draw, through /api/blob. Archiving it leaves it on the member.

/** Three 10 × 14 figures (one a pixel shorter), 8× blown up, on black. */
async function sheetPng(): Promise<Buffer> {
  const block = (w: number, h: number, colour: string) =>
    sharp({ create: { width: w, height: h, channels: 3, background: colour } })
      .png()
      .toBuffer();
  const figure = async (left: number, top: number, h = 112) => [
    { input: await block(80, h, "#3b2a1a"), left, top },
    { input: await block(64, 48, "#f2c29b"), left: left + 8, top: top + 8 },
    { input: await block(64, 40, "#4ff5e6"), left: left + 8, top: top + 56 },
  ];
  return sharp({
    create: { width: 480, height: 240, channels: 3, background: "#000000" },
  })
    .composite([
      ...(await figure(40, 64)),
      ...(await figure(200, 72, 104)),
      ...(await figure(360, 64)),
    ])
    .png()
    .toBuffer();
}

async function expectLoadedSprite(scope: Locator) {
  const img = scope.locator("[data-member-sprite] img").first();
  await expect(img).toHaveAttribute("src", /^\/api\/blob\?pathname=avatars/);
  await expect
    .poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth))
    .toBeGreaterThan(0);
}

test("an admin adds a character, a new member picks it, every screen draws it", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "desktop-chromium", "One pass is enough.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const character = `Knight ${suffix}`;
  const name = `Picker ${suffix}`;

  // The admin adds the character: before and after, then saved.
  await founderAdmin(page, project);
  await page.goto("/admin/avatars");
  await expect(
    page.getByRole("heading", { name: "Avatars", level: 1 }),
  ).toBeVisible();
  await page.getByLabel("Images").setInputFiles({
    name: "knight.png",
    mimeType: "image/png",
    buffer: await sheetPng(),
  });
  const draft = page.getByTestId("avatar-draft");
  await expect(
    draft.getByRole("img", { name: /before cleaning/ }),
  ).toBeVisible();
  // Three figures, left to right, snapped back to their own pixels.
  const figures = draft.getByTestId("avatar-figure");
  await expect(figures).toHaveCount(3);
  await expect(figures.nth(0)).toContainText("10 × 14 px");
  await expect(figures.nth(1)).toContainText("10 × 13 px");
  await expect(figures.nth(0).getByLabel("Figure 1")).toHaveValue("idle");
  await expect(figures.nth(1).getByLabel("Figure 2")).toHaveValue("walk");
  await expect(figures.nth(2).getByLabel("Figure 3")).toHaveValue("emote");
  // The admin swaps walk and emote; the idle pose shows at the app's sizes.
  await figures.nth(1).getByLabel("Figure 2").selectOption("emote");
  await figures.nth(2).getByLabel("Figure 3").selectOption("walk");
  await expect(
    draft.getByTestId("avatar-app-sizes").locator("[data-member-sprite]"),
  ).toHaveCount(4);
  await draft.getByLabel("Name").fill(character);
  await draft.getByRole("button", { name: "Save to gallery" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Added ${character}` }),
  ).toBeVisible();
  const tile = page.getByTestId(`gallery-${character}`);
  await expect(tile).toContainText("Nobody wears it");
  await expectLoadedSprite(tile);

  // A new member joins with a code: the gallery (real housemates) is not
  // on /join for them; the code takes them to Settings to pick.
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `gallery-${project}`);
  const join = member.page.locator("form").filter({
    has: member.page.getByRole("button", { name: "Join the household" }),
  });
  await join.getByLabel("Invite code").fill(invite);
  await join.getByLabel("Your name").fill(name);
  await expect(join.getByTestId("invite-color")).toBeVisible();
  await expect(join.locator("[data-avatar]")).toHaveCount(0);
  await join.getByRole("button", { name: "Join the household" }).click();
  await expect(member.page).toHaveURL(/\/settings/);
  const gallery = member.page.getByTestId("gallery-form");
  const pick = gallery.locator("[data-avatar]").filter({ hasText: character });
  await expect(pick).toHaveAttribute("data-picked", "false");
  await pick.click();
  await expect(pick).toHaveAttribute("data-picked", "true");
  await gallery.getByRole("button", { name: "Wear this character" }).click();
  await expect(member.page.getByText("You wear it now.")).toBeVisible();

  // The header draws the sprite, not the initial tile, and it stays picked
  // after a reload.
  await member.page.goto("/");
  const menu = member.page.getByTestId("account-menu");
  await expectLoadedSprite(menu);
  await expect(menu.locator("[data-member-initial]")).toHaveCount(0);
  await member.page.goto("/settings");
  await expect(
    member.page
      .getByTestId("gallery-form")
      .locator("[data-avatar]")
      .filter({ hasText: character }),
  ).toHaveAttribute("data-picked", "true");

  // The kitchen screen's avatar bar draws it too.
  const kiosk = await pairedKiosk(browser, page, `iPad ${suffix}`);
  await kioskNav(kiosk.page, "Bounties");
  const button = kiosk.page.getByRole("button", { name, exact: true });
  await expect(button).toBeVisible();
  await expectLoadedSprite(button);

  // Archived: out of the gallery, still worn.
  await page.goto("/admin/avatars");
  await page.getByRole("button", { name: `Archive ${character}` }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `${character} is out` }),
  ).toBeVisible();
  await expect(page.getByTestId(`gallery-${character}`)).toContainText(
    "1 wears it",
  );
  await expect(
    page.getByRole("button", { name: `Restore ${character}` }),
  ).toBeVisible();
  await member.page.reload();
  await expectLoadedSprite(member.page.getByTestId("account-menu"));

  await kiosk.context.close();
  await member.context.close();
});
