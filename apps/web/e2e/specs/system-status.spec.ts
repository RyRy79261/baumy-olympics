import { expect, test } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #133: Settings → System status, for admins only. Each integration
// shows as configured or not and answering or not; the database is asked a
// live question; under E2E_TEST_MODE=1 the fakes say so. No setting's value
// reaches the page. A member who is not an admin gets a 404.

const rand = () => Math.random().toString(36).slice(2, 8);

test("an admin sees each integration, configured and answering, and no secret", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  await page.goto("/settings");
  await page.getByRole("link", { name: "Open system status" }).click();
  await expect(
    page.getByRole("heading", { name: "System status", level: 1 }),
  ).toBeVisible();

  const list = page.getByRole("list", { name: "Integrations" });
  await expect(list.getByRole("listitem")).toHaveCount(8);
  for (const label of [
    "Database",
    "Email (Resend)",
    "Baumy's brain",
    "Google Calendar",
    "Claude (Anthropic)",
    "Voice (Groq)",
    "Photo storage (Vercel Blob)",
    "Bug reports (GitHub)",
  ]) {
    await expect(list.getByRole("heading", { name: label })).toBeVisible();
  }

  const db = page.getByTestId("check-database");
  await expect(db).toContainText("Configured");
  await expect(db).toContainText("Answering");
  await expect(db).toContainText(/answered in \d+ ms/);
  await expect(db).toContainText("DATABASE_URL");
  await expect(page.getByTestId("check-brain")).toContainText("Test fake");
  await expect(page.getByTestId("check-bugReports")).toContainText(
    "GITHUB_FEEDBACK_TOKEN",
  );

  // Names, never values.
  const html = await page.content();
  for (const name of [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "KITCHEN_API_TOKEN",
    "ANTHROPIC_API_KEY",
  ]) {
    const value = process.env[name];
    if (value && value.length >= 8) expect(html).not.toContain(value);
  }
});

test("a member who is not an admin gets a 404, and no link to it", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  await founderAdmin(page, project);
  const mine = await page.goto("/settings/system");
  expect(mine?.status()).toBe(200);
  const code = await mintCode(page, 1);
  const member = await newAccount(browser, `system-${project}`);
  await redeem(member.page, code, `Member ${rand()}`);
  await expect(member.page).toHaveURL(/\/$/);

  await member.page.goto("/settings");
  await expect(member.page.getByTestId("report-settings-card")).toBeVisible();
  await expect(
    member.page.getByRole("link", { name: "Open system status" }),
  ).toHaveCount(0);
  const res = await member.page.goto("/settings/system");
  expect(res?.status()).toBe(404);
  await expect(
    member.page.getByRole("heading", { name: "System status", level: 1 }),
  ).toHaveCount(0);
  await member.context.close();
});
