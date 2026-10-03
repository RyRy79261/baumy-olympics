import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #152, the hub's layout at every width:
// - the cards stack in their columns with no gap larger than the grid's own
//   (a short wide column used to leave a big hole under Today), and "Post a
//   reminder" stacks under Today, as wide as it; on one column it comes
//   right after Today too, so the order seen is the order read and tabbed;
// - the PIN nudge is one slim strip across the top, not a card, and its ×
//   hides it for that member;
// - there is no visible heading block (owner ruling 2026-10-03): a
//   screen-reader h1 names the page, and it reads PIN strip, header row
//   (clock and tiles), cards, with even room between them;
// - the page is centred, and the strip and the cards share its edges;
// - there is one Ask Baumy button at every width: below 89rem (1424px) in
//   the top bar, tabbed to after the menus; from there in the viewport's
//   bottom-right corner, in the page's side margin, tabbed to last. It
//   covers no card at the top of the page, halfway down or at its end. The
//   sheet opens from either, by tap or key, in the body font.
//
// Set E2E_SHOTS_DIR to also save the hub at each width (the PR's before and
// after shots): `hub-<w>.png` is what the screen shows at the top, with the
// button where it really is, and `hub-<w>-full.png` the whole page (a fixed
// button shows where the first screen ends there, not at the page's foot).

const WIDTHS = [
  { width: 360, height: 780, columns: 1, floats: false }, // a phone
  { width: 768, height: 1024, columns: 1, floats: false }, // a tablet
  // lg: the two columns begin; Baumy stays in the top bar.
  { width: 1024, height: 768, columns: 2, floats: false },
  { width: 1280, height: 800, columns: 2, floats: false },
  // From 89rem the side margin clears the corner, and Baumy moves there.
  { width: 1440, height: 900, columns: 2, floats: true },
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

/** Every box, in viewport pixels. */
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
    return {
      cards,
      gap: parseFloat(getComputedStyle(grid).rowGap),
      // Visible headings in the page itself (the hub's h1 is sr-only).
      visibleHeadings: [...document.querySelectorAll("main h1, main h2")]
        .filter((h) => {
          const r = h.getBoundingClientRect();
          return r.width > 1 && r.height > 1;
        })
        .map((h) => h.textContent ?? ""),
      glance: rect(document.querySelector('[data-testid="hub-glance"]')!),
      grid: rect(grid),
      // The one shown: the bar's below 89rem, the corner's from there.
      baumy: rect(
        [...document.querySelectorAll('button[aria-label="Ask Baumy"]')].find(
          (b) => b.getClientRects().length > 0,
        )!,
      ),
      header: rect(document.querySelector("header")!),
      main: (() => {
        const el = document.querySelector("main")!;
        const r = el.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(el).paddingRight);
        return r.right - pad;
      })(),
      viewport: {
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
      },
    };
  }, CARDS);
}

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Tab from `from` and expect Ask Baumy to have the focus next. */
async function expectBaumyNextAfter(p: Page, from: Locator, label: string) {
  await from.focus();
  await p.keyboard.press("Tab");
  await expect(
    p.getByRole("button", { name: "Ask Baumy" }),
    `${label}: Ask Baumy tabbed to next`,
  ).toBeFocused();
}

/** The sheet's own text is in the body font, not the nav's label font. */
async function expectSheetFont(p: Page, label: string) {
  const fonts = await p.evaluate(() => {
    const dialog = document.querySelector('dialog[aria-label="Ask Baumy"]')!;
    return {
      dialog: getComputedStyle(dialog).fontFamily,
      body: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(fonts.dialog, `${label}: the sheet's font`).toBe(fonts.body);
}

test("the hub reads strip, header row, cards, with Baumy placed right", async ({
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
    // The phone's line is shorter, so it stays one line.
    await expect(
      strip.getByText(
        size.width < 640
          ? "Set your kitchen PIN"
          : "Set your personal PIN for the kitchen iPad",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(p.getByTestId("widget-leaderboard")).toContainText("Scores");
    // Exactly one Baumy button at every width.
    await expect(p.getByRole("button", { name: "Ask Baumy" })).toHaveCount(1);
    await p.screenshot({ path: join(shots, `hub-${label}.png`) });
    await p.screenshot({
      path: join(shots, `hub-${label}-full.png`),
      fullPage: true,
    });

    const m = await measure(p);

    // No eyebrow, title or welcome line: only the cards' own titles show,
    // and the page is still named by its h1.
    expect(m.visibleHeadings, `${label}: visible headings`).not.toContain(
      "Hub",
    );
    await expect(
      p.getByRole("heading", { name: "Hub", level: 1 }),
      `${label}: the page's h1`,
    ).toHaveCount(1);
    await expect(p.getByText("Baumy Olympics", { exact: true })).toHaveCount(0);
    await expect(p.getByText(/^Welcome, /)).toHaveCount(0);

    // The strip: one line of text, as wide as the cards.
    const s = (await strip.boundingBox())!;
    expect(s.height, `${label}: strip height`).toBeLessThan(STRIP_MAX_PX);
    const lines = await strip.locator("p").evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight);
      return el.getBoundingClientRect().height / lh;
    });
    expect(lines, `${label}: the strip's lines`).toBeLessThan(1.5);
    expect(
      Math.abs(s.width - (m.grid.right - m.grid.left)),
      `${label}: strip width`,
    ).toBeLessThanOrEqual(1);

    // The page is centred, and the strip and the cards share its edges.
    const cardsRight = Math.max(...m.cards.map((c) => c.right));
    expect(
      Math.abs(s.x + s.width - cardsRight),
      `${label}: strip and cards end together`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(cardsRight - m.main),
      `${label}: cards use the full width`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(m.grid.left - (m.viewport.width - m.grid.right)),
      `${label}: the cards are centred`,
    ).toBeLessThanOrEqual(1);

    // Strip, header row, cards: the same room before and after the row.
    const above = m.glance.top - (s.y + s.height);
    const below = m.grid.top - m.glance.bottom;
    expect(above, `${label}: strip to header row`).toBeGreaterThan(0);
    expect(above, `${label}: strip to header row`).toBeLessThanOrEqual(32);
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

    const { baumy, viewport } = m;
    expect(baumy.right, `${label}: Baumy on screen`).toBeLessThanOrEqual(
      viewport.width,
    );
    if (!size.floats) {
      // Below 89rem: in the top bar, tabbed to right after the account menu.
      expect(
        baumy.top,
        `${label}: Baumy in the top bar`,
      ).toBeGreaterThanOrEqual(m.header.top);
      expect(
        baumy.bottom,
        `${label}: Baumy in the top bar`,
      ).toBeLessThanOrEqual(m.header.bottom);
      await expectBaumyNextAfter(
        p,
        p.getByTestId("account-menu").getByRole("button"),
        label,
      );
    } else {
      // From 89rem: in the viewport's bottom-right corner, and tabbed to
      // last, right after the last thing in the cards.
      expect(baumy.bottom, `${label}: Baumy on screen`).toBeLessThanOrEqual(
        viewport.height,
      );
      expect(baumy.right, `${label}: Baumy at the right`).toBeGreaterThan(
        viewport.width - CORNER_PX,
      );
      expect(baumy.bottom, `${label}: Baumy at the bottom`).toBeGreaterThan(
        viewport.height - CORNER_PX,
      );
      await expectBaumyNextAfter(
        p,
        p
          .getByTestId("hub")
          .locator("a[href], button:not([disabled]), input, textarea, select")
          .last(),
        label,
      );
    }
    // Over no card: at the top of the page, halfway down and at its end.
    for (const [where, to] of [
      ["top", 0],
      ["halfway", 0.5],
      ["end", 1],
    ] as const) {
      await p.evaluate(
        (f) =>
          window.scrollTo(
            0,
            (document.documentElement.scrollHeight - window.innerHeight) * f,
          ),
        to,
      );
      const at = await measure(p);
      for (const card of at.cards) {
        expect
          .soft(
            overlaps(at.baumy, card),
            `${label}, ${where}: Baumy over ${card.id}`,
          )
          .toBe(false);
      }
    }
  }

  // The × hides the strip for this member, and it stays hidden.
  const strip = p.getByTestId("set-pin-nudge");
  await expect(strip).toBeVisible();
  await p.getByRole("button", { name: "Hide the PIN reminder" }).click();
  await expect(strip).toHaveCount(0);
  await expect(p.getByRole("heading", { name: "Hub", level: 1 })).toBeFocused();
  await p.reload();
  await expect(p.getByTestId("widget-events")).toBeVisible();
  await expect(strip).toHaveCount(0);
  await member.context.close();
});

test("the Ask Baumy sheet opens from the top bar on a phone, and from the corner", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "desktop-chromium", "Sets its own widths.");
  const shots = process.env.E2E_SHOTS_DIR ?? testInfo.outputPath("hub");
  mkdirSync(shots, { recursive: true });
  await founderAdmin(page, project);
  const sheet = page.getByRole("dialog", { name: "Ask Baumy" });
  const button = page.getByRole("button", { name: "Ask Baumy" });

  // A phone: the top bar's button, by tap.
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/");
  await expect(page.getByTestId("widget-events")).toBeVisible();
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("baumy-says")).toContainText(
    "Tell me what you did",
  );
  await expectSheetFont(page, "360");
  await page.screenshot({ path: join(shots, "hub-360-sheet.png") });
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // And by keyboard: Tab from the account menu, then Enter.
  await expectBaumyNextAfter(
    page,
    page.getByTestId("account-menu").getByRole("button"),
    "360",
  );
  await page.keyboard.press("Enter");
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Closing gives the focus back to the button that opened it.
  await expect(button).toBeFocused();

  // A wide screen: the corner button.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("widget-events")).toBeVisible();
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(sheet).toBeVisible();
  await expectSheetFont(page, "1440");
  await page.screenshot({ path: join(shots, "hub-1440-sheet.png") });
});
