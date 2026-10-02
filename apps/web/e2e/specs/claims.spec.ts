import { expect, test, type Page } from "@playwright/test";
import { addChore, openChore } from "../lib/chores";
import { advanceClock, resetClock } from "../lib/clock";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #15, SPEC §4.6 E9 on the phone, in the activity log (issue #150):
// the founder self-claims a chore, which counts at once; the partner finds
// it in Activity (no inbox, no count, no Confirm) and disputes it with a
// reason, the founder attaches a photo (shown only through /api/blob), the
// partner withdraws the dispute, and once the SERVER clock is past the
// finalize time the entry shows as settled.
//
// It moves the shared server clock, so it runs in the server-clock project,
// one test at a time (playwright.config.ts), and puts the clock back
// afterwards.

test.describe.configure({ mode: "serial" });

const HOUR = 60 * 60 * 1000;
// A 1×1 PNG: the browser decodes it and re-encodes it before the upload.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test.afterEach(async ({ page }) => {
  await resetClock(page);
});

function claim(page: Page, chore: string) {
  return page.getByTestId(`activity-chore-${chore}`);
}

function toast(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

test("E9 in the activity log: dispute, photo, withdraw, then settled", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  const suffix = Math.random().toString(36).slice(2, 8);
  const chore = `Tub ${suffix}`;
  const founder = `Founder ${project}`;
  const partnerName = `Partner ${suffix}`;

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const partner = await newAccount(browser, `claims-${project}`);
  await redeem(partner.page, invite, partnerName);
  await expect(partner.page).toHaveURL(/\/$/);
  await addChore(page, { name: chore, basePoints: 26, cooldownHours: 84 });

  // The founder self-claims it: it counts at once.
  await page.goto("/chores");
  const sheet = await openChore(page, chore);
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(page.getByTestId("score-pop")).toHaveText("+26");

  // The partner opens Activity from the nav: a log, not an inbox.
  const p = partner.page;
  await p.goto("/");
  const nav = p.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Activity", exact: true }).click();
  await expect(p).toHaveURL(/\/activity$/);
  await expect(p.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(p.getByRole("link", { name: /Needs your OK/ })).toHaveCount(0);
  // The bounty the founder added is in the log too.
  await expect(p.getByTestId(`activity-bounty-${chore}`)).toContainText(
    `${founder} added the bounty ${chore}.`,
  );
  let card = claim(p, chore);
  await expect(card).toContainText(`${founder} did ${chore}`);
  await expect(card).toContainText("+26. Final at");
  await expect(card).toHaveAttribute("data-status", "pending");
  // Dispute, and never Confirm (issue #150).
  await expect(card.getByRole("button", { name: "Dispute" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await card.getByRole("button", { name: "Dispute" }).click();
  const send = card.getByRole("button", { name: "Send dispute" });
  await expect(send).toBeDisabled();
  await card.getByLabel("Why was it not done?").fill("The tub is still grey");
  await send.click();
  await expect(toast(p, `Disputed ${chore}.`)).toBeVisible();
  await expect(claim(p, chore)).toHaveAttribute("data-status", "disputed");
  await expect(p.getByTestId(`activity-dispute-${chore}`)).toContainText(
    `${partnerName} disputed ${founder}'s ${chore}: "The tub is still grey". Still open.`,
  );

  // The founder sees the dispute and attaches a photo.
  await page.goto("/activity");
  card = claim(page, chore);
  await expect(card).toContainText(
    `Disputed by ${partnerName}: "The tub is still grey".`,
  );
  await expect(card).toContainText("Without a photo it is voided at");
  await expect(card.getByRole("button", { name: "Concede" })).toBeVisible();
  await card.getByLabel("Add a photo").setInputFiles({
    name: "tub.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await card.getByRole("button", { name: "Upload photo" }).click();
  await expect(toast(page, `Photo added to ${chore}.`)).toBeVisible();
  const photo = claim(page, chore).getByRole("img", {
    name: `Proof photo for ${chore}`,
  });
  await expect(photo).toBeVisible();
  // Only ever the proxy, never a raw Blob URL, and it really loads.
  await expect(photo).toHaveAttribute(
    "src",
    /^\/api\/blob\?pathname=completions%2F[0-9a-f-]{36}%2F[0-9a-f]{16}\.webp$/,
  );
  // Lazy-loaded: it loads once it is on screen.
  await photo.scrollIntoViewIfNeeded();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(claim(page, chore)).toContainText("It has a photo");

  // The partner withdraws the dispute: pending again.
  await p.goto("/activity");
  card = claim(p, chore);
  await expect(
    card.getByRole("img", { name: `Proof photo for ${chore}` }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Withdraw dispute" }).click();
  await expect(toast(p, `Dispute on ${chore} withdrawn.`)).toBeVisible();
  await expect(claim(p, chore)).toHaveAttribute("data-status", "pending");
  await expect(p.getByTestId(`activity-dispute-${chore}`)).toContainText(
    "Withdrawn.",
  );

  // Past the finalize time (logged + 24h), it has settled, and nobody may
  // dispute it any more.
  await page.goto("/activity");
  await expect(claim(page, chore)).toHaveAttribute("data-status", "pending");
  await advanceClock(page, 25 * HOUR);
  await page.goto("/activity");
  await expect(claim(page, chore)).toHaveAttribute("data-status", "finalized");
  await expect(claim(page, chore)).toContainText("+26. Settled.");
  await p.goto("/activity");
  await expect(claim(p, chore)).toHaveAttribute("data-status", "finalized");
  await expect(claim(p, chore).getByRole("button")).toHaveCount(0);
  await resetClock(page);

  await partner.context.close();
});

test("the photo proxy refuses strangers and unsafe paths", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const get = (pathname: string) =>
    context.request.get(`/api/blob?pathname=${encodeURIComponent(pathname)}`);
  const stranger = await get(`completions/${id}/a1b2c3d4e5f60718.webp`);
  expect(stranger.status()).toBe(401);
  for (const bad of [
    `completions/${id}/../x.webp`,
    `completions/${id}/a1b2c3d4e5f60718%2ewebp`,
  ]) {
    expect((await get(bad)).status(), bad).toBe(404);
  }
  const upload = await context.request.post("/api/uploads/completion-photo", {
    headers: { "sec-fetch-site": "same-origin" },
    multipart: { choreId: id },
  });
  expect(upload.status()).toBe(401);
  await context.close();
});
