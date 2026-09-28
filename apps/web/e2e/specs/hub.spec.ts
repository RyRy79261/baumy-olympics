import { expect, test, type Page } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { expectKioskTargets, pairedKiosk, typePin } from "../lib/kiosk";

// Issue #20: the hub and notes. A note pinned on a phone shows on the
// kitchen screen's home after it re-reads itself (the focus refresh), its
// markdown cannot inject HTML or script, and the home stays one screen with
// no scrollbars at 1180×820 whatever the widgets hold. On the kiosk every
// change to a note needs the acting member's PIN.
//
// The household is shared by the specs running in parallel, so each note
// has a title of its own.

/** Neither the page nor the kiosk's content area can scroll. */
async function expectNoScroll(kiosk: Page) {
  const sizes = await kiosk.evaluate(() => {
    const root = document.documentElement;
    const main = document.querySelector("main")!;
    return {
      root: [root.scrollHeight, root.clientHeight],
      rootX: [root.scrollWidth, root.clientWidth],
      main: [main.scrollHeight, main.clientHeight],
    };
  });
  expect(sizes.root[0], "page height").toBeLessThanOrEqual(sizes.root[1]!);
  expect(sizes.rootX[0], "page width").toBeLessThanOrEqual(sizes.rootX[1]!);
  expect(sizes.main[0], "kiosk content height").toBeLessThanOrEqual(
    sizes.main[1]!,
  );
}

test("pin a note on the phone and see it on the kiosk home after a refresh", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "mobile-360", "The phone half runs on the phone.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const title = `Wifi ${suffix}`;

  await founderAdmin(page, project);

  // The phone's hub has every widget, and the Baumy button.
  for (const id of [
    "widget-events",
    "widget-chores",
    "widget-leaderboard",
    "widget-notes",
    "widget-shopping",
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("hub-pot")).toContainText("Pot: €");
  await page.getByRole("button", { name: "Ask Baumy" }).click();
  const baumy = page.getByRole("dialog", { name: "Ask Baumy" });
  await expect(baumy.getByTestId("baumy-says")).toContainText(
    "Tell me what you did",
  );
  await baumy.getByRole("button", { name: "Close" }).click();
  await expect(baumy).toBeHidden();

  // The kitchen screen, before anyone taps in: the widgets, and no scroll.
  const ipad = await pairedKiosk(browser, page, `iPad ${suffix}`);
  const kiosk = ipad.page;
  await expect(kiosk.getByTestId("widget-notes")).toBeVisible();
  await expect(kiosk.getByTestId("clock-time")).toHaveText(/^\d\d:\d\d$/);
  await expect(kiosk.getByTestId(`hub-note-${title}`)).toHaveCount(0);
  await expectNoScroll(kiosk);
  await expectKioskTargets(kiosk.locator("main"));

  // On the phone: a long note whose body tries to inject HTML and script.
  await page.goto("/notes");
  await expect(
    page.getByRole("heading", { name: "Board", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New note" }).click();
  const sheet = page.getByRole("dialog", { name: "New note" });
  await sheet.getByLabel("Title").fill(title);
  await sheet
    .getByLabel("Note")
    .fill(
      [
        "**guest** / baumy-guest",
        '<script>window.pwned = "script"</script>',
        '<img src="x" onerror="window.pwned = \'img\'">',
        "[tap me](javascript:window.pwned='link')",
        ...Array.from({ length: 30 }, (_, i) => `line ${i + 1}`),
      ].join("\n"),
    );
  await sheet.getByRole("button", { name: "Add note" }).click();
  await expect(sheet).toBeHidden();
  const note = page.getByTestId(`note-${title}`);
  await expect(note).toBeVisible();
  await expect(note.locator("strong")).toHaveText("guest");
  await expect(note).toContainText('<script>window.pwned = "script"</script>');
  await expect(note.locator("script, img, [onerror]")).toHaveCount(0);
  await expect(note.getByRole("link", { name: "tap me" })).toHaveCount(0);

  // Pin it.
  await note.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: `Pinned ${title} to the hub.` }),
  ).toBeVisible();
  await expect(note).toContainText("Pinned");

  // The kiosk shows it once it re-reads itself (coming back into view).
  await kiosk.evaluate(() => window.dispatchEvent(new Event("focus")));
  const pinned = kiosk.getByTestId(`hub-note-${title}`);
  await expect(pinned).toBeVisible();
  await expect(pinned.locator("strong")).toHaveText("guest");
  await expect(pinned.locator("script, img, [onerror]")).toHaveCount(0);
  expect(await kiosk.evaluate(() => "pwned" in window)).toBe(false);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  // Thirty lines of note, and the screen still does not scroll.
  await expectNoScroll(kiosk);

  // The phone's hub shows it pinned too.
  await page.goto("/");
  await expect(page.getByTestId(`hub-note-${title}`)).toBeVisible();

  await ipad.context.close();
});

test("on the kiosk, adding a note asks for the member's PIN", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-landscape", "The kiosk is an iPad in landscape.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const partner = `Partner ${suffix}`;
  const title = `Bins ${suffix}`;
  const PIN = "8642";

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `notes-${project}`);
  await redeem(member.page, invite, partner);
  await expect(member.page).toHaveURL(/\/$/);
  await member.page.goto("/settings");
  await member.page.getByLabel("PIN", { exact: true }).fill(PIN);
  await member.page.getByLabel("Type it again").fill(PIN);
  await member.page.getByRole("button", { name: "Set PIN" }).click();
  await expect(
    member.page.getByRole("status").filter({ hasText: "PIN saved." }),
  ).toBeVisible();

  const ipad = await pairedKiosk(browser, page, `iPad ${suffix}`);
  const kiosk = ipad.page;
  await expectNoScroll(kiosk);

  // Nobody has tapped in: the notes can be read, not changed.
  await kiosk
    .getByTestId("widget-notes")
    .getByRole("link", { name: "All notes" })
    .click();
  await expect(
    kiosk.getByRole("heading", { name: "Board", level: 1 }),
  ).toBeVisible();
  await expect(kiosk.getByRole("button", { name: "New note" })).toHaveCount(0);

  await kiosk.getByRole("button", { name: partner, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(partner);
  await kiosk.getByRole("button", { name: "New note" }).click();
  const sheet = kiosk.getByRole("dialog", { name: "New note" });
  await sheet.getByLabel("Title").fill(title);
  await sheet.getByLabel("Note").fill("Out on *Tuesday* night");
  await sheet.getByLabel("Pin it to the hub").check();
  await expectKioskTargets(sheet);
  await sheet.getByRole("button", { name: "Add note" }).click();

  // The first send had no PIN, so the pad opens; a wrong one is refused.
  const pad = kiosk.getByRole("dialog", { name: `${partner}'s PIN` });
  await expect(pad).toBeVisible();
  await expectKioskTargets(pad);
  await typePin(pad, "1111");
  await expect(
    pad.getByRole("alert").filter({ hasText: "That PIN is not right." }),
  ).toBeVisible();
  await expect(kiosk.getByTestId(`note-${title}`)).toHaveCount(0);
  await typePin(pad, PIN);
  await expect(sheet).toBeHidden();
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Added ${title}.` }),
  ).toBeVisible();
  const note = kiosk.getByTestId(`note-${title}`);
  await expect(note).toContainText(`By ${partner}`);
  await expect(note.locator("em")).toHaveText("Tuesday");

  // Unpinning is a change too: it asks again.
  await note.getByRole("button", { name: "Unpin" }).click();
  await expect(pad).toBeVisible();
  await typePin(pad, PIN);
  await expect(
    kiosk.getByRole("status").filter({ hasText: `Unpinned ${title}.` }),
  ).toBeVisible();

  await ipad.context.close();
  await member.context.close();
});
