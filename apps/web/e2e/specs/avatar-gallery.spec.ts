import { expect, test, type Locator } from "@playwright/test";
import sharp from "sharp";
import { founderAdmin, mintCode, newAccount } from "../lib/household";
import { kioskNav, pairedKiosk } from "../lib/kiosk";

// Issue #111: an admin uploads a character to the gallery (cleaned on the
// way in, before and after shown), a new member picks it on /join, and it
// is what the hub's header, Settings and the kitchen screen's avatar bar
// draw, through /api/blob. Archiving it leaves it on the member.

/** A 10 × 14 sprite, 8× blown up, on a flat green backdrop. */
async function characterPng(): Promise<Buffer> {
  const block = (w: number, h: number, colour: string) =>
    sharp({ create: { width: w, height: h, channels: 3, background: colour } })
      .png()
      .toBuffer();
  return sharp({
    create: { width: 240, height: 240, channels: 3, background: "#00ff00" },
  })
    .composite([
      { input: await block(80, 112, "#0b0712"), left: 80, top: 64 },
      { input: await block(64, 48, "#f2c29b"), left: 88, top: 72 },
      { input: await block(64, 48, "#4ff5e6"), left: 88, top: 120 },
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
    buffer: await characterPng(),
  });
  const draft = page.getByTestId("avatar-draft");
  await expect(
    draft.getByRole("img", { name: /before cleaning/ }),
  ).toBeVisible();
  const after = draft.getByRole("img", { name: /after cleaning/ });
  await expect(after).toBeVisible();
  // Snapped back to the sprite's own 10 × 14 pixels.
  await expect(draft).toContainText("10 × 14 px");
  await draft.getByLabel("Name").fill(character);
  await draft.getByRole("button", { name: "Save to gallery" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Added ${character}` }),
  ).toBeVisible();
  const tile = page.getByTestId(`gallery-${character}`);
  await expect(tile).toContainText("Nobody wears it");
  await expectLoadedSprite(tile);

  // A new member picks it on /join.
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `gallery-${project}`);
  const join = member.page.locator("form").filter({
    has: member.page.getByRole("button", { name: "Join the household" }),
  });
  await join.getByLabel("Invite code").fill(invite);
  await join.getByLabel("Your name").fill(name);
  const pick = join.locator(`[data-avatar]`).filter({ hasText: character });
  await expect(pick).toHaveAttribute("data-picked", "false");
  await pick.click();
  await expect(pick).toHaveAttribute("data-picked", "true");
  await join.getByRole("button", { name: "Join the household" }).click();
  await expect(member.page).toHaveURL(/\/$/);

  // The header draws the sprite, not the drawn character.
  const menu = member.page.getByTestId("account-menu");
  await expectLoadedSprite(menu);
  await expect(menu.locator("[data-housemate]")).toHaveCount(0);

  // Settings shows it picked.
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
