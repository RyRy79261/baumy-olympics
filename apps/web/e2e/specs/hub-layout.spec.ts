import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { founderAdmin } from "../lib/household";

// Issue #152: on a desktop the hub's two columns had their own heights, so a
// big empty gap opened under the short wide column (Urgent bounties, Today)
// and "Post a reminder" sat far below it, half as wide as the page. At each
// width the hub's cards stack in their columns with no gap larger than the
// grid's own, and the reminder is as wide as the cards in its column. On a
// phone or a tablet there is one column, and the reminder comes right after
// Today there too, so the order seen is the order read and tabbed through.
//
// Set E2E_SHOTS_DIR to also save the whole hub at each width (the PR's
// before and after shots); otherwise they go to the test's own output folder.

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

type Box = {
  id: string;
  left: number;
  width: number;
  top: number;
  bottom: number;
};

async function cardBoxes(page: Page) {
  return page.evaluate((ids) => {
    const grid = document.querySelector('[data-testid="hub"]')!;
    const boxes = ids.map((id) => {
      const r = document
        .querySelector(`[data-testid="${id}"]`)!
        .getBoundingClientRect();
      return {
        id,
        left: Math.round(r.left),
        width: Math.round(r.width),
        top: r.top + window.scrollY,
        bottom: r.bottom + window.scrollY,
      };
    });
    return { boxes, gap: parseFloat(getComputedStyle(grid).rowGap) };
  }, CARDS);
}

test("the hub's cards stack without gaps at every width", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "desktop-chromium", "Sets its own widths.");
  const shots = process.env.E2E_SHOTS_DIR ?? testInfo.outputPath("hub");
  mkdirSync(shots, { recursive: true });
  await founderAdmin(page, project);

  for (const size of WIDTHS) {
    const label = `${size.width}`;
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto("/");
    // Present first, and settled: the calendar and the shopping list stream
    // in, and their loading state is shorter than what replaces it.
    for (const id of CARDS) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("hub")).not.toContainText("Loading…");
    await page.screenshot({
      path: join(shots, `hub-${label}.png`),
      fullPage: true,
    });

    const { boxes, gap } = await cardBoxes(page);
    expect(gap, `${label}: the grid has a gap`).toBeGreaterThan(0);

    // Columns by their left edge, each read top to bottom.
    const columns = new Map<number, Box[]>();
    for (const box of boxes) {
      columns.set(box.left, [...(columns.get(box.left) ?? []), box]);
    }
    expect(columns.size, `${label}: columns`).toBe(size.columns);
    for (const column of columns.values()) {
      column.sort((a, b) => a.top - b.top);
      for (let i = 1; i < column.length; i++) {
        const above = column[i - 1]!;
        const below = column[i]!;
        const between = below.top - above.bottom;
        expect
          .soft(between, `${label}: gap between ${above.id} and ${below.id}`)
          .toBeGreaterThanOrEqual(gap - 1);
        expect
          .soft(between, `${label}: gap between ${above.id} and ${below.id}`)
          .toBeLessThanOrEqual(gap + 1);
      }
    }

    // The reminder is as wide as the cards it stacks under.
    const reminder = boxes.find((b) => b.id === "post-reminder")!;
    const today = boxes.find((b) => b.id === "widget-events")!;
    expect(reminder.left, `${label}: the reminder's column`).toBe(today.left);
    expect
      .soft(Math.abs(reminder.width - today.width), `${label}: reminder width`)
      .toBeLessThanOrEqual(1);

    if (size.columns === 1) {
      // One column: the cards in their reading order, the reminder after Today.
      const order = [...boxes].sort((a, b) => a.top - b.top).map((b) => b.id);
      expect(order, `${label}: order`).toEqual([
        "widget-chores",
        "widget-events",
        "post-reminder",
        "widget-leaderboard",
        "widget-notes",
        "widget-shopping",
      ]);
    }
  }
});
