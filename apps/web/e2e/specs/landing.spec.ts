import { expect, test } from "@playwright/test";
import { freshEmail, signUp } from "../lib/accounts";
import { founderAdmin } from "../lib/household";

// Issue #96: `/` is a public page for anyone not signed in (and for Google's
// branding check): no redirect, the purpose readable without script, the
// privacy and terms links and one Sign in button. A member still gets the
// hub there, and an account with no member row still goes to /join.

test("a signed-out visitor reads what the app is at /, without script", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  expect(res?.request().redirectedFrom()).toBeNull();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).toHaveTitle("Baumy Olympics");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /private household app/,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Baumy Olympics",
  );
  await expect(page.getByText(/private household app/).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "How it works" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Why it uses Google" }),
  ).toBeVisible();
  const legal = page.getByRole("navigation", { name: "Privacy and terms" });
  await expect(legal.getByRole("link", { name: "Privacy" })).toHaveAttribute(
    "href",
    "/privacy",
  );
  await expect(legal.getByRole("link", { name: "Terms" })).toHaveAttribute(
    "href",
    "/terms",
  );
  await context.close();
});

test("Sign in on the landing page goes to sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
});

test("a member still gets the hub at /", async ({ page }, testInfo) => {
  // founderAdmin ends on / and checks the Hub heading there.
  await founderAdmin(page, testInfo.project.name);
  await expect(page.getByTestId("signed-in-as")).toBeAttached();
  await expect(page.getByText(/private household app/)).toHaveCount(0);
});

test("an account with no member row still goes to /join", async ({
  page,
}, testInfo) => {
  await signUp(page, freshEmail(`landing-${testInfo.project.name}`));
  await expect(page).toHaveURL(/\/join$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/join$/);
});
