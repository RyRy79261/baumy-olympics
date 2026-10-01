import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { pairedKiosk } from "../lib/kiosk";

// Issue #127: on the kitchen iPad the dashboard's clock touched the Urgent
// icon. At each portrait iPad size the date and the time keep a clear gap
// from the icons (and their badges), even with the widest date and time
// the clock can show, and the icons stay on the screen.
//
// Set E2E_SHOTS_DIR to also save the header at each size (the PR's before
// and after shots); otherwise they go to the test's own output folder.

/** The iPads the kiosk runs on, portrait, in CSS pixels. */
const IPADS = [
  { width: 820, height: 1180 }, // iPad Air / 10th gen: the kitchen's
  { width: 768, height: 1024 }, // iPad mini, older iPads
  { width: 834, height: 1194 }, // iPad Pro 11"
];

/** The least room between the clock's text and the first icon, in px. */
const MIN_GAP = 16;

// The widest the clock gets: the longest weekday and month with a two-digit
// day, and a time of wide digits (the display font is monospaced, but the
// fallback need not be).
const WIDEST_DATE = "Wednesday 30 September";
const WIDEST_TIME = "00:00";

type Box = { left: number; right: number; top: number; bottom: number };

/** Where the clock's text actually is, and the icons with their badges. */
async function headerBoxes(kiosk: Page) {
  return kiosk.evaluate(() => {
    const text = (testId: string): Box => {
      const el = document.querySelector(`[data-testid="${testId}"]`)!;
      // The ink, not the block: the text may overflow its box.
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const icons = ["urgent", "new", "messages"].map((key) => {
      const el = document.querySelector(`[data-icon="${key}"]`)!;
      const r = el.getBoundingClientRect();
      const box: Box = {
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
      const badge = el.querySelector("[data-badge]");
      if (badge) {
        const b = badge.getBoundingClientRect();
        box.left = Math.min(box.left, b.left);
        box.right = Math.max(box.right, b.right);
        box.top = Math.min(box.top, b.top);
      }
      return box;
    });
    return {
      date: text("clock-date"),
      time: text("clock-time"),
      icons,
      viewport: document.documentElement.clientWidth,
    };
  });
}

async function expectClear(kiosk: Page, label: string) {
  const { date, time, icons, viewport } = await headerBoxes(kiosk);
  const first = icons[0]!;
  for (const [name, box] of [
    ["date", date],
    ["time", time],
  ] as const) {
    expect(
      first.left - box.right,
      `${label}: room between the ${name} and the Urgent icon`,
    ).toBeGreaterThanOrEqual(MIN_GAP);
    expect(box.left, `${label}: the ${name} starts on screen`).toBeGreaterThan(
      0,
    );
  }
  for (const icon of icons) {
    expect(icon.right, `${label}: an icon ends on screen`).toBeLessThanOrEqual(
      viewport,
    );
  }
  // Icons in a row, never on top of each other.
  for (let i = 1; i < icons.length; i++) {
    expect(icons[i]!.left, `${label}: icons apart`).toBeGreaterThan(
      icons[i - 1]!.right,
    );
  }
}

test("the dashboard clock never touches the icons on an iPad", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  // Paired from the phone project, as kiosk-dashboard.spec is: the
  // ipad-portrait founder already pairs close to pair_kiosk's limit.
  test.skip(project !== "mobile-360", "Paired from the phone project.");
  const shots = process.env.E2E_SHOTS_DIR ?? testInfo.outputPath("clock");
  mkdirSync(shots, { recursive: true });
  await founderAdmin(page, project);
  const tag = Math.random().toString(36).slice(2, 8);
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${tag}`,
  );

  for (const size of IPADS) {
    const label = `${size.width}x${size.height}`;
    await kiosk.setViewportSize(size);
    await kiosk.goto("/kiosk");
    await expect(kiosk.getByTestId("clock-time")).toHaveText(/^\d\d:\d\d$/);
    await expect(kiosk.locator('[data-icon="urgent"]')).toBeVisible();
    // Today's date and time, as they are.
    await expectClear(kiosk, `${label}, today`);

    // The widest date and time it can show. React rewrites the text only
    // when the minute changes, and every time is as wide in the monospaced
    // display font, so a minute ticking over changes no width.
    await kiosk.evaluate(
      ([date, time]) => {
        document.querySelector('[data-testid="clock-date"]')!.textContent =
          date!;
        document.querySelector('[data-testid="clock-time"]')!.textContent =
          time!;
      },
      [WIDEST_DATE, WIDEST_TIME],
    );
    await expect(kiosk.getByTestId("clock-date")).toHaveText(WIDEST_DATE);
    await expectClear(kiosk, `${label}, widest`);
    await kiosk
      .locator("header")
      .first()
      .screenshot({ path: join(shots, `header-${label}.png`) });
    await kiosk.screenshot({ path: join(shots, `kiosk-${label}.png`) });
  }

  await context.close();
});
