import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { PASSWORD } from "../lib/accounts";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { openAdminMenu } from "../lib/nav";

// Issue #104: brain's service token from /admin/connections, no terminal.
// The admin creates a token and sees it once, brain can call with it,
// rotating kills the old one, revoking kills the new one; a member who is
// not an admin gets a 404. Each run uses a token name of its own, so the
// projects never touch each other's tokens (or brain-api's).

const rand = () => Math.random().toString(36).slice(2, 8);

function brainStatus(request: APIRequestContext, token: string) {
  return request
    .get("/api/v1/actions", { headers: { authorization: `Bearer ${token}` } })
    .then((r) => r.status());
}

function toast(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

test("an admin creates, rotates and revokes a service token, each shown once", async ({
  page,
  context,
  request,
}, testInfo) => {
  const project = testInfo.project.name;
  const name = `e2e-ui-${rand()}`;
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await founderAdmin(page, project);

  await openAdminMenu(page);
  await page.getByRole("link", { name: "Connections" }).click();
  await expect(
    page.getByRole("heading", { name: "Connections", level: 1 }),
  ).toBeVisible();

  // Create. The password is only needed after 10 minutes; it is right anyway.
  const create = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create token" }),
  });
  await create.getByLabel("Name").fill(name);
  await create.getByLabel("Your password").fill(PASSWORD);
  await create.getByRole("button", { name: "Create token" }).click();
  const shown = page.getByTestId("service-token-plaintext");
  await expect(shown).toHaveText(/^baumy_st_/);
  const first = (await shown.textContent())!.trim();
  await expect(page.getByText("BRAIN_SERVICE_TOKEN")).toBeVisible();
  await page.getByRole("button", { name: "Copy token" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);

  const live = page.getByTestId(`service-token-${name}-live`);
  await expect(live).toContainText("brain");
  await expect(live).toContainText("Not yet");

  // Brain can call with it.
  expect(await brainStatus(request, first)).toBe(200);

  // Rotate, after the confirm step, with no reload in between: the page
  // shows exactly one token, the new one, never the dead one beside it.
  await live.getByRole("button", { name: `Rotate ${name}` }).click();
  await expect(live.getByText(`Rotate ${name}?`)).toBeVisible();
  await live.getByLabel("Your password").fill(PASSWORD);
  await live.getByRole("button", { name: "Yes, rotate" }).click();
  await expect(shown).not.toHaveText(first);
  await expect(shown).toHaveCount(1);
  await expect(shown).toHaveText(/^baumy_st_/);
  const second = (await shown.textContent())!.trim();
  expect(second).not.toBe(first);
  // A fresh token: the copy button starts over.
  await expect(page.getByRole("button", { name: "Copy token" })).toBeVisible();
  await expect(page.getByTestId(`service-token-${name}-revoked`)).toHaveCount(
    1,
  );
  expect(await brainStatus(request, first)).toBe(401);
  expect(await brainStatus(request, second)).toBe(200);

  // Revoke, after the confirm step; "Keep it" first backs out.
  await live.getByRole("button", { name: `Revoke ${name}` }).click();
  await live.getByRole("button", { name: "Keep it" }).click();
  await expect(
    live.getByRole("button", { name: `Revoke ${name}` }),
  ).toBeVisible();
  expect(await brainStatus(request, second)).toBe(200);
  await live.getByRole("button", { name: `Revoke ${name}` }).click();
  await live.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(toast(page, `${name} is revoked.`)).toBeVisible();
  const revoked = page.getByTestId(`service-token-${name}-revoked`);
  await expect(revoked).toHaveCount(2);
  await expect(live).toHaveCount(0);
  // The revoked token is taken off the page: no plaintext is left.
  await expect(shown).toHaveCount(0);
  await expect(page.getByTestId("service-token-shown")).toHaveCount(0);
  expect(await brainStatus(request, second)).toBe(401);

  // After a reload both are listed as used, and neither token is anywhere
  // on the page.
  await page.reload();
  await expect(revoked).toHaveCount(2);
  for (const row of await revoked.all()) {
    await expect(row).toContainText("Last used");
    await expect(row).not.toContainText("Not yet");
  }
  const html = await page.content();
  expect(html).not.toContain(first);
  expect(html).not.toContain(second);
});

test("a member who is not an admin gets a 404", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  await founderAdmin(page, project);
  // The admin can open it.
  const mine = await page.goto("/admin/connections");
  expect(mine?.status()).toBe(200);
  const code = await mintCode(page, 1);
  const member = await newAccount(browser, `connections-${project}`);
  await redeem(member.page, code, `Member ${rand()}`);
  await expect(member.page).toHaveURL(/\/$/);
  const res = await member.page.goto("/admin/connections");
  expect(res?.status()).toBe(404);
  await expect(
    member.page.getByRole("heading", { name: "Connections", level: 1 }),
  ).toHaveCount(0);
  await member.context.close();
});
