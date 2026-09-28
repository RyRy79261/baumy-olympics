import { expect, test } from "@playwright/test";

// Runs in every project (desktop-chromium, ipad-portrait, mobile-360): the
// app boots, shows a signed-out visitor the public home (issue #96), sends
// them from a hub page to sign-in, and answers its health check.

test("home is public for a signed-out visitor", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Baumy Olympics",
  );
});

test("a hub page sends a signed-out visitor to sign in", async ({ page }) => {
  const res = await page.goto("/chores");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
});

test("health check answers ok", async ({ page }) => {
  const res = await page.goto("/api/health");
  expect(res?.status()).toBe(200);
  expect(await res?.json()).toEqual({ ok: true });
});
