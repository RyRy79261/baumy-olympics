import { expect, test, type Locator, type Page } from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin } from "../lib/household";
import { expectKioskTargets, pairedKiosk } from "../lib/kiosk";

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

  // Typing still works beside it, and a confirmed card that scores makes
  // Baumy happy with the "+N" pop.
  await sheet.getByLabel("Message to Baumy").fill(`I cleaned the ${chore}`);
  await sheet.getByRole("button", { name: "Send" }).click();
  const row = sheet.getByTestId("suggestion-log_completion");
  await expect(row).toContainText(`Log ${chore}`);
  await sheet.getByRole("button", { name: "Confirm all" }).click();
  await expect(row.getByTestId("proposal-state")).toHaveText("Done");
  await expect(sheet.getByTestId("score-pop")).toHaveText("+15");
  await expect(sprite(sheet)).toHaveAttribute("data-state", "happy");
});

test("on the kitchen dashboard, the cat listens and answers in its bubble", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  // Paired from the phone project, like kiosk-dashboard.spec: the iPad is
  // its own 820×1180 context, and the ipad-portrait founder already pairs
  // many kiosks (approve_kiosk_pairing allows 20 per 10 minutes).
  test.skip(project !== "mobile-360", "Paired from the phone project.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const chore = `Kettle ${suffix}`;
  await founderAdmin(page, project);
  await addChore(page, { name: chore, basePoints: 12, cooldownHours: 0 });
  const ipad = await pairedKiosk(browser, page, `Mic iPad ${suffix}`);
  await ipad.context.grantPermissions(["microphone"]);
  const kiosk = ipad.page;
  const founder = `Founder ${project}`;
  const cat = kiosk.getByRole("button", { name: "Ask Baumy" });
  const bubble = kiosk.getByTestId("cat-bubble");

  // Nobody tapped in: the bubble asks who is talking, with the avatars.
  await cat.click();
  await expect(bubble).toHaveAttribute("data-mode", "who");
  await expect(bubble).toContainText("Who's talking?");
  await bubble.getByRole("button", { name: founder, exact: true }).click();
  await expect(bubble).toHaveAttribute("data-mode", "ready");
  await expect(bubble).toContainText(`Hi ${founder}.`);

  // Talking: the listening bubble, then the answer in it.
  await bubble.getByRole("button", { name: "Start talking" }).click();
  await expect(bubble).toHaveAttribute("data-mode", "listening");
  await expect(bubble).toContainText("Mrrp? I'm listening");
  await expect(sprite(kiosk.locator("[data-voice-cat]"))).toHaveAttribute(
    "data-state",
    "listening",
  );
  await expectKioskTargets(bubble);
  await kiosk.waitForTimeout(900);
  await bubble.getByRole("button", { name: "Done talking" }).click();
  await expect(bubble).toHaveAttribute("data-mode", "answer");
  await expect(bubble).toContainText(
    /is winning with \d+ points|Nobody is ahead/,
  );
  await bubble.getByRole("button", { name: "OK" }).click();
  await expect(bubble).toHaveCount(0);

  // "I cleaned the kettle" (this browser's clips say so): Baumy proposes
  // logging it as a card in the bubble, and "Confirm all" does.
  await ipad.context.addCookies([
    {
      name: "baumy_e2e_transcript",
      value: encodeURIComponent(`I cleaned the ${chore}`),
      url: new URL(kiosk.url()).origin,
    },
  ]);
  await cat.click();
  await expect(bubble).toHaveAttribute("data-mode", "listening");
  await kiosk.waitForTimeout(900);
  await bubble.getByRole("button", { name: "Done talking" }).click();
  await expect(bubble).toContainText("Got it! I'll do this:");
  await expect(bubble.getByTestId("suggestion-log_completion")).toContainText(
    `Log ${chore} for ${founder}: +12`,
  );
  await expect(bubble.getByRole("button", { name: "Cancel" })).toBeVisible();
  await bubble.getByRole("button", { name: "Confirm all" }).click();
  await expect(bubble).toContainText(
    new RegExp(`Purrfect\\. \\+12 for ${founder}|Saved`),
  );

  // "Type instead" opens the sheet, with the same conversation.
  await cat.click();
  await expect(bubble).toHaveAttribute("data-mode", "listening");
  await bubble.getByRole("button", { name: "Type instead" }).click();
  await expect(bubble).toHaveCount(0);
  const sheet = kiosk.getByRole("dialog", { name: "Ask Baumy" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Message to Baumy")).toBeVisible();
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
