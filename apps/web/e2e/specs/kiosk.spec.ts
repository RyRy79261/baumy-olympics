import { expect, test } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import {
  expectKioskTargets,
  KIOSK_VIEWPORT,
  openKioskChores,
  pairCode,
  typePin,
} from "../lib/kiosk";

// Issue #10 end to end, on the kitchen iPad (ipad-portrait), against Docker
// Postgres: an admin pairs a kiosk, the code works once, a member taps their
// avatar and checks their PIN (wrong, then right, then asked again), every
// kiosk touch target is at least 56px, idling forgets who is acting, and a
// revoked kiosk is sent back to /kiosk/pair.

const PIN = "2580";

test("pair a kiosk, pick an avatar, and attest with a PIN per request", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const name = `Kiosker ${suffix}`;
  const deviceName = `iPad ${suffix}`;

  // A member with a kiosk PIN, set from their own phone.
  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `kiosk-${project}`);
  await redeem(member.page, invite, name);
  await expect(member.page).toHaveURL(/\/$/);
  await member.page.goto("/settings");
  await member.page.getByLabel("PIN", { exact: true }).fill(PIN);
  await member.page.getByLabel("Type it again").fill(PIN);
  await member.page.getByRole("button", { name: "Set PIN" }).click();
  await expect(
    member.page.getByRole("status").filter({ hasText: "PIN saved." }),
  ).toBeVisible();

  // The admin creates a pairing code.
  const code = await pairCode(page, deviceName);

  // The iPad: not paired yet, so /kiosk sends it to /kiosk/pair.
  const ipad = await browser.newContext({
    viewport: KIOSK_VIEWPORT,
    hasTouch: true,
  });
  await ipad.clock.install();
  const kiosk = await ipad.newPage();
  await kiosk.goto("/kiosk");
  await expect(kiosk).toHaveURL(/\/kiosk\/pair$/);
  await expectKioskTargets(kiosk.locator("main"));
  await kiosk.getByLabel("Pairing code").fill(code.toLowerCase());
  await kiosk.getByRole("button", { name: "Pair this kiosk" }).click();
  await expect(kiosk).toHaveURL(/\/kiosk$/);
  await expect(
    kiosk.getByRole("heading", { name: "Kitchen", level: 1 }),
  ).toBeVisible();
  const cookie = (await ipad.cookies()).find((c) => c.name === "baumy_kiosk");
  expect(cookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
  });

  // The same code a second time is refused.
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto("/kiosk/pair");
  await second.getByLabel("Pairing code").fill(code);
  await second.getByRole("button", { name: "Pair this kiosk" }).click();
  await expect(
    second
      .getByRole("alert")
      .filter({ hasText: "That code is wrong, used or expired" }),
  ).toBeVisible();
  await expect(second).toHaveURL(/\/kiosk\/pair$/);
  await other.close();

  // The kiosk is not a person: the hub, admin pages included, sends it back
  // to its own shell.
  for (const path of ["/", "/settings", "/admin/members"]) {
    await kiosk.goto(path);
    await expect(kiosk).toHaveURL(/\/kiosk$/);
  }

  // The home is the dashboard, with no avatar bar; the chores have one.
  await expectKioskTargets(kiosk.locator("main"));
  await openKioskChores(kiosk);
  await expect(
    kiosk.getByText("Tap your avatar at the top to start."),
  ).toBeVisible();

  // Tap the member's avatar.
  const avatar = kiosk.getByRole("button", { name, exact: true });
  await expect(avatar).toHaveAttribute("aria-pressed", "false");
  await avatar.click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(name);
  await expect(avatar).toHaveAttribute("aria-pressed", "true");
  await expectKioskTargets(kiosk.locator("header"));
  await expectKioskTargets(kiosk.locator("main"));

  // Check my PIN: the first request has no PIN, so the pad opens.
  await kiosk.getByRole("button", { name: "Check my PIN" }).click();
  const dialog = kiosk.getByRole("dialog", { name: `${name}'s PIN` });
  await expect(dialog).toBeVisible();
  await expectKioskTargets(dialog);

  // A wrong PIN, then the right one.
  await typePin(dialog, "1111");
  await expect(
    dialog.getByRole("alert").filter({ hasText: "That PIN is not right." }),
  ).toBeVisible();
  await expect(dialog.getByTestId("pin-dots")).toHaveAttribute(
    "aria-label",
    "0 of 6 digits entered",
  );
  await typePin(dialog, PIN);
  await expect(dialog).toBeHidden();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `PIN accepted for ${name}.` }),
  ).toBeVisible();

  // The next request is not attested by the last one: the pad asks again.
  await kiosk.getByRole("button", { name: "Check my PIN" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // 60 seconds untouched: home, and nobody is acting any more.
  await ipad.clock.fastForward(61_000);
  await expect(kiosk).toHaveURL(/\/kiosk$/);
  await expect(kiosk.getByTestId("kiosk-home")).toBeVisible();
  await openKioskChores(kiosk);
  await expect(
    kiosk.getByText("Tap your avatar", { exact: true }),
  ).toBeVisible();
  await expect(kiosk.getByTestId("acting-as")).toHaveCount(0);

  // The admin revokes the kiosk; its next page load goes to /kiosk/pair.
  await page.goto("/admin/members");
  await expect(page.getByTestId(`kiosk-${deviceName}`)).toContainText("Paired");
  await page.getByRole("button", { name: `Revoke: ${deviceName}` }).click();
  await expect(page.getByTestId(`kiosk-${deviceName}`)).toContainText(
    "Revoked",
  );
  await kiosk.goto("/kiosk");
  await expect(kiosk).toHaveURL(/\/kiosk\/pair$/);

  await ipad.close();
  await member.context.close();
});
