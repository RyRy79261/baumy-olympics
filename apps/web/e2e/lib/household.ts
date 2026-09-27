// Household set-up for specs, through the real pages (SPEC §10: no database
// back door): this project's founder as admin, invite codes, new members.

import { expect, type Browser, type Page } from "@playwright/test";
import { founderEmail, freshEmail, signUp, signUpOrIn } from "./accounts";
import { waitForAuthMail } from "./mail";

/** The founder for this project, signed in as the household admin. */
export async function founderAdmin(page: Page, project: string) {
  const email = founderEmail(project);
  await signUpOrIn(page, email);
  await page.goto("/");
  if (new URL(page.url()).pathname === "/join") {
    await expect(
      page.getByRole("heading", { name: "You're on the founders list" }),
    ).toBeVisible();
    if (await page.getByText("Confirm your email").isVisible()) {
      // The link sent on sign-up, read from the e2e capture file.
      await page.goto(await waitForAuthMail(email, "verify"));
      await page.goto("/join");
    }
    const founder = page.locator("form").filter({
      has: page.getByRole("button", { name: "Join as admin" }),
    });
    await founder.getByLabel("Your name").fill(`Founder ${project}`);
    await founder.getByRole("button", { name: "Join as admin" }).click();
    // Another spec of this project may have joined this founder a moment
    // earlier (specs run in parallel): then this join is refused as
    // "already a member", and the hub is simply there.
    await Promise.race([
      page.waitForURL((url) => url.pathname === "/"),
      founder
        .getByRole("alert")
        .filter({ hasText: "already in the household" })
        .waitFor(),
    ]);
    if (new URL(page.url()).pathname !== "/") await page.goto("/");
  }
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Hub", level: 1 }),
  ).toBeVisible();
}

export async function mintCode(page: Page, uses = 1): Promise<string> {
  await page.goto("/admin/members");
  await expect(
    page.getByRole("heading", { name: "Members", level: 1 }),
  ).toBeVisible();
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Create invite code" }),
  });
  await form.getByLabel("Uses").fill(String(uses));
  await form.getByRole("button", { name: "Create invite code" }).click();
  const code = (await page.getByTestId("minted-code").textContent())!.trim();
  expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  await expect(page.getByTestId(`invite-${code}`)).toContainText("0 of");
  return code;
}

export async function newAccount(browser: Browser, label: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signUp(page, freshEmail(label));
  return { context, page };
}

export async function redeem(page: Page, code: string, name: string) {
  await page.getByLabel("Invite code").fill(code);
  const form = page.locator("form").filter({
    has: page.getByRole("button", { name: "Join the household" }),
  });
  await form.getByLabel("Your name").fill(name);
  await form.getByRole("button", { name: "Join the household" }).click();
}
