import { expect, test } from "@playwright/test";
import { founderAdmin } from "../lib/household";

// Issue #64: the pixel UI kit (ADR 0005), a visual smoke in every project
// (desktop-chromium, ipad-landscape, mobile-360). The pages are dark plum,
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

test("the hub shell: Baumy by the brand, the page you are on framed", async ({
  page,
}, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  await page.goto("/chores");
  expect(
    await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
  ).toBe(PLUM);
  const header = page.locator("header").first();
  await expect(header.locator('[data-sprite="baumy"]')).toHaveCount(1);
  const nav = page.getByRole("navigation", { name: "Main" });
  const current = nav.locator('[aria-current="page"]');
  await expect(current).toHaveText("Chores");
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
  await expect(page.getByRole("list", { name: "Chores" })).toBeVisible();
  const width = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(width.scroll).toBeLessThanOrEqual(width.client);
});
