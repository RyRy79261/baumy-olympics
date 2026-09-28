import { expect, test } from "@playwright/test";
import { openChore } from "../lib/chores";
import { founderAdmin } from "../lib/household";

// Issue #15: a chore whose photo proof is Required cannot be logged without a
// photo; with one, the upload route stores it and logs the claim in the same
// request, and the claim shows its photo through /api/blob only.

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("a chore that needs photo proof is logged with a photo", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-portrait", "The kiosk has its own spec.");
  const name = `Fridge ${Math.random().toString(36).slice(2, 8)}`;

  await founderAdmin(page, project);
  await page.goto("/admin/chores");
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add chore" }),
  });
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Base points").fill("30");
  await form.getByLabel("Cooldown (hours)").fill("0");
  await form.getByLabel("Photo proof").selectOption("required");
  await form.getByRole("button", { name: "Add chore" }).click();
  await expect(page.getByTestId(`admin-chore-${name}`)).toContainText("30 pts");

  await page.goto("/chores");
  const sheet = await openChore(page, name);
  const logIt = sheet.getByRole("button", { name: "Log it" });
  await expect(sheet).toContainText(`${name} needs a photo as proof.`);
  await expect(logIt).toBeDisabled();
  await sheet.getByLabel("Add a photo (required)").setInputFiles({
    name: "fridge.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(
    sheet.getByRole("img", { name: "The photo you chose" }),
  ).toBeVisible();
  await expect(logIt).toBeEnabled();
  await logIt.click();
  await expect(page.getByTestId("score-pop")).toHaveText("+30");
  await expect(
    page.getByRole("status").filter({ hasText: `Logged ${name}` }),
  ).toBeVisible();

  // The claim carries its photo, through the proxy.
  await page.goto("/inbox");
  const claim = page.getByTestId("your-claims").getByTestId(`claim-${name}`);
  const photo = claim.getByRole("img", { name: `Proof photo for ${name}` });
  await expect(photo).toHaveAttribute("src", /^\/api\/blob\?pathname=/);
  // Lazy-loaded: it loads once it is on screen.
  await photo.scrollIntoViewIfNeeded();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(claim.getByLabel("Add a photo")).toHaveCount(0);
});
