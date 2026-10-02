import { expect, test } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { openAccountMenu } from "../lib/nav";

// Issue #9 end to end, against Docker Postgres: only household members see
// the hub. A founder (FOUNDER_EMAILS, set per project by e2e-local.sh)
// verifies their email and joins as admin, mints an invite code on
// /admin/members, and a brand-new account redeems it and reaches the hub.

// One worker runs this file's tests in order: they share this project's
// founder account, and two tests bootstrapping it at once would race.
test.describe.configure({ mode: "default" });

test("a founder mints a code and a new account redeems it to reach the hub", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  // The database outlives a run, so the new member's name is unique.
  const name = `Newbie ${Math.random().toString(36).slice(2, 8)}`;
  await founderAdmin(page, project);
  const code = await mintCode(page, 1);

  // A new sign-up without a code cannot reach the hub.
  const newbie = await newAccount(browser, `newbie-${project}`);
  await expect(newbie.page).toHaveURL(/\/join$/);
  await newbie.page.goto("/");
  await expect(newbie.page).toHaveURL(/\/join$/);
  await expect(
    newbie.page.getByRole("heading", { name: "Join the household" }),
  ).toBeVisible();
  expect((await newbie.page.goto("/settings"))?.url()).toMatch(/\/join$/);

  // A wrong code says what to do.
  await redeem(newbie.page, "nope-nope-nope", "Newbie");
  await expect(
    newbie.page
      .getByRole("alert")
      .filter({ hasText: "That invite code doesn't exist" }),
  ).toBeVisible();

  // The real code, typed with a capital as a phone keyboard would.
  await redeem(newbie.page, code.toUpperCase(), name);
  await expect(newbie.page).toHaveURL(/\/$/);
  await expect(
    newbie.page.getByRole("heading", { name: "Hub", level: 1 }),
  ).toBeVisible();
  await expect(newbie.page.getByTestId("signed-in-as")).toHaveText(name);

  // A member is not an admin: /admin/* is a 404, and the header has no
  // Admin menu (the account menu is there, with Settings).
  await openAccountMenu(newbie.page);
  await expect(newbie.page.getByTestId("admin-menu")).toHaveCount(0);
  await expect(newbie.page.getByRole("link", { name: "Members" })).toHaveCount(
    0,
  );
  const admin = await newbie.page.goto("/admin/members");
  expect(admin?.status()).toBe(404);

  // The code had one use, so the next person is told it is used up.
  const late = await newAccount(browser, `late-${project}`);
  await redeem(late.page, code, "Late");
  await expect(
    late.page
      .getByRole("alert")
      .filter({ hasText: "That invite code has already been used" }),
  ).toBeVisible();
  await expect(late.page).toHaveURL(/\/join$/);

  // The admin sees the new member and the spent code.
  await page.goto("/admin/members");
  await expect(page.getByTestId(`member-${name}`)).toBeVisible();
  await expect(page.getByTestId(`invite-${code}`)).toContainText("Used up");

  await newbie.context.close();
  await late.context.close();
});

test("an admin cancels a code, and redeeming it then says so", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  await founderAdmin(page, project);
  const code = await mintCode(page, 2);
  await page.getByRole("button", { name: `Cancel code ${code}` }).click();
  await expect(page.getByTestId(`invite-${code}`)).toContainText("Cancelled");

  const someone = await newAccount(browser, `cancelled-${project}`);
  await redeem(someone.page, code, "Someone");
  await expect(
    someone.page
      .getByRole("alert")
      .filter({ hasText: "That invite code was cancelled" }),
  ).toBeVisible();
  await someone.context.close();
});

test("a member sets a kiosk PIN and creates a Telegram link code", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  await founderAdmin(page, project);
  const code = await mintCode(page, 1);
  const member = await newAccount(browser, `settings-${project}`);
  await redeem(member.page, code, `Settings ${project}`);
  await expect(member.page).toHaveURL(/\/$/);

  const p = member.page;
  await openAccountMenu(p);
  await p.getByRole("link", { name: "Settings" }).click();
  await expect(
    p.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();

  // Mismatched PINs never reach the server.
  await p.getByLabel("PIN", { exact: true }).fill("4321");
  await p.getByLabel("Type it again").fill("4322");
  await p.getByRole("button", { name: "Set PIN" }).click();
  await expect(p.getByText("The PINs do not match.")).toBeVisible();

  await p.getByLabel("PIN", { exact: true }).fill("4321");
  await p.getByLabel("Type it again").fill("4321");
  await p.getByRole("button", { name: "Set PIN" }).click();
  await expect(
    p.getByRole("status").filter({ hasText: "PIN saved." }),
  ).toBeVisible();

  // Changing it needs "Confirm it's you" (issue #135), but a session this
  // fresh (under 10 minutes) counts, so no dialog opens and no password
  // field is on the form.
  await p.reload();
  await expect(p.getByLabel("New PIN")).toBeVisible();
  await expect(p.getByLabel("Your account password")).toHaveCount(0);
  await p.getByLabel("New PIN").fill("135790");
  await p.getByLabel("Type it again").fill("135790");
  await p.getByRole("button", { name: "Change PIN" }).click();
  await expect(
    p.getByRole("status").filter({ hasText: "PIN changed." }),
  ).toBeVisible();
  await expect(
    p.getByRole("dialog", { name: "Confirm it's you" }),
  ).toBeHidden();

  await p.getByRole("button", { name: "Link Telegram" }).click();
  await expect(p.getByTestId("telegram-link-code")).toHaveText(
    /^\/link [A-Z2-9]{10}$/,
  );
  await member.context.close();
});
