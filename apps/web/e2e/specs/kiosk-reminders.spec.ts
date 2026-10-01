import { expect, test, type Locator, type Page } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import {
  expectKioskTargets,
  kioskNav,
  openKioskChores,
  pairedKiosk,
} from "../lib/kiosk";
import { MEMBER_COLORS } from "@baumy/types";

// Issue #66 (ADR 0005 §4, §5), on the kitchen iPad against Docker Postgres:
// a member with no gallery character shows as their initial in their colour
// (issue #116) in the hub header, the scores, the kiosk's avatar bar and
// the reminder; they post a reminder from the hub; the kiosk
// shows it full-screen with every face; a face's tap records it as that member
// without changing who is picked; once everyone has seen it, it closes. A second
// reminder is dismissed for everyone, as whoever says so.
//
// The household is shared by every spec running at once, so under
// E2E_TEST_MODE=1 a kiosk shows reminders only with the
// `baumy_e2e_reminders=on` cookie (lib/kiosk/reminders.ts): this spec's
// reminders never cover another spec's kiosk. "Everyone" is every member
// who had joined when the reminder was posted, from every spec, so the
// spec taps faces until the reminder closes rather than counting them.

test.describe.configure({ mode: "serial" });

/** The colour /join starts on (the first swatch), as the browser reports it. */
function rgb(hex: string): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`;
}

/**
 * `scope` shows the member as their initial tile, in their colour, and
 * never as a drawn person or a gallery sprite (issue #116).
 */
async function expectInitialTile(scope: Locator, letter: string) {
  const tile = scope.locator("[data-member-initial]").first();
  await expect(tile).toBeVisible();
  await expect(tile).toHaveText(letter);
  await expect(tile).toHaveCSS("color", rgb(MEMBER_COLORS[0]));
  await expect(scope.locator("[data-member-sprite]")).toHaveCount(0);
  await expect(scope.locator("[data-housemate]")).toHaveCount(0);
}

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

test("show a member's initial tile everywhere, post a reminder, and see it on the kiosk until everyone has", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad.");
  test.setTimeout(240_000);
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = `Jo ${suffix}`;
  const title = `Handyman ${suffix}`;

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const jo = await newAccount(browser, `reminder-${project}`);
  await redeem(jo.page, invite, name);
  await expect(jo.page).toHaveURL(/\/$/);

  // Jo joined with a code, so has no gallery character: the header shows
  // their initial in their colour (the join form's first swatch).
  await expectInitialTile(jo.page.getByTestId("account-menu"), "J");
  // Settings offers nothing to draw: no hair, skin or shirt pickers.
  await jo.page.goto("/settings");
  await expect(
    jo.page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect(jo.page.getByRole("group", { name: "Hair style" })).toHaveCount(
    0,
  );
  await expect(jo.page.getByTestId("avatar-form")).toHaveCount(0);
  // The scoreboard: Jo's row, at zero, with the same tile.
  await jo.page.goto("/scores");
  await expectInitialTile(jo.page.getByTestId(`standing-${name}`), "J");

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
  // Jo's initial tile is in the avatar bar (on a page past the dashboard),
  // and on the kitchen screen's scoreboard.
  await openKioskChores(kiosk);
  await expectInitialTile(
    kiosk.getByRole("button", { name, exact: true }),
    "J",
  );
  await kioskNav(kiosk, "Scores");
  await expectInitialTile(kiosk.getByTestId(`standing-${name}`), "J");
  // The founder is acting on the kiosk when the reminder comes up.
  const founder = `Founder ${project}`;
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
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
  // Every face is their character or initial tile: Jo's is the tile.
  await expectInitialTile(
    reminder.locator("[data-face]").filter({ hasText: name }),
    "J",
  );
  await expectKioskTargets(reminder);

  // Jo's face: it is Jo who has seen it, and the founder is still the one
  // acting (a face's tap never changes who is picked).
  await reminder.getByRole("button", { name: `I've seen it, ${name}` }).click();
  await expect(
    reminder.getByRole("button", { name: `${name} has seen it` }),
  ).toBeDisabled();
  await expect(count).toHaveText(`1 of ${total} have seen it`);
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
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
