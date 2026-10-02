import { expect, test, type Page } from "@playwright/test";
import { founderAdmin } from "../lib/household";
import { openKioskChores, pairedKiosk } from "../lib/kiosk";

// Issue #29 on the kitchen iPad (ipad-portrait): the web app manifest and
// icons that make the home-screen app open full screen in portrait, the
// screen wake lock, the 60-second idle reset (with its
// countdown, from any kiosk page), and the offline page. Night mode moves
// the server clock, so it is kiosk-night.spec.ts (the server-clock project).

const KIOSK_ONLY = "The kiosk is an iPad in portrait.";

/**
 * A stand-in for Safari's Screen Wake Lock, installed before the page loads:
 * it refuses until `window.__wake.allow` is true, and `window.__wake.drop()`
 * lets a held lock go, as the browser does when the page is hidden.
 */
function fakeWakeLock() {
  type Sentinel = EventTarget & {
    released: boolean;
    release(): Promise<void>;
  };
  const state = {
    allow: false,
    held: null as Sentinel | null,
    drop() {
      void state.held?.release();
    },
  };
  (window as unknown as { __wake: typeof state }).__wake = state;
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: async () => {
        if (!state.allow) {
          throw new DOMException("Wake lock refused", "NotAllowedError");
        }
        const sentinel = new EventTarget() as Sentinel;
        sentinel.released = false;
        sentinel.release = async () => {
          if (sentinel.released) return;
          sentinel.released = true;
          sentinel.dispatchEvent(new Event("release"));
        };
        state.held = sentinel;
        return sentinel;
      },
    },
  });
}

const visibilityChange = (kiosk: Page) =>
  kiosk.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test("the manifest installs /kiosk full screen in portrait, with icons", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "ipad-portrait", KIOSK_ONLY);
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const manifest = (await res.json()) as {
    start_url: string;
    display: string;
    orientation: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({
    start_url: "/kiosk",
    display: "standalone",
    orientation: "portrait",
  });
  expect(manifest.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512", "180x180"]),
  );
  expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
  for (const icon of manifest.icons) {
    const img = await page.request.get(icon.src);
    expect(img.status(), icon.src).toBe(200);
    expect(img.headers()["content-type"], icon.src).toBe("image/png");
    // The Baumy badge (issue #81) at the size the manifest promises: the
    // PNG header's width and height.
    const png = await img.body();
    const side = Number(icon.sizes.split("x")[0]);
    expect(png.subarray(1, 4).toString("ascii"), icon.src).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], icon.src).toEqual([
      side,
      side,
    ]);
  }

  // Every page links the manifest and the iPad's home-screen icon.
  await page.goto("/kiosk/pair");
  const head = page.locator("head");
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    /\/manifest\.webmanifest/,
  );
  await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(
    head.locator('meta[name="mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
});

test("wake lock, idle reset and the offline page", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", KIOSK_ONLY);
  const suffix = Math.random().toString(36).slice(2, 8);
  const founder = `Founder ${project}`;
  await founderAdmin(page, project);
  const { context, page: kiosk } = await pairedKiosk(
    browser,
    page,
    `iPad ${suffix}`,
  );
  await context.addInitScript(fakeWakeLock);
  await context.clock.install();
  await kiosk.goto("/kiosk");
  await expect(
    kiosk.getByRole("heading", { name: "Kitchen", level: 1 }),
  ).toBeVisible();

  // The wake lock: refused, and the kiosk says nothing about it (no corner
  // tag, by the household's ask) ...
  const wake = kiosk.getByTestId("wake-lock");
  await expect(wake).toHaveAttribute("data-status", "denied");
  await expect(kiosk.getByText("Screen may sleep")).toHaveCount(0);
  // ... held once the browser allows it (asked again on visibilitychange) ...
  await kiosk.evaluate(() => {
    (window as unknown as { __wake: { allow: boolean } }).__wake.allow = true;
  });
  await visibilityChange(kiosk);
  await expect(wake).toHaveAttribute("data-status", "held");
  // ... and asked for again after the browser lets it go.
  await kiosk.evaluate(() =>
    (window as unknown as { __wake: { drop(): void } }).__wake.drop(),
  );
  await expect(wake).toHaveAttribute("data-status", "released");
  await visibilityChange(kiosk);
  await expect(wake).toHaveAttribute("data-status", "held");

  // Idle reset: someone opens the chores and taps in, then walks away.
  await openKioskChores(kiosk);
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  const countdown = kiosk.getByTestId("idle-countdown");
  await context.clock.fastForward(50_000);
  await expect(countdown).toContainText("back to the start in 10 s");
  // A touch cancels the countdown and starts the minute again.
  await kiosk.getByRole("heading", { name: "Bounties", level: 1 }).click();
  await expect(countdown).toHaveCount(0);
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  await context.clock.fastForward(61_000);
  // Home, and nobody is acting.
  await expect(kiosk).toHaveURL(/\/kiosk$/);
  await expect(kiosk.getByTestId("kiosk-home")).toBeVisible();
  await openKioskChores(kiosk);
  await expect(
    kiosk.getByText("Tap your avatar", { exact: true }),
  ).toBeVisible();
  await expect(kiosk.getByTestId("acting-as")).toHaveCount(0);

  // A page left open with nobody tapped in goes home too.
  await kiosk.goto("/kiosk/notes");
  await expect(
    kiosk.getByRole("heading", { name: "Board", level: 1 }),
  ).toBeVisible();
  await context.clock.fastForward(61_000);
  await expect(kiosk).toHaveURL(/\/kiosk$/);
  await expect(
    kiosk.getByRole("heading", { name: "Kitchen", level: 1 }),
  ).toBeVisible();

  // Offline: the service worker shows the offline page instead of an error
  // (with a way to try again), and the page comes back by itself as soon as
  // the network does.
  await kiosk.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await kiosk.goto("/kiosk/notes");
  await expect(
    kiosk.getByRole("heading", { name: "No connection", level: 1 }),
  ).toBeVisible();
  await expect(kiosk.getByRole("button", { name: "Try again" })).toBeVisible();
  await context.setOffline(false);
  await expect(
    kiosk.getByRole("heading", { name: "Board", level: 1 }),
  ).toBeVisible();
  await expect(kiosk).toHaveURL(/\/kiosk\/notes$/);

  await context.close();
});
