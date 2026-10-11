import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { multiplierPct, pctOf } from "@baumy/core";
import { addChore, openChore } from "../lib/chores";
import { founderAdmin } from "../lib/household";
import {
  expectKioskTargets,
  kioskNav,
  openBaumySheet,
  pairedKiosk,
} from "../lib/kiosk";

// Issue #65 (ADR 0005): the portrait kitchen dashboard on the iPad
// (820×1180). One screen that never scrolls: the date, a big clock and
// three icons (issue #193, SPEC §12 decision 36): the star opens the
// Bounties tab, the basket opens the Shop tab with a badge of the items on
// the list (none with brain down), and Messages opens its calm module.
// There are no "new" bounties anywhere. Under it the month calendar:
// ◀ ▶ and Today move by month, a day opens its sheet with every event, and
// the sheet steps day by day, into the next month too. The footer nav leads
// to the other kiosk pages, and Baumy stands over its right end.
//
// The calendar, the chores and the shopping list are shared by the specs
// running in parallel, so each has a name of its own.

const BERLIN = "Europe/Berlin";

/** Berlin's "YYYY-MM-DD", `days` from today. */
function berlinDay(days = 0): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BERLIN }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

/** "SEPTEMBER 2026" for "2026-09-…". */
function monthTitle(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(y!, m! - 1, 1)))
    .toUpperCase();
}

/** The month after "YYYY-MM-DD", as "YYYY-MM". */
function nextMonth(day: string): string {
  const [y, m] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m!, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Neither the page nor anything in it scrolls. */
async function expectNoScroll(kiosk: Page) {
  const root = await kiosk.evaluate(() => ({
    h: [
      document.documentElement.scrollHeight,
      document.documentElement.clientHeight,
    ],
    w: [
      document.documentElement.scrollWidth,
      document.documentElement.clientWidth,
    ],
  }));
  expect(root.h[0], "page height").toBeLessThanOrEqual(root.h[1]!);
  expect(root.w[0], "page width").toBeLessThanOrEqual(root.w[1]!);
}

async function addEvent(
  page: Page,
  title: string,
  date: string,
  start: string,
) {
  await page.goto(`/calendar?view=day&date=${date}`);
  await page.getByRole("button", { name: "New event" }).click();
  const sheet = page.getByRole("dialog", { name: "New event" });
  await sheet.getByLabel("Title").fill(title);
  await sheet.getByLabel("Date").fill(date);
  await sheet.getByLabel("Starts").fill(start);
  await sheet.getByLabel("Ends").fill(`${Number(start.slice(0, 2)) + 1}:00`);
  await sheet.getByRole("button", { name: "Add event" }).click();
  await expect(sheet).toBeHidden();
}

/** Few points, and no cooldown: ready again the moment it is logged. */
const QUICK_POINTS = 1;

/** How many items brain's (fake) list has open, as Telegram sees it. */
async function openItems(request: APIRequestContext): Promise<number> {
  const res = await request.get("/api/test/brain");
  expect(res.status(), "is the server running with E2E_TEST_MODE=1?").toBe(200);
  return ((await res.json()) as { items: unknown[] }).items.length;
}

test("the kitchen dashboard: icons, modules, the month and its days", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  // The founder works on a phone and the kiosk is a context of its own at
  // 820×1180 (pairedKiosk), as in hub.spec: the ipad-portrait founder
  // already pairs many kiosks (approve_kiosk_pairing allows 20 per 10
  // minutes).
  test.skip(project !== "mobile-360", "Paired from the phone project.");
  const tag = Math.random().toString(36).slice(2, 8);
  const bins = `Bins ${tag}`;
  const mop = `Mop ${tag}`;
  const flour = `Flour ${tag}`;
  const dinner = `Dinner ${tag}`;
  const vet = `Vet ${tag}`;
  const founder = `Founder ${project}`;
  const today = berlinDay();
  const tomorrow = berlinDay(1);

  // Two chores added just now. The bins have no cooldown.
  await founderAdmin(page, project);
  await addChore(page, {
    name: bins,
    basePoints: QUICK_POINTS,
    cooldownHours: 0,
  });
  await addChore(page, { name: mop, basePoints: 10, cooldownHours: 24 });
  await addEvent(page, dinner, today, "19:00");
  await addEvent(page, vet, tomorrow, "09:00");
  // A note on the board: the kitchen's Messages list it.
  const note = `Parcel ${tag}`;
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  const noteSheet = page.getByRole("dialog", { name: "New note" });
  await noteSheet.getByLabel("Title").fill(note);
  await noteSheet.getByLabel("Note").fill("On the **shoe rack**");
  await noteSheet.getByRole("button", { name: "Add note" }).click();
  await expect(noteSheet).toBeHidden();

  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${tag}`,
  );

  // Three icons, in this order: Bounties, Shopping and Messages. There is
  // no Urgent (a chore has no due date, SPEC §12 decision 35, issue #189)
  // and no New (decision 36, issue #193).
  const star = kiosk.locator('[data-icon="bounties"]');
  const basket = kiosk.locator('[data-icon="shopping"]');
  const envelope = kiosk.locator('[data-icon="messages"]');
  await expect(star).toBeVisible();
  await expect(basket).toBeVisible();
  await expect(envelope).toBeVisible();
  await expect(kiosk.locator("[data-icon]")).toHaveCount(3);
  expect(
    await kiosk
      .locator("[data-icon]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-icon"))),
  ).toEqual(["bounties", "shopping", "messages"]);
  await expect(kiosk.locator('[data-icon="new"]')).toHaveCount(0);
  await expect(kiosk.locator('[data-icon="urgent"]')).toHaveCount(0);
  // The star is a way in, lit, with no count; the basket and the
  // envelope are links and a button with their own counts.
  await expect(star).toHaveAttribute("aria-label", "Bounties");
  await expect(star.locator("[data-badge]")).toHaveCount(0);
  await expect(star).toHaveAttribute("href", "/kiosk/chores");
  await expect(basket).toHaveAttribute("href", "/kiosk/shopping");
  await expect(basket).toHaveAttribute("aria-label", /^Shopping: \d+$/);

  // One screen: the header, the month, the footer, Baumy. No scrolling.
  await expect(kiosk.getByTestId("kiosk-home")).toBeVisible();
  await expect(kiosk.getByTestId("clock-time")).toHaveText(/^\d\d:\d\d$/);
  await expect(kiosk.getByTestId("clock-date")).toHaveText(
    /^(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day \d{1,2} [A-Z][a-z]+$/,
  );
  await expect(kiosk.getByTestId("month-title")).toHaveText(monthTitle(today));
  const nav = kiosk.getByRole("navigation", { name: "Kiosk" });
  await expect(nav.getByRole("link")).toHaveText([
    "Home",
    "Bounties",
    "Calendar",
    "Board",
    "Activity",
    "Shop",
    "Scores",
  ]);
  await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const cat = kiosk.getByRole("button", { name: "Ask Baumy" });
  await expect(cat).toBeVisible();
  const catBox = (await cat.boundingBox())!;
  expect(catBox.x + catBox.width).toBeLessThanOrEqual(820);
  expect(catBox.y + catBox.height).toBeLessThanOrEqual(1180);
  await expectNoScroll(kiosk);
  await expectKioskTargets(kiosk.locator("main"));

  // The Messages module opens and closes.
  await envelope.click();
  const messages = kiosk.getByRole("dialog", { name: "Messages" });
  await expect(messages).toBeVisible();
  const message = messages.getByTestId(`message-${note}`);
  await expect(message).toContainText(founder);
  await expect(message).toContainText(/just now|\dm ago/);
  await expect(message.locator("strong")).toHaveText("shoe rack");
  await messages.getByRole("button", { name: "Close" }).click();
  await expect(messages).toBeHidden();

  // The star opens the Bounties tab: the page, not a pop-up.
  await star.click();
  await expect(kiosk).toHaveURL(/\/kiosk\/chores$/);
  await expect(
    kiosk.getByRole("heading", { name: "Bounties", level: 1 }),
  ).toBeVisible();
  await expect(kiosk.getByRole("dialog")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Bounties" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  // The board's tabs are All and the two kinds: no New tab, and a bounty
  // added a minute ago has no "new" tag (issue #193).
  const tabs = kiosk.getByTestId("bounty-tabs");
  await expect(tabs.locator("[data-tab]")).toHaveCount(3);
  await expect(tabs.locator('[data-tab="all"]')).toBeVisible();
  await expect(tabs.locator('[data-tab="new"]')).toHaveCount(0);
  const binsRow = kiosk.getByTestId(`chore-${bins}`);
  await expect(binsRow).toContainText(bins);
  await expect(binsRow).not.toContainText(/\bnew\b/i);
  const log = kiosk.getByRole("dialog", { name: `Log ${bins}` });
  await openChore(kiosk, bins);
  // Changed your mind (issue #174): Cancel, the corner's ×, or a tap on the
  // dimmed page put it down, and nothing is logged. A tap inside the sheet
  // keeps it open.
  const cancel = log.getByRole("button", { name: "Cancel", exact: true });
  const close = log.getByRole("button", { name: "Close", exact: true });
  for (const target of [cancel, close]) {
    const box = (await target.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(56);
    expect(box.width).toBeGreaterThanOrEqual(56);
  }
  await cancel.click();
  await expect(log).toBeHidden();
  await openChore(kiosk, bins);
  await close.click();
  await expect(log).toBeHidden();
  await openChore(kiosk, bins);
  await log.getByRole("heading", { name: `Log ${bins}` }).click();
  await expect(log).toBeVisible();
  const sheetBox = (await log.boundingBox())!;
  // (10, 10) is on the dimmed page: left of the centred sheet.
  expect(sheetBox.x).toBeGreaterThan(20);
  await kiosk.mouse.click(10, 10);
  await expect(log).toBeHidden();
  await openChore(kiosk, bins);
  await log.getByRole("button", { name: "Log it" }).click();
  await expect(log).toBeHidden();
  // The founder's first: a streak of 1.
  await expect(kiosk.getByTestId("score-pop")).toHaveText(
    `+${pctOf(QUICK_POINTS, multiplierPct(1))}`,
  );
  // An old link to the New tab shows every bounty.
  await kiosk.goto("/kiosk/chores?show=new");
  await expect(tabs.locator('[data-tab="all"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(kiosk.getByTestId(`chore-${mop}`)).toBeVisible();

  // Something added to the list on the Shop page shows in the basket's
  // count, which is how many items are open on the list.
  await kioskNav(kiosk, "Shop");
  const shop = kiosk.locator("main");
  await shop.getByLabel("Add to the list").fill(flour);
  await shop.getByRole("button", { name: "Add", exact: true }).click();
  await expect(shop.getByTestId(`shopping-item-${flour}`)).toBeVisible();
  await kioskNav(kiosk, "Home");
  await expect(kiosk.getByTestId("kiosk-home")).toBeVisible();
  // The list is shared with the specs running alongside, so compare with
  // what brain holds, reading the home again until they agree.
  await expect
    .poll(
      async () => {
        await kiosk.reload();
        const shown = await basket.getAttribute("data-count");
        return Number(shown) === (await openItems(page.request));
      },
      { timeout: 40_000 },
    )
    .toBe(true);
  expect(Number(await basket.getAttribute("data-count"))).toBeGreaterThan(0);
  await expect(basket.locator("[data-badge]")).toHaveText(
    (await basket.getAttribute("data-count"))!,
  );
  // The basket opens the Shop tab.
  await basket.click();
  await expect(kiosk).toHaveURL(/\/kiosk\/shopping$/);
  await expect(
    kiosk.getByRole("heading", { name: "Shopping list", level: 1 }),
  ).toBeVisible();
  await kioskNav(kiosk, "Home");
  await expect(kiosk.getByTestId("kiosk-home")).toBeVisible();

  // The home shows who is acting, so the next person sees whose name a tap
  // logs under; Baumy's sheet shows them picked.
  const chip = kiosk.getByTestId("acting-chip");
  await expect(chip.getByTestId("acting-as")).toHaveText(founder);
  await expectKioskTargets(chip);
  // One look everywhere: the admin page shows the founder exactly as the
  // kitchen screen does (their gallery sprite, or their initial in their
  // colour). The card also shows them in its Character section, so compare
  // the first one.
  const look = (scope: Locator) =>
    scope
      .locator("[data-member-initial], [data-member-sprite]")
      .first()
      .evaluate((el) =>
        el.hasAttribute("data-member-initial")
          ? `${el.textContent} ${getComputedStyle(el).backgroundColor}`
          : (el.querySelector("img")?.getAttribute("src") ?? ""),
      );
  const onKiosk = await look(chip);
  expect(onKiosk).not.toBe("");
  await page.goto("/admin/members");
  expect(await look(page.getByTestId(`member-${founder}`))).toBe(onKiosk);
  const baumy = await openBaumySheet(kiosk);
  await expect(
    baumy
      .getByRole("region", { name: "Who's asking?" })
      .getByRole("button", { name: founder, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await baumy.getByRole("button", { name: "Close" }).click();
  await expect(baumy).toBeHidden();
  // Done: nobody is acting any more.
  await chip.getByRole("button", { name: "Done" }).click();
  await expect(chip).toHaveCount(0);

  // Today's cell opens its sheet with every event; ▶ steps to tomorrow.
  const todayCell = kiosk.locator('[aria-current="date"]');
  await expect(todayCell).toHaveAttribute("data-date", today);
  await todayCell.click();
  let sheet = kiosk.locator(`[data-sheet="${today}"]`);
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Today");
  await expect(sheet).toContainText(dinner);
  await expect(sheet).toContainText("19:00");
  await expect(sheet).toContainText(founder);
  await expectKioskTargets(sheet);
  await sheet.getByRole("button", { name: "Next day" }).click();
  sheet = kiosk.locator(`[data-sheet="${tomorrow}"]`);
  await expect(sheet).toContainText("Tomorrow");
  await expect(sheet).toContainText(vet);
  await expect(sheet).not.toContainText(dinner);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);

  // ▶ is next month, and Today comes back.
  const next = nextMonth(today);
  await kiosk.getByRole("link", { name: "Next month" }).click();
  await expect(kiosk).toHaveURL(new RegExp(`\\?month=${next}$`));
  await expect(kiosk.getByTestId("month-title")).toHaveText(
    monthTitle(`${next}-01`),
  );
  await expect(kiosk.locator(`[data-date="${next}-15"]`)).toBeVisible();
  await kiosk.getByRole("link", { name: "Today" }).click();
  await expect(kiosk).toHaveURL(/\/kiosk$/);
  await expect(kiosk.getByTestId("month-title")).toHaveText(monthTitle(today));

  // A day sheet steps out of its month: the grid follows, the sheet stays.
  const [y, m] = next.split("-").map(Number);
  const lastOfNext = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  const firstAfter = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
  await kiosk.goto(`/kiosk?month=${next}&day=${lastOfNext}`);
  await expect(kiosk.locator(`[data-sheet="${lastOfNext}"]`)).toBeVisible();
  await kiosk.getByRole("button", { name: "Next day" }).click();
  await expect(kiosk).toHaveURL(
    new RegExp(`month=${firstAfter.slice(0, 7)}&day=${firstAfter}$`),
  );
  await expect(kiosk.locator(`[data-sheet="${firstAfter}"]`)).toBeVisible();
  await expect(kiosk.getByTestId("month-title")).toHaveText(
    monthTitle(firstAfter),
  );
  await expectNoScroll(kiosk);
  // Closing it takes the day out of the URL, so a reload keeps it shut.
  await kiosk
    .locator(`[data-sheet="${firstAfter}"]`)
    .getByRole("button", { name: "Close" })
    .click();
  await expect(kiosk).toHaveURL(
    new RegExp(`\\?month=${firstAfter.slice(0, 7)}$`),
  );
  await kiosk.reload();
  await expect(kiosk.getByTestId("month-title")).toHaveText(
    monthTitle(firstAfter),
  );
  await expect(kiosk.locator("[data-sheet]")).toHaveCount(0);

  // Scores: the season's standings, the founder's 20 points among them.
  await kioskNav(kiosk, "Scores");
  await expect(
    kiosk.getByRole("heading", { name: "Scores", level: 1 }),
  ).toBeVisible();
  const standing = kiosk.getByTestId(`standing-${founder}`);
  await expect(standing).toBeVisible();
  await expect(standing).toContainText(/\d+/);
  await expect(kiosk.getByTestId("standings")).toContainText("Rank");

  // With brain slow (for this browser only, BRAIN_SLOW_MS) the rest of the
  // home is there first, and the basket says only "Shopping" while its count
  // is on its way: loading, never "unavailable" before anything failed.
  const brainIs = (value: "slow" | "down") =>
    context.addCookies([
      { name: "baumy_e2e_brain", value, domain: "localhost", path: "/" },
    ]);
  await brainIs("slow");
  await kiosk.goto("/kiosk", { waitUntil: "commit" });
  await expect(kiosk.getByTestId("month-title")).toBeVisible();
  await expect(basket).toHaveAttribute("data-status", "loading");
  await expect(basket).toHaveAttribute("aria-label", "Shopping");
  await expect(basket.locator("[data-badge]")).toHaveCount(0);
  // Then the count comes in, and loading is gone.
  await expect(basket).toHaveAttribute("data-status", "ready", {
    timeout: 15_000,
  });
  await expect(basket).toHaveAttribute("aria-label", /^Shopping: \d+$/);

  // With brain down the basket is still there, dim and with no badge, says
  // "unavailable" only to a screen reader once the read has failed, and
  // nothing on the home says it failed.
  await brainIs("down");
  await kiosk.goto("/kiosk");
  await expect(kiosk.getByTestId("month-title")).toBeVisible();
  await expect(basket).toBeVisible();
  await expect(basket).toHaveAttribute("data-status", "unavailable");
  await expect(basket).toHaveAttribute("aria-label", "Shopping: unavailable");
  await expect(kiosk.locator('[data-status="loading"]')).toHaveCount(0);
  await expect(basket.locator("[data-badge]")).toHaveCount(0);
  expect(await basket.getAttribute("data-count")).toBeNull();
  await expect(kiosk.getByTestId("kiosk-home")).not.toContainText(
    /unavailable|could not be loaded/i,
  );
  await context.clearCookies({ name: "baumy_e2e_brain" });

  await context.close();
});
