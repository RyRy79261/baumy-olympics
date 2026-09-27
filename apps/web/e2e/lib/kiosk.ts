// Kiosk steps shared by the kiosk specs: an admin's pairing code, pairing an
// iPad context with it, and typing a PIN on the pad.

import {
  expect,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";

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

/** The admin makes a pairing code for a new device on /admin/members. */
export async function pairCode(
  admin: Page,
  deviceName: string,
): Promise<string> {
  await admin.goto("/admin/members");
  const form = admin.locator("form").filter({
    has: admin.getByRole("button", { name: "Create pairing code" }),
  });
  await form.getByLabel("Device name").fill(deviceName);
  await form.getByRole("button", { name: "Create pairing code" }).click();
  const code = (await admin.getByTestId("pairing-code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(admin.getByTestId(`kiosk-${deviceName}`)).toContainText(
    "Waiting for its code",
  );
  return code;
}

/** A new iPad-sized context, paired with a fresh code from `admin`. */
export async function pairedKiosk(
  browser: Browser,
  admin: Page,
  deviceName: string,
) {
  const code = await pairCode(admin, deviceName);
  const context = await browser.newContext({
    viewport: { width: 1180, height: 820 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/kiosk/pair");
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair this kiosk" }).click();
  await expect(page).toHaveURL(/\/kiosk$/);
  return { context, page };
}

export async function typePin(dialog: Locator, pin: string) {
  for (const digit of pin) {
    await dialog.getByRole("button", { name: digit, exact: true }).click();
  }
  await dialog.getByRole("button", { name: "OK" }).click();
}

/** From the kiosk home, open the chores (the grid and "Needs your OK"). */
export async function openKioskChores(kiosk: Page) {
  await kiosk
    .getByTestId("widget-chores")
    .getByRole("link", { name: "Chores" })
    .click();
  await expect(
    kiosk.getByRole("heading", { name: "Chores", level: 1 }),
  ).toBeVisible();
}
