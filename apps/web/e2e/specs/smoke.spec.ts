import { expect, test } from "@playwright/test";

// Runs in every project (desktop-chromium, ipad-landscape, mobile-360): the
// app boots, renders its home page and answers its health check.

test("home page renders", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle("Baumy Olympics");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Baumy");
});

test("health check answers ok", async ({ page }) => {
  const res = await page.goto("/api/health");
  expect(res?.status()).toBe(200);
  expect(await res?.json()).toEqual({ ok: true });
});
