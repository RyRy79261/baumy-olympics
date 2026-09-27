import { expect, test } from "@playwright/test";

// Runs in every project (desktop-chromium, ipad-landscape, mobile-360): the
// app boots, sends a signed-out visitor from the hub to sign-in, and answers
// its health check.

test("the hub sends a signed-out visitor to sign in", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
});

test("health check answers ok", async ({ page }) => {
  const res = await page.goto("/api/health");
  expect(res?.status()).toBe(200);
  expect(await res?.json()).toEqual({ ok: true });
});
