import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #152, the hub's layout at every width:
// - the cards stack in their columns with no gap larger than the grid's own
//   (a short wide column used to leave a big hole under Today), and "Post a
//   reminder" stacks under Today, as wide as it; on one column it comes
//   right after Today too, so the order seen is the order read and tabbed;
// - the PIN nudge is one slim strip across the top, not a card, and its ×
//   hides it for that member;
// - the page reads heading, header row (clock and tiles), cards, with even
//   room between them;
// - Baumy's button sits in the viewport's bottom-right corner, and from a
//   portrait tablet up it never covers a card, wherever the page is
//   scrolled; on a phone the page's end scrolls clear of it.
//
// Set E2E_SHOTS_DIR to also save the hub at each width (the PR's before and
// after shots): `hub-<w>.png` is what the screen shows at the top, with the
// button where it really is, and `hub-<w>-full.png` the whole page (a fixed
// button shows where the first screen ends there, not at the page's foot).

const WIDTHS = [
  { width: 360, height: 780, columns: 1 }, // a phone
  { width: 768, height: 1024, columns: 1 }, // a tablet, portrait
  { width: 1024, height: 768, columns: 2 }, // lg: the two columns begin
  { width: 1280, height: 800, columns: 2 },
  { width: 1440, height: 900, columns: 2 },
];

/** The hub's cards, in reading order on one column. */
const CARDS = [
  "widget-chores",
  "widget-events",
  "post-reminder",
  "widget-leaderboard",
  "widget-notes",
  "widget-shopping",
];

/** The most the PIN strip may take: one line, never a card. */
const STRIP_MAX_PX = 64;
/** How far into the corner Baumy's button must sit, from each edge. */
const CORNER_PX = 32;

type Rect = { left: number; right: number; top: number; bottom: number };
type Box = Rect & { id: string; width: number };

/** Every box in viewport pixels, plus page-relative tops for the stacking. */
async function measure(page: Page) {
  return page.evaluate((ids) => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const grid = document.querySelector('[data-testid="hub"]')!;
    const cards = ids.map((id) => {
      const r = rect(document.querySelector(`[data-testid="${id}"]`)!);
      return { id, ...r, width: r.right - r.left };
    });
    const h1 = document.querySelector("h1")!;
    return {
      cards,
      gap: parseFloat(getComputedStyle(grid).rowGap),
      heading: rect(h1.parentElement!.parentElement!),
      glance: rect(document.querySelector('[data-testid="hub-glance"]')!),
      grid: rect(grid),
      baumy: rect(document.querySelector('button[aria-label="Ask Baumy"]')!),
      viewport: {
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
      },
    };
  }, CARDS);
}

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

test("the hub reads heading, header row, cards, with Baumy in the corner", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "desktop-chromium", "Sets its own widths.");
  const shots = process.env.E2E_SHOTS_DIR ?? testInfo.outputPath("hub");
  mkdirSync(shots, { recursive: true });

  // A member who just joined has no personal PIN, so the nudge shows.
  await founderAdmin(page, project);
  const code = await mintCode(page, 1);
  const member = await newAccount(browser, `layout-${project}`);
  await redeem(member.page, code, `Layout ${project}`);
  await expect(member.page).toHaveURL(/\/$/);
  const p = member.page;

  for (const size of WIDTHS) {
    const label = `${size.width}`;
    await p.setViewportSize({ width: size.width, height: size.height });
    await p.goto("/");
    // Present first, and settled: the calendar and the shopping list stream
    // in, and their loading state is shorter than what replaces it; the
    // strip comes in once the page reads this device's storage.
    for (const id of CARDS) await expect(p.getByTestId(id)).toBeVisible();
    await expect(p.getByTestId("hub")).not.toContainText("Loading…");
    const strip = p.getByTestId("set-pin-nudge");
    await expect(strip).toContainText(
      "Set your personal PIN for the kitchen iPad",
    );
    await expect(p.getByTestId("widget-leaderboard")).toContainText("Scores");
    await p.screenshot({ path: join(shots, `hub-${label}.png`) });
    await p.screenshot({
      path: join(shots, `hub-${label}-full.png`),
      fullPage: true,
    });

    const m = await measure(p);

    // The strip: one line, as wide as the heading's row.
    const s = (await strip.boundingBox())!;
    expect(s.height, `${label}: strip height`).toBeLessThan(STRIP_MAX_PX);
    expect(
      Math.abs(s.width - (m.heading.right - m.heading.left)),
      `${label}: strip width`,
    ).toBeLessThanOrEqual(1);
    expect(s.y + s.height, `${label}: strip above the heading`).toBeLessThan(
      m.heading.top + 1,
    );

    // Heading, header row, cards: the same room before and after the row.
    const above = m.glance.top - m.heading.bottom;
    const below = m.grid.top - m.glance.bottom;
    expect(above, `${label}: heading to header row`).toBeGreaterThan(0);
    expect(above, `${label}: heading to header row`).toBeLessThanOrEqual(32);
    expect(
      Math.abs(above - below),
      `${label}: even room around the header row`,
    ).toBeLessThanOrEqual(1);

    // The cards stack in their columns with only the grid's gap.
    expect(m.gap, `${label}: the grid has a gap`).toBeGreaterThan(0);
    const columns = new Map<number, Box[]>();
    for (const box of m.cards) {
      const key = Math.round(box.left);
      columns.set(key, [...(columns.get(key) ?? []), box]);
    }
    expect(columns.size, `${label}: columns`).toBe(size.columns);
    for (const column of columns.values()) {
      column.sort((a, b) => a.top - b.top);
      for (let i = 1; i < column.length; i++) {
        const top = column[i - 1]!;
        const next = column[i]!;
        const between = next.top - top.bottom;
        const what = `${label}: gap between ${top.id} and ${next.id}`;
        expect.soft(between, what).toBeGreaterThanOrEqual(m.gap - 1);
        expect.soft(between, what).toBeLessThanOrEqual(m.gap + 1);
      }
    }

    // The reminder is as wide as the cards it stacks under.
    const reminder = m.cards.find((b) => b.id === "post-reminder")!;
    const today = m.cards.find((b) => b.id === "widget-events")!;
    expect(Math.round(reminder.left), `${label}: the reminder's column`).toBe(
      Math.round(today.left),
    );
    expect
      .soft(Math.abs(reminder.width - today.width), `${label}: reminder width`)
      .toBeLessThanOrEqual(1);
    if (size.columns === 1) {
      const order = [...m.cards].sort((a, b) => a.top - b.top).map((b) => b.id);
      expect(order, `${label}: order`).toEqual(CARDS);
    }

    // Baumy's button, in the viewport's bottom-right corner.
    const { baumy, viewport } = m;
    expect(baumy.right, `${label}: Baumy on screen`).toBeLessThanOrEqual(
      viewport.width,
    );
    expect(baumy.bottom, `${label}: Baumy on screen`).toBeLessThanOrEqual(
      viewport.height,
    );
    expect(baumy.right, `${label}: Baumy at the right`).toBeGreaterThan(
      viewport.width - CORNER_PX,
    );
    expect(baumy.bottom, `${label}: Baumy at the bottom`).toBeGreaterThan(
      viewport.height - CORNER_PX,
    );
    // From a tablet up no card is ever under it: at the top of the page,
    // and scrolled to the end.
    if (size.width >= 768) {
      for (const card of m.cards) {
        expect
          .soft(overlaps(baumy, card), `${label}: Baumy over ${card.id}`)
          .toBe(false);
      }
    }
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const end = await measure(p);
    for (const card of end.cards) {
      expect
        .soft(
          overlaps(end.baumy, card),
          `${label}, scrolled: Baumy over ${card.id}`,
        )
        .toBe(false);
    }
  }

  // The × hides the strip for this member, and it stays hidden.
  const strip = p.getByTestId("set-pin-nudge");
  await expect(strip).toBeVisible();
  await p.getByRole("button", { name: "Hide the PIN reminder" }).click();
  await expect(strip).toHaveCount(0);
  await p.reload();
  await expect(p.getByTestId("widget-events")).toBeVisible();
  await expect(strip).toHaveCount(0);
  await member.context.close();
});
