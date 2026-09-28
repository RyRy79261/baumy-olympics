import { expect, test } from "@playwright/test";

// Issue #82: /privacy and /terms are public. A signed-out visitor reads them
// without being sent to sign in, and reaches them from the sign-in and
// sign-up footers.

for (const { path, title } of [
  { path: "/privacy", title: "Privacy" },
  { path: "/terms", title: "Terms" },
]) {
  test(`${path} renders signed out`, async ({ page }) => {
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByTestId("legal-updated")).toBeVisible();
  });
}

for (const from of ["/auth/sign-in", "/auth/sign-up"]) {
  test(`${from} links to privacy and terms`, async ({ page }) => {
    await page.goto(from);
    const footer = page.getByRole("navigation", { name: "Privacy and terms" });
    await expect(footer.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    await footer.getByRole("link", { name: "Terms" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms");
  });
}
