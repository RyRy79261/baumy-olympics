import { expect, test } from "@playwright/test";
import {
  founderAdmin,
  mintCode,
  newAccount,
  redeem,
  uniqueAddress,
} from "../lib/household";
import { approveOnPhone, KIOSK_VIEWPORT, shownPairing } from "../lib/kiosk";
import { openAdminMenu } from "../lib/nav";

// Issue #126: the kitchen iPad pairs by QR code. One context is the iPad at
// /kiosk/pair (820×1180); the project's page is the admin's phone, which
// opens the URL the QR code holds (no camera in a test) and taps once. The
// iPad pairs by itself. A member who is not an admin cannot approve it, and
// the code typed by hand on Admin → Kitchen screen leads to the same page.
// Its expiry is kiosk-pairing-expiry.spec.ts (it moves the server clock).

test("the admin's phone approves the iPad's QR code, and the iPad pairs itself", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "mobile-360", "The admin's phone approves it.");
  const tag = Math.random().toString(36).slice(2, 8);
  const deviceName = `Kitchen ${tag}`;
  await founderAdmin(page, project);

  // A housemate who is not an admin.
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `pair-${project}`);
  await redeem(member.page, invite, `Housemate ${tag}`);
  await expect(member.page).toHaveURL(/\/$/);

  // The iPad: unpaired, it shows a QR code and the short code, and asks to
  // be approved.
  const ipad = await browser.newContext({
    viewport: KIOSK_VIEWPORT,
    hasTouch: true,
    extraHTTPHeaders: { "x-forwarded-for": uniqueAddress() },
  });
  const kiosk = await ipad.newPage();
  await kiosk.goto("/kiosk");
  await expect(kiosk).toHaveURL(/\/kiosk\/pair$/);
  await expect(
    kiosk.getByRole("heading", {
      name: "Make this the kitchen screen",
      level: 1,
    }),
  ).toBeVisible();
  const { url, code } = await shownPairing(kiosk);
  const secret = (await ipad.cookies()).find(
    (c) => c.name === "baumy_kiosk_pairing",
  );
  expect(secret).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/api/kiosk-pairing",
  });
  // The secret never travels in the QR code's URL.
  expect(url).not.toContain(secret!.value);

  // The housemate scans it: not an admin, so the page does not exist for
  // them, and the iPad stays where it is.
  const asMember = await member.page.goto(url);
  expect(asMember?.status()).toBe(404);
  await expect(
    member.page.getByRole("button", { name: "Make it the kitchen screen" }),
  ).toHaveCount(0);
  await expect(kiosk).toHaveURL(/\/kiosk\/pair$/);
  await expect(kiosk.getByTestId("pairing-code")).toHaveText(code);

  // The admin's phone: one tap, and the iPad is the kitchen screen.
  await approveOnPhone(page, kiosk, deviceName);
  await expect(
    kiosk.getByRole("heading", { name: "Kitchen", level: 1 }),
  ).toBeVisible();
  const cookies = await ipad.cookies();
  expect(cookies.find((c) => c.name === "baumy_kiosk")).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
  });
  expect(cookies.find((c) => c.name === "baumy_kiosk_pairing")).toBeUndefined();

  // Admin → Kitchen screen lists it; it can be renamed there.
  await openAdminMenu(page);
  await page
    .getByTestId("admin-menu")
    .getByRole("link", { name: "Kitchen screen" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Kitchen screen", level: 1 }),
  ).toBeVisible();
  const row = page.getByTestId(`kiosk-${deviceName}`);
  await expect(row).toContainText("Paired");
  const renamed = `Fridge ${tag}`;
  await row.getByLabel("Name").fill(renamed);
  await row.getByRole("button", { name: `Rename ${deviceName}` }).click();
  await expect(page.getByTestId(`kiosk-${renamed}`)).toContainText("Paired");

  // Pairing is no longer on Members.
  await page.goto("/admin/members");
  await expect(
    page.getByRole("heading", { name: "Members", level: 1 }),
  ).toBeVisible();
  await expect(page.getByTestId(`kiosk-${renamed}`)).toHaveCount(0);

  // The camera will not read it: a second iPad's code, typed on the phone,
  // leads to the same confirm page.
  const second = await browser.newContext({
    viewport: KIOSK_VIEWPORT,
    hasTouch: true,
    extraHTTPHeaders: { "x-forwarded-for": uniqueAddress() },
  });
  const other = await second.newPage();
  await other.goto("/kiosk/pair");
  const typed = await shownPairing(other);
  await page.goto("/admin/kitchen-screen");
  await page
    .getByLabel("Camera won't scan? Type the code")
    .fill(typed.code.toLowerCase());
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByTestId("approve-code")).toHaveText(typed.code);
  await page
    .getByRole("button", { name: "Make it the kitchen screen" })
    .click();
  await expect(other).toHaveURL(/\/kiosk$/);

  await second.close();
  await ipad.close();
  await member.context.close();
});
