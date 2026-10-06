// Kiosk steps shared by the kiosk specs: pairing an iPad context by the
// admin's phone opening its QR code's URL, and typing a PIN on the pad.

import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { uniqueAddress } from "./household";

/** The kitchen iPad, in portrait (ADR 0005). */
export const KIOSK_VIEWPORT = { width: 820, height: 1180 };

/** Every visible button in `scope` is a 56px (or larger) square target. */
export async function expectKioskTargets(scope: Locator) {
  const buttons = scope.getByRole("button");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const b = buttons.nth(i);
    if (!(await b.isVisible())) continue;
    const box = (await b.boundingBox())!;
    const name = (await b.textContent())?.trim() ?? "";
    expect(box.height, `height of "${name}"`).toBeGreaterThanOrEqual(56);
    expect(box.width, `width of "${name}"`).toBeGreaterThanOrEqual(56);
  }
}

/**
 * What the unpaired iPad at /kiosk/pair shows (issue #126): the URL its QR
 * code holds and the short code under it.
 */
export async function shownPairing(
  ipad: Page,
): Promise<{ url: string; code: string }> {
  const qr = ipad.getByTestId("pairing-qr");
  await expect(qr.getByRole("img", { name: /^QR code/ })).toBeVisible();
  const url = (await qr.getAttribute("data-approve-url"))!;
  const code = (await ipad.getByTestId("pairing-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  expect(url).toBe(
    `${new URL(ipad.url()).origin}/admin/kitchen-screen/approve?code=${code.replace("-", "")}`,
  );
  return { url, code };
}

/**
 * The admin's phone opens the URL from the iPad's QR code (no camera in a
 * test) and taps the one button; the iPad pairs itself and goes home.
 */
export async function approveOnPhone(
  admin: Page,
  ipad: Page,
  deviceName: string,
) {
  const { url, code } = await shownPairing(ipad);
  await admin.goto(url);
  await expect(
    admin.getByRole("heading", {
      name: "Make this iPad the kitchen screen?",
      level: 1,
    }),
  ).toBeVisible();
  await expect(admin.getByTestId("approve-code")).toHaveText(code);
  await admin.getByLabel("Name", { exact: true }).fill(deviceName);
  await admin
    .getByRole("button", { name: "Make it the kitchen screen" })
    .click();
  await expect(
    admin.getByRole("status").filter({ hasText: "is now the kitchen screen" }),
  ).toBeVisible();
  await expect(ipad).toHaveURL(/\/kiosk$/);
}

/** A new iPad-sized context, paired by `admin` scanning its code. */
export async function pairedKiosk(
  browser: Browser,
  admin: Page,
  deviceName: string,
) {
  const context = await browser.newContext({
    viewport: KIOSK_VIEWPORT,
    hasTouch: true,
    // Its own address, so pairing's limit of 20 codes per address per 10
    // minutes (lib/kiosk/pairing.ts) counts this kiosk alone, not every
    // kiosk the suite pairs from localhost.
    extraHTTPHeaders: { "x-forwarded-for": uniqueAddress() },
  });
  const page = await context.newPage();
  await page.goto("/kiosk/pair");
  await approveOnPhone(admin, page, deviceName);
  return { context, page };
}

/** Type a PIN on the pad and press its submit, "OK" unless the form names it. */
export async function typePin(dialog: Locator, pin: string, submit = "OK") {
  for (const digit of pin) {
    await dialog.getByRole("button", { name: digit, exact: true }).click();
  }
  await dialog.getByRole("button", { name: submit }).click();
}

/** Go to a page by the kiosk's footer nav (Home, Bounties, Calendar, ...). */
export async function kioskNav(kiosk: Page, label: string) {
  await kiosk
    .getByRole("navigation", { name: "Kiosk" })
    .getByRole("link", { name: label, exact: true })
    .click();
}

/**
 * Open the Baumy sheet (typing) on the kiosk: tap the cat, and if it starts
 * talking in its bubble (listening, or asking who is there), "Type instead".
 */
export async function openBaumySheet(kiosk: Page): Promise<Locator> {
  await kiosk.getByRole("button", { name: "Ask Baumy" }).click();
  const sheet = kiosk.getByRole("dialog", { name: "Ask Baumy" });
  const typeInstead = kiosk.getByRole("button", { name: "Type instead" });
  await expect(sheet.or(typeInstead)).toBeVisible();
  if (await typeInstead.isVisible()) await typeInstead.click();
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Open the chores (the grid) from the footer nav. */
export async function openKioskChores(kiosk: Page) {
  await kioskNav(kiosk, "Bounties");
  await expect(
    kiosk.getByRole("heading", { name: "Bounties", level: 1 }),
  ).toBeVisible();
}

/** Open the activity log (issue #150) from the footer nav. */
export async function openKioskActivity(kiosk: Page) {
  await kioskNav(kiosk, "Activity");
  await expect(
    kiosk.getByRole("heading", { name: "Activity", level: 1 }),
  ).toBeVisible();
}

/** The member's personal PIN, set (or set again) from their own phone. */
export async function setPersonalPin(page: Page, pin: string) {
  await page.goto("/settings");
  const change = page.getByLabel("New PIN");
  const first = page.getByLabel("PIN", { exact: true });
  await expect(change.or(first)).toBeVisible();
  const had = await change.isVisible();
  await (had ? change : first).fill(pin);
  await page.getByLabel("Type it again").fill(pin);
  await page
    .getByRole("button", { name: had ? "Change PIN" : "Set PIN" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: /PIN (saved|changed)\./ }),
  ).toBeVisible();
}

/** Open the kitchen screen's own Settings (issue #147), from Bounties. */
export async function openKioskSettings(kiosk: Page) {
  await openKioskChores(kiosk);
  await kiosk.getByRole("link", { name: "Kitchen screen settings" }).click();
  await expect(
    kiosk.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
}
