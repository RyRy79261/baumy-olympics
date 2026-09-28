import { expect, test, type Locator, type Page } from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin } from "../lib/household";
import {
  expectKioskTargets,
  kioskNav,
  openBaumySheet,
  pairedKiosk,
} from "../lib/kiosk";

// Issue #65 (ADR 0005): the portrait kitchen dashboard on the iPad
// (820×1180). One screen that never scrolls: the date, a big clock and the
// Urgent, New and Messages icons; each icon opens its calm module, and a
// bounty's "I'll do it" leads to logging it. Under it the month calendar:
// ◀ ▶ and Today move by month, a day opens its sheet with every event, and
// the sheet steps day by day, into the next month too. The footer nav leads
// to the other kiosk pages, and Baumy stands over its right end.
//
// The calendar and the chores are shared by the specs running in parallel,
// so each has a name of its own.

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

test("the kitchen dashboard: icons, modules, the month and its days", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  // The founder works on a phone and the kiosk is a context of its own at
  // 820×1180 (pairedKiosk), as in hub.spec: the ipad-portrait founder
  // already pairs close to pair_kiosk's 10 codes per 10 minutes.
  test.skip(project !== "mobile-360", "Paired from the phone project.");
  const tag = Math.random().toString(36).slice(2, 8);
  const bins = `Bins ${tag}`;
  const milk = `Oat milk ${tag}`;
  const dinner = `Dinner ${tag}`;
  const vet = `Vet ${tag}`;
  const founder = `Founder ${project}`;
  const today = berlinDay();
  const tomorrow = berlinDay(1);

  // Two new chores, never done, so due now: urgent and new. One is bought.
  await founderAdmin(page, project);
  await addChore(page, { name: bins, basePoints: 20, cooldownHours: 0 });
  await addChore(page, {
    name: milk,
    basePoints: 10,
    cooldownHours: 0,
    kind: "consumable",
  });
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

  // Urgent: both bounties, filtered by kind, each with its kind, deadline
  // and points.
  const urgent = kiosk.locator('[data-icon="urgent"]');
  expect(Number(await urgent.getAttribute("data-count"))).toBeGreaterThan(1);
  await urgent.click();
  const module = kiosk.getByRole("dialog", { name: "Urgent" });
  await expect(module).toBeVisible();
  await expectKioskTargets(module);
  const binsRow = module.getByTestId(`bounty-${bins}`);
  const milkRow = module.getByTestId(`bounty-${milk}`);
  await expect(binsRow).toContainText("Maintenance");
  await expect(binsRow).toContainText("no streak yet");
  await expect(binsRow).toContainText("Never done");
  await expect(binsRow).toContainText("+20");
  await expect(binsRow).toContainText("new");
  await expect(milkRow).toContainText("Consumable");
  await module.getByRole("button", { name: /^Consumables/ }).click();
  await expect(milkRow).toBeVisible();
  await expect(binsRow).toHaveCount(0);
  await module.getByRole("button", { name: /^Maintenance/ }).click();
  await expect(binsRow).toBeVisible();
  await expect(milkRow).toHaveCount(0);
  await module.getByRole("button", { name: "Close" }).click();
  await expect(module).toBeHidden();

  // New lists them too; the Messages module opens and closes.
  await kiosk.locator('[data-icon="new"]').click();
  const fresh = kiosk.getByRole("dialog", { name: "New bounties" });
  await expect(fresh.getByTestId(`bounty-${milk}`)).toBeVisible();
  await kiosk.keyboard.press("Escape");
  await expect(fresh).toBeHidden();
  await kiosk.locator('[data-icon="messages"]').click();
  const messages = kiosk.getByRole("dialog", { name: "Messages" });
  await expect(messages).toBeVisible();
  const message = messages.getByTestId(`message-${note}`);
  await expect(message).toContainText(founder);
  await expect(message).toContainText(/just now|\dm ago/);
  await expect(message.locator("strong")).toHaveText("shoe rack");
  await messages.getByRole("button", { name: "Close" }).click();
  await expect(messages).toBeHidden();

  // "I'll do it" leads to logging it: tap in, and its sheet is open.
  await urgent.click();
  await module
    .getByTestId(`bounty-${bins}`)
    .getByRole("link", { name: `I'll do ${bins}` })
    .click();
  await expect(kiosk).toHaveURL(/\/kiosk\/chores\?chore=/);
  await expect(
    kiosk.getByRole("heading", { name: "Bounties", level: 1 }),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "Bounties" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  const log = kiosk.getByRole("dialog", { name: `Log ${bins}` });
  await expect(log).toBeVisible();
  await log.getByRole("button", { name: "Log it" }).click();
  await expect(log).toBeHidden();
  await expect(kiosk.getByTestId("score-pop")).toHaveText("+20");

  // Home again: it is not urgent any more.
  await kioskNav(kiosk, "Home");
  await expect(kiosk.getByTestId("kiosk-home")).toBeVisible();
  await urgent.click();
  await expect(module.getByTestId(`bounty-${milk}`)).toBeVisible();
  await expect(module.getByTestId(`bounty-${bins}`)).toHaveCount(0);
  await module.getByRole("button", { name: "Close" }).click();

  // The home shows who is acting, so the next person sees whose name a tap
  // logs under; Baumy's sheet shows them picked.
  const chip = kiosk.getByTestId("acting-chip");
  await expect(chip.getByTestId("acting-as")).toHaveText(founder);
  await expectKioskTargets(chip);
  // One character everywhere: the admin page draws the founder exactly as
  // the kitchen screen does (the same colours, pixel for pixel).
  const fills = (scope: Locator) =>
    scope
      .locator("[data-housemate] path")
      .evaluateAll((ps) => ps.map((p) => p.getAttribute("fill")).sort());
  const onKiosk = await fills(chip);
  expect(onKiosk.length).toBeGreaterThan(3);
  await page.goto("/admin/members");
  expect(await fills(page.getByTestId(`member-${founder}`))).toEqual(onKiosk);
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

  await context.close();
});
