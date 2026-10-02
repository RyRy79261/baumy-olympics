import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin } from "../lib/household";
import { expectKioskTargets, pairedKiosk } from "../lib/kiosk";

// Issue #132: on the wall-mounted iPad, tap the cat, hold "Hold to talk",
// let go, and Baumy's answer and suggestion cards show in the same bubble,
// which stays for the next hold. Chromium records its fake microphone (a
// beep, so the level bars move) and the fake transcriber
// (lib/integrations/groq-fake.ts) hears "Who's winning?", or what the
// browser's `baumy_e2e_transcript` cookie says; the fake Claude answers.
// The hold is a real touch (CDP touch events, so pointerType "touch" as on
// the iPad), held past the long press that used to swallow it.
//
// E2E_SHOTS_DIR, when set, keeps a screenshot of each step there.

test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

async function shot(page: Page, name: string) {
  const dir = process.env.E2E_SHOTS_DIR;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
}

/**
 * Hold `target` with a finger: touch down, run `whileHeld`, lift. Chromium
 * gets real touch events; another browser gets the mouse.
 */
async function touchHold(
  page: Page,
  context: BrowserContext,
  target: Locator,
  whileHeld: () => Promise<void>,
) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (context.browser()?.browserType().name() === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    await whileHeld();
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await whileHeld();
    await page.mouse.up();
  }
}

test("tap the cat, hold to talk, see the answer and confirm, and stay", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  // Paired from the phone project, like kiosk-dashboard.spec: the iPad is
  // its own 820×1180 context with touch.
  test.skip(project !== "mobile-360", "Paired from the phone project.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const chore = `Kettle ${suffix}`;
  await founderAdmin(page, project);
  await addChore(page, { name: chore, basePoints: 12, cooldownHours: 0 });
  const ipad = await pairedKiosk(browser, page, `Hold iPad ${suffix}`);
  await ipad.context.grantPermissions(["microphone"]);
  const kiosk = ipad.page;
  const founder = `Founder ${project}`;
  const cat = kiosk.getByRole("button", { name: "Ask Baumy" });
  const bubble = kiosk.getByTestId("cat-bubble");
  const holdButton = bubble.getByTestId("hold-to-talk");
  const sprite = kiosk.locator('[data-voice-cat] [data-sprite="baumy"]');

  // 1. Tap the cat. Nobody tapped in yet, so it asks who; one tap on the
  //    avatar and the big "Hold to talk" is there, the microphone open.
  await cat.tap();
  await expect(bubble).toHaveAttribute("data-mode", "who");
  await bubble.getByRole("button", { name: founder, exact: true }).tap();
  await expect(bubble).toHaveAttribute("data-mode", "talk");
  await expect(bubble).toContainText(`Hi ${founder}.`);
  await expect(holdButton).toHaveAttribute("data-state", "idle");
  await expect(holdButton).toHaveText("Hold to talk");
  const box = (await holdButton.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(96);
  expect(box.width).toBeGreaterThanOrEqual(300);
  await expectKioskTargets(bubble);
  await shot(kiosk, "1-hold-to-talk");

  // 2. Hold it: the listening bubble, the red pulsing button and the level
  //    bars moving with the (fake) microphone's beep. Held past a long press.
  let transcribed = kiosk.waitForResponse("**/api/ai/transcribe");
  await touchHold(kiosk, ipad.context, holdButton, async () => {
    await expect(bubble).toHaveAttribute("data-mode", "listening");
    await expect(bubble).toContainText("Mrrp? I’m listening");
    await expect(holdButton).toHaveAttribute("aria-pressed", "true");
    await expect(holdButton).toContainText("Release to send");
    await expect(sprite).toHaveAttribute("data-state", "listening");
    await expect
      .poll(async () =>
        Number(
          await holdButton.locator("[data-level]").getAttribute("data-level"),
        ),
      )
      .toBeGreaterThan(0);
    await shot(kiosk, "2-listening");
    await kiosk.waitForTimeout(1_200);
  });

  // 3. Let go: transcribed, answered, in the same bubble, ready again.
  let res = await transcribed;
  expect(res.status()).toBe(200);
  expect(await res.request().headerValue("content-type")).toMatch(
    /^multipart\/form-data/,
  );
  await expect(bubble).toHaveAttribute("data-mode", "answer");
  await expect(bubble).toContainText(
    /is winning with \d+ points|Nobody is ahead/,
  );
  await expect(holdButton).toHaveText("Hold to talk");
  await shot(kiosk, "3-answer");

  // 4. Hold again, straight from the answer: "I cleaned the kettle" comes
  //    back as a card, with Confirm all and Cancel.
  await ipad.context.addCookies([
    {
      name: "baumy_e2e_transcript",
      value: encodeURIComponent(`I cleaned the ${chore}`),
      url: new URL(kiosk.url()).origin,
    },
  ]);
  transcribed = kiosk.waitForResponse("**/api/ai/transcribe");
  await touchHold(kiosk, ipad.context, holdButton, async () => {
    await expect(bubble).toHaveAttribute("data-mode", "listening");
    await kiosk.waitForTimeout(900);
  });
  res = await transcribed;
  expect(res.status()).toBe(200);
  await expect(bubble).toContainText("Got it! I'll do this:");
  await expect(bubble.getByTestId("suggestion-log_completion")).toContainText(
    `Log ${chore} for ${founder}: +12`,
  );
  await expect(bubble.getByRole("button", { name: "Cancel" })).toBeVisible();
  // Nothing to talk over until the card is decided.
  await expect(holdButton).toHaveCount(0);
  await shot(kiosk, "4-cards");

  // 5. Confirm all: saved and scored, said in the bubble, which stays with
  //    "Hold to talk" for the next thing.
  await bubble.getByRole("button", { name: "Confirm all" }).tap();
  await expect(bubble).toContainText(`Purrfect. +12 for ${founder} ✦`);
  const card = bubble.getByTestId("suggestion-log_completion");
  await expect(card).toHaveAttribute("data-state", "saved");
  await expect(card).toContainText("Saved: +12 points.");
  await expect(holdButton).toHaveText("Hold to talk");
  await shot(kiosk, "5-confirmed");

  // A tap on the cat closes it; the next tap is straight to "Hold to talk"
  // (they are still tapped in), and "Type instead" opens the sheet.
  await cat.tap();
  await expect(bubble).toHaveCount(0);
  await cat.tap();
  await expect(bubble).toHaveAttribute("data-mode", "talk");
  await expect(holdButton).toHaveText("Hold to talk");
  await bubble.getByRole("button", { name: "Type instead" }).tap();
  await expect(bubble).toHaveCount(0);
  const sheet = kiosk.getByRole("dialog", { name: "Ask Baumy" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByLabel("Message to Baumy")).toBeVisible();
  await ipad.context.close();
});
