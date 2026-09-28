import { expect, test, type Locator, type Page } from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin } from "../lib/household";
import { openKioskChores, pairedKiosk } from "../lib/kiosk";

// Issue #22 (SPEC §3.6): hold to speak to Baumy. Chromium records its fake
// microphone (a beep) and the server's fake transcriber
// (lib/integrations/groq-fake.ts) hears "Who's winning?" in every clip, so
// the real route, the ai_usage row and the command flow all run. Baumy's
// sprite follows: listening while held, talking with the answer, happy when
// an approved row scores, and still under reduced motion.

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
  permissions: ["microphone"],
});

async function openBaumy(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Ask Baumy" }).click();
  const sheet = page.getByRole("dialog", { name: "Ask Baumy" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Baumy's sprite beside the speech bubble. */
const sprite = (sheet: Locator) => sheet.locator('[data-sprite="baumy"]');

/** Press and hold the button, wait while speaking, let go. */
async function holdToSpeak(page: Page, mic: Locator, sheet: Locator) {
  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(mic).toHaveAttribute("aria-pressed", "true");
  await expect(mic).toHaveAccessibleName("Release to send");
  await expect(sprite(sheet)).toHaveAttribute("data-state", "listening");
  await expect(
    sheet.getByRole("meter", { name: "Microphone level" }),
  ).toBeVisible();
  await page.waitForTimeout(900);
  await page.mouse.up();
}

test("hold to speak on the phone: the transcript goes to Baumy", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project === "ipad-portrait", "The kiosk has its own test.");
  const chore = `Sink ${Math.random().toString(36).slice(2, 8)}`;
  await founderAdmin(page, project);
  await addChore(page, { name: chore, basePoints: 15, cooldownHours: 0 });
  await page.goto("/");

  const sheet = await openBaumy(page);
  await expect(sprite(sheet)).toHaveAttribute("data-state", "idle");
  await expect(
    sheet.getByRole("button", { name: "Hold to speak" }),
  ).toBeVisible();
  // One button whose name follows what it does, so found by its place.
  const mic = sheet.getByTestId("voice-recorder").getByRole("button");
  expect((await mic.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  const transcribed = page.waitForResponse("**/api/ai/transcribe");
  await holdToSpeak(page, mic, sheet);
  const res = await transcribed;
  expect(res.status()).toBe(200);
  expect(await res.request().headerValue("content-type")).toMatch(
    /^multipart\/form-data/,
  );

  await expect(sheet.getByTestId("baumy-heard")).toHaveText(
    "You said: “Who's winning?”",
  );
  await expect(sheet.getByTestId("baumy-says")).toContainText(
    /is winning with \d+ points|Nobody is ahead/,
  );
  await expect(sprite(sheet)).toHaveAttribute("data-state", "talking");
  // It settles back to idle.
  await expect(sprite(sheet)).toHaveAttribute("data-state", "idle", {
    timeout: 8_000,
  });

  // Typing still works beside it, and an approved row that scores makes
  // Baumy happy with the "+N" pop.
  await sheet.getByLabel("Message to Baumy").fill(`I cleaned the ${chore}`);
  await sheet.getByRole("button", { name: "Send" }).click();
  const row = sheet.getByTestId("proposal-log_completion");
  await expect(row).toContainText(`Log ${chore}`);
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row.getByTestId("proposal-state")).toHaveText("Done");
  await expect(sheet.getByTestId("score-pop")).toHaveText("+15");
  await expect(sprite(sheet)).toHaveAttribute("data-state", "happy");
});

test("on the kiosk, a tap starts recording and a second tap sends it", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  const suffix = Math.random().toString(36).slice(2, 8);
  await founderAdmin(page, project);
  const ipad = await pairedKiosk(browser, page, `Mic iPad ${suffix}`);
  await ipad.context.grantPermissions(["microphone"]);
  const kiosk = ipad.page;
  const founder = `Founder ${project}`;
  // Baumy stands over the footer on every kiosk page; tap in on one.
  await openKioskChores(kiosk);
  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);

  const sheet = await openBaumy(kiosk);
  const mic = sheet.getByRole("button", { name: "Hold to speak" });
  expect((await mic.boundingBox())!.height).toBeGreaterThanOrEqual(56);
  await mic.tap();
  const recording = sheet.getByRole("button", { name: "Tap to send" });
  await expect(recording).toHaveAttribute("aria-pressed", "true");
  await expect(sprite(sheet)).toHaveAttribute("data-state", "listening");
  await kiosk.waitForTimeout(900);
  await recording.tap();
  await expect(sheet.getByTestId("baumy-heard")).toHaveText(
    "You said: “Who's winning?”",
  );
  await expect(sheet.getByTestId("baumy-says")).toContainText(
    /is winning with \d+ points|Nobody is ahead/,
  );
  await ipad.context.close();
});

test("Baumy stands still under reduced motion", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "desktop-chromium", "One browser is enough.");
  await founderAdmin(page, project);
  await page.goto("/");
  const sheet = await openBaumy(page);
  const mic = sheet.getByRole("button", { name: "Hold to speak" });
  const animation = () =>
    sprite(sheet).evaluate((el) => getComputedStyle(el).animationName);

  const box = (await mic.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(sprite(sheet)).toHaveAttribute("data-state", "listening");
  expect(await animation()).not.toBe("none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(sprite(sheet)).toHaveAttribute("data-state", "listening");
  expect(await animation()).toBe("none");
  await page.mouse.up();
});

test("a blocked microphone falls back to typing", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "desktop-chromium", "One browser is enough.");
  await founderAdmin(page, project);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await page.goto("/");
  const sheet = await openBaumy(page);
  await sheet.getByRole("button", { name: "Hold to speak" }).click();
  await expect(
    sheet.getByRole("status").filter({
      hasText: "The microphone is blocked, so type to Baumy instead.",
    }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("button", { name: "Hold to speak" }),
  ).toHaveCount(0);
  await expect(sheet.getByLabel("Message to Baumy")).toBeFocused();
  await expect(sprite(sheet)).toHaveAttribute("data-state", "idle");
});
