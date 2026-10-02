import { expect, test } from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { openAccountMenu, openAdminMenu } from "../lib/nav";

// Issue #64: the pixel UI kit (ADR 0005), a visual smoke in every project
// (desktop-chromium, ipad-portrait, mobile-360). The pages are dark plum,
// set in the pixel fonts, with Baumy (Camp 404's cat) drawn as a sprite
// strip that plays only when motion is allowed.

const PLUM = "rgb(20, 12, 31)"; // --color-bm-bg, #140c1f

test("sign-in is the pixel kit: dark, pixel fonts, Baumy on top", async ({
  page,
}) => {
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe(PLUM);

  // The display, label and reading fonts are loaded and in use.
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    h1: getComputedStyle(document.querySelector("h1")!).fontFamily,
    label: getComputedStyle(document.querySelector("label")!).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
    loaded: [...document.fonts]
      .filter((f) => f.status === "loaded")
      .map((f) => f.family),
  }));
  expect(fonts.h1).toMatch(/Press Start 2P/);
  expect(fonts.label).toMatch(/Silkscreen/);
  expect(fonts.body).toMatch(/Pixelify Sans/);
  expect(fonts.loaded.join()).toMatch(/Press Start 2P/);

  // Baumy: the cat's four idle frames in one strip, 34 × 32 art pixels.
  const baumy = page.locator('[data-sprite="baumy"]');
  await expect(baumy).toHaveCount(1);
  await expect(baumy).toHaveAttribute("data-state", "idle");
  const strip = baumy.locator("[data-frames] > svg");
  await expect(strip).toHaveAttribute("viewBox", "0 0 136 32");
  const box = (await baumy.locator("[data-frames]").boundingBox())!;
  expect(box.width).toBe(34 * 3);
  expect(box.height).toBe(32 * 3);

  // The primary button is framed in pixels, not rounded.
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  const style = await signIn.evaluate((el) => {
    const s = getComputedStyle(el);
    return { clip: s.clipPath, radius: s.borderTopLeftRadius };
  });
  expect(style.clip).toMatch(/^polygon/);
  expect(style.radius).toBe("0px");
});

test("Baumy's frames play, and stand still under reduced motion", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "One browser is enough.",
  );
  await page.goto("/auth/sign-in");
  const strip = page.locator('[data-sprite="baumy"] [data-frames] > svg');
  const animation = () =>
    strip.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        name: s.animationName,
        duration: s.animationDuration,
        timing: s.animationTimingFunction,
      };
    });
  // Four frames of 450 ms, one hard step each.
  expect(await animation()).toEqual({
    name: "sprite-strip",
    duration: "1.8s",
    timing: "steps(4)",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect((await animation()).name).toBe("none");
});

test("the hub shell: the Baumy badge by the brand, the page you are on framed", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  await page.goto("/chores");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe(PLUM);
  const header = page.locator("header").first();
  // The brand mark is the app icon's badge (issue #81).
  await expect(header.locator('[data-sprite="baumy-badge"]')).toHaveCount(1);
  await expect(
    header.locator('[data-sprite="baumy-badge"] svg'),
  ).toHaveAttribute("viewBox", "0 0 40 40");
  const nav = page.getByRole("navigation", { name: "Main" });
  const current = nav.locator('[aria-current="page"]');
  await expect(current).toHaveText("Bounties");
  expect(await current.evaluate((el) => getComputedStyle(el).clipPath)).toMatch(
    /^polygon/,
  );
  const other = nav.getByRole("link", { name: "Calendar", exact: true });
  await expect(other).toBeVisible();
  expect(await other.evaluate((el) => getComputedStyle(el).clipPath)).toBe(
    "none",
  );

  // The wide pixel fonts never push the page wider than the screen (a
  // phone would zoom out, and taps would miss).
  await expect(page.getByRole("list", { name: "Bounties" })).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);

  // Activity, the nav's last page (issue #150), is wholly on screen at
  // every width: nothing hides it in an overflow.
  const activity = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Activity", exact: true });
  await expect(activity).toBeVisible();
  const onScreen = await activity.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    const hits = [r.left + 2, r.left + r.width / 2, r.right - 2].map((x) =>
      el.contains(document.elementFromPoint(x, y)),
    );
    return r.left >= 0 && r.right <= window.innerWidth && hits.every(Boolean);
  });
  expect(onScreen).toBe(true);

  // The admin pages and the account fold into menus that close again.
  await expect(nav.getByRole("link", { name: "Members" })).toHaveCount(0);
  await openAdminMenu(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Members" })).toHaveCount(0);
  await openAccountMenu(page);
  await expect(page.getByRole("link", { name: "Sign out" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign out" })).toHaveCount(0);
});

test("on a laptop the whole header is one row", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "The laptop width (1280) is desktop-chromium's.",
  );
  await founderAdmin(page, testInfo.project.name);
  await page.goto("/");
  const header = page.locator("header").first();
  const rows = await header.evaluate((h) => {
    const tops = [
      ...h.querySelectorAll(
        'nav[aria-label="Main"] a, [data-testid$="-menu"] > button',
      ),
    ].map((el) => Math.round(el.getBoundingClientRect().top));
    return { tops: [...new Set(tops)], count: tops.length };
  });
  // Eight pages (Activity the last), Admin and the account.
  expect(rows.count).toBe(10);
  expect(rows.tops).toHaveLength(1);
  // And nothing in the nav is cut off: it does not need to scroll.
  const nav = page.getByRole("navigation", { name: "Main" });
  expect(await nav.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
});

// Issue #67: every hub page in the kit, as the approved prototype lays it
// out: the page title in the display font, nothing wider than the screen,
// and a screenshot of each attached to the report for a look.
const PAGES: { path: string; title: string }[] = [
  { path: "/", title: "Hub" },
  { path: "/chores", title: "Bounties" },
  { path: "/calendar?view=month", title: "Calendar" },
  { path: "/notes", title: "Board" },
  { path: "/shopping", title: "Shopping list" },
  { path: "/scores", title: "Scores" },
  { path: "/pot", title: "Pot" },
  { path: "/activity", title: "Activity" },
  { path: "/settings", title: "Settings" },
  { path: "/admin/chores", title: "Edit chores" },
  { path: "/admin/members", title: "Members" },
  { path: "/admin/weights", title: "Weights" },
];

test("every hub page is in the kit and fits the screen", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);

  // The hub's top row: the clock and the three status tiles, each a
  // 16-bit icon; a tile with nothing to show is dim and has no badge.
  await expect(page.getByTestId("clock-time")).toHaveText(/^\d\d:\d\d$/);
  for (const key of ["urgent", "new", "messages"]) {
    const tile = page.getByTestId(`hub-tile-${key}`);
    await expect(tile).toBeVisible();
    await expect(tile.locator("svg").first()).toBeVisible();
    // Every read works here, so each tile has a real count.
    const name = (await tile.getAttribute("aria-label"))!;
    expect(name).toMatch(/: \d+$/);
    const count = Number(name.split(": ")[1]);
    await expect(tile.locator("[data-count]")).toHaveCount(count > 0 ? 1 : 0);
    await expect(tile.locator("[data-unavailable]")).toHaveCount(0);
  }

  for (const { path, title } of PAGES) {
    await page.goto(path);
    const h1 = page.getByRole("heading", { name: title, level: 1 });
    await expect(h1).toBeVisible();
    expect(await h1.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(
      /Press Start 2P/,
    );
    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(
      width.scroll,
      `${path} is no wider than the screen`,
    ).toBeLessThanOrEqual(width.client);
    await testInfo.attach(`${testInfo.project.name}${path}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
});
