import { expect, test } from "@playwright/test";
import { founderAdmin } from "../lib/household";

// Issue #122: the landing page is the one page for search engines and link
// previews: it carries the share card, the X card and its canonical URL;
// every other page is noindex, and robots.txt keeps crawlers out of them.

const SITE = "https://www.baumy.tech";

test("the landing page carries the share card, the X card and its canonical URL", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Baumy Olympics");
  const ogImage = page.locator('meta[property="og:image"]');
  await expect(ogImage).toHaveAttribute(
    "content",
    new RegExp(`^${SITE}/opengraph-image`),
  );
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
    "content",
    "1200",
  );
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute(
    "content",
    "Baumy Olympics",
  );
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
    "content",
    "en_GB",
  );
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );
  await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
    "content",
    new RegExp(`^${SITE}/twitter-image`),
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    SITE,
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index, follow",
  );

  // The card the tag points at, fetched from this server.
  const { pathname, search } = new URL(
    (await ogImage.getAttribute("content"))!,
  );
  const res = await request.get(pathname + search);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const png = await res.body();
  // The PNG signature, then the IHDR chunk's width and height.
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});

test("/opengraph-image is a 1200x630 PNG", async ({ request }) => {
  const res = await request.get("/opengraph-image");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  const png = await res.body();
  expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(630);
});

test("robots.txt lets crawlers see / only, and the sitemap lists it", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /");
  for (const path of ["/api/", "/kiosk", "/admin", "/join", "/auth/"]) {
    expect(robots).toContain(`Disallow: ${path}`);
  }
  expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain(`<loc>${SITE}/</loc>`);
  expect(sitemap.match(/<loc>/g)).toHaveLength(1);
});

test("sign-in is noindex for a visitor", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  await expect(page).toHaveTitle("Sign in · Baumy Olympics");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
});

test("a hub page is noindex for a member", async ({ page }, testInfo) => {
  await founderAdmin(page, testInfo.project.name);
  await page.goto("/chores");
  await expect(page).toHaveURL(/\/chores$/);
  await expect(page).toHaveTitle("Bounties · Baumy Olympics");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, nofollow",
  );
});
