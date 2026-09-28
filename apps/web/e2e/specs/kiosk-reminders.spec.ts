import { expect, test, type Locator, type Page } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { expectKioskTargets, pairedKiosk } from "../lib/kiosk";

// Issue #66 (ADR 0005 §4, §5), on the kitchen iPad against Docker Postgres:
// a member chooses their character in Settings and it shows in the hub
// header and on the kiosk; they post a reminder from the hub; the kiosk
// shows it full-screen with every face; a face's tap picks that member and
// records it as them; once everyone has seen it, it closes. A second
// reminder is dismissed for everyone, as whoever says so.
//
// The household is shared by every spec running at once, so under
// E2E_TEST_MODE=1 a kiosk shows reminders only with the
// `baumy_e2e_reminders=on` cookie (lib/kiosk/reminders.ts): this spec's
// reminders never cover another spec's kiosk. "Everyone" is every member
// who had joined when the reminder was posted, from every spec, so the
// spec taps faces until the reminder closes rather than counting them.

test.describe.configure({ mode: "serial" });

async function showReminders(kiosk: Page) {
  await kiosk.context().addCookies([
    {
      name: "baumy_e2e_reminders",
      value: "on",
      url: new URL(kiosk.url()).origin,
    },
  ]);
  await kiosk.goto("/kiosk");
  // Hydrated, so the first tap reaches React.
  await kiosk.waitForLoadState("networkidle");
}

/** Dismiss any reminder older than `title` (a run that stopped halfway). */
async function clearOlder(kiosk: Page, reminder: Locator, title: string) {
  const heading = reminder.locator("#reminder-title");
  for (let i = 0; i < 20; i++) {
    await expect(reminder).toBeVisible();
    const shown = await heading.textContent();
    if (shown === title) return;
    await reminder
      .getByRole("button", { name: "Dismiss for everyone" })
      .click();
    await reminder
      .getByTestId("reminder-dismissers")
      .getByRole("button")
      .first()
      .click();
    await expect(heading).not.toHaveText(shown ?? "");
  }
  throw new Error(`"${title}" never came up on the kiosk`);
}

test("choose a character, post a reminder, and see it on the kiosk until everyone has", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-landscape", "The kiosk is an iPad.");
  test.setTimeout(240_000);
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = `Jo ${suffix}`;
  const title = `Handyman ${suffix}`;

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const jo = await newAccount(browser, `reminder-${project}`);
  await redeem(jo.page, invite, name);
  await expect(jo.page).toHaveURL(/\/$/);

  // Settings: Jo's character, drawn live as it changes, then saved.
  await jo.page.goto("/settings");
  const preview = jo.page.getByTestId("avatar-preview");
  await expect(preview).toBeVisible();
  const choose = (group: string, option: string) =>
    jo.page
      .getByRole("group", { name: group })
      .getByText(option, { exact: true })
      .click();
  await choose("Hair style", "Spiky");
  await choose("Hair colour", "Platinum");
  await choose("Skin", "Deep");
  await choose("Shirt", "Green");
  await expect(preview).toHaveAttribute("data-hair-style", "spiky");
  await expect(preview).toHaveAttribute("data-hair-color", "platinum");
  await expect(preview).toHaveAttribute("data-skin-tone", "deep");
  await expect(preview).toHaveAttribute("data-shirt-color", "green");
  await expect(preview.locator("[data-housemate]")).toHaveAttribute(
    "data-hair",
    "spiky",
  );
  await jo.page.getByRole("button", { name: "Save character" }).click();
  await expect(
    jo.page.getByRole("status").filter({ hasText: "Character saved." }),
  ).toBeVisible();
  // The header draws it, and it is still chosen after a reload.
  await expect(
    jo.page.getByTestId("account-menu").locator("[data-housemate]").first(),
  ).toHaveAttribute("data-hair", "spiky");
  await jo.page.reload();
  await expect(
    jo.page.getByRole("group", { name: "Hair style" }).getByLabel("Spiky"),
  ).toBeChecked();

  // Jo posts a reminder from the hub.
  await jo.page.goto("/");
  const post = jo.page.getByTestId("post-reminder");
  await post.getByLabel("Title").fill(title);
  await post.getByLabel("Details").fill("The boiler man comes Wed 10-16.");
  await post.getByRole("button", { name: "Post reminder" }).click();
  await expect(
    post.getByRole("status").filter({ hasText: `Posted “${title}”` }),
  ).toBeVisible();

  // The kiosk: the reminder takes over the whole screen.
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${suffix}`,
  );
  // Jo's character is in the avatar bar.
  await expect(
    kiosk
      .getByRole("button", { name, exact: true })
      .locator("[data-housemate]"),
  ).toHaveAttribute("data-hair", "spiky");
  await showReminders(kiosk);
  const reminder = kiosk.locator("[data-reminder]");
  await clearOlder(kiosk, reminder, title);
  await expect(reminder).toBeVisible();
  await expect(reminder.getByTestId("reminder-from")).toHaveText(
    `notice.txt — from ${name}`,
  );
  await expect(reminder).toContainText("The boiler man comes Wed 10-16.");
  const count = reminder.getByTestId("reminder-count");
  await expect(count).toHaveText(/^0 of \d+ have seen it$/);
  const total = Number(/of (\d+)/.exec((await count.textContent())!)![1]);
  expect(total).toBeGreaterThanOrEqual(2);
  // Every face is their character: Jo's is the one Jo chose.
  await expect(
    reminder
      .locator("[data-face]")
      .filter({ hasText: name })
      .locator("[data-housemate]"),
  ).toHaveAttribute("data-hair", "spiky");
  await expectKioskTargets(reminder);

  // Jo's face: it is Jo who has seen it, and Jo who is picked now.
  await reminder.getByRole("button", { name: `I've seen it, ${name}` }).click();
  await expect(
    reminder.getByRole("button", { name: `${name} has seen it` }),
  ).toBeDisabled();
  await expect(count).toHaveText(`1 of ${total} have seen it`);
  await expect(kiosk.getByTestId("acting-as")).toHaveText(name);
  // It was recorded, not just drawn.
  await kiosk.reload();
  await kiosk.waitForLoadState("networkidle");
  await expect(
    reminder.getByRole("button", { name: `${name} has seen it` }),
  ).toBeDisabled();

  // Everyone else taps their face; the last tap closes it.
  const next = reminder.getByRole("button", { name: /^I've seen it, / });
  for (let i = 0; i < total; i++) {
    if ((await reminder.count()) === 0 || (await next.count()) === 0) break;
    const before = await count.textContent();
    await next.first().click();
    // The tap took (the count moved), or it was the last and it closed.
    await expect
      .poll(async () =>
        (await reminder.count()) === 0 ? "closed" : count.textContent(),
      )
      .not.toBe(before);
  }
  await expect(reminder).toHaveCount(0);
  await expect(kiosk.locator("[data-kiosk]")).toBeVisible();
  // And it stays gone.
  await kiosk.reload();
  await kiosk.waitForLoadState("networkidle");
  await expect(kiosk.locator("[data-kiosk]")).toBeVisible();
  await expect(reminder).toHaveCount(0);

  // A second reminder, dismissed for everyone by whoever says so.
  const second = `Water off ${suffix}`;
  await jo.page.goto("/");
  const again = jo.page.getByTestId("post-reminder");
  await again.getByLabel("Title").fill(second);
  await again.getByRole("button", { name: "Post reminder" }).click();
  await expect(
    again.getByRole("status").filter({ hasText: `Posted “${second}”` }),
  ).toBeVisible();
  await kiosk.reload();
  await kiosk.waitForLoadState("networkidle");
  await clearOlder(kiosk, reminder, second);
  await reminder.getByRole("button", { name: "Dismiss for everyone" }).click();
  const who = reminder.getByTestId("reminder-dismissers");
  await expect(who).toContainText("Who is dismissing it for everyone?");
  await expectKioskTargets(who);
  // Cancel goes back; then Jo dismisses it.
  await who.getByRole("button", { name: "Cancel" }).click();
  await expect(who).toHaveCount(0);
  await reminder.getByRole("button", { name: "Dismiss for everyone" }).click();
  await who.getByRole("button", { name, exact: true }).click();
  await expect(reminder).toHaveCount(0);
  await kiosk.reload();
  await kiosk.waitForLoadState("networkidle");
  await expect(kiosk.locator("[data-kiosk]")).toBeVisible();
  await expect(reminder).toHaveCount(0);

  await context.close();
  await jo.context.close();
});
