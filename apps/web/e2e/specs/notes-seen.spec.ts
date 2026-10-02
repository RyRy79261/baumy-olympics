import { expect, test, type Page } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";
import { kioskNav, pairedKiosk } from "../lib/kiosk";

// Issue #153 (owner, 2026-10-02): the Messages badge counts only the notes
// not seen yet. On the phone it counts this member's unseen notes, and
// opening the Board marks them seen; an edit after their view brings a note
// back. On the kitchen screen it counts the notes not every active member
// has seen, and opening the Messages there marks them seen for the picked
// member only (and for nobody when nobody is picked).
//
// It has every member of the household read a note on the kiosk, so it runs
// alone, in the server-clock project (playwright.config.ts), where no
// parallel spec's Messages count can see that happen. Counts are compared
// with what they were, never with fixed numbers: the household is shared.

test.describe.configure({ mode: "serial" });

/** The hub's Messages tile, as a number ("Messages: 3"). */
async function phoneCount(page: Page): Promise<number> {
  await page.goto("/");
  const tile = page.getByTestId("hub-tile-messages");
  await expect(tile).toHaveAttribute("aria-label", /^Messages: \d+$/);
  return Number((await tile.getAttribute("aria-label"))!.split(": ")[1]);
}

/**
 * Open `path` and wait for the notes on it to be marked seen: the page sends
 * `acknowledge_note` (a server action POST to the same path) once they are
 * on screen.
 */
async function openAndSee(
  page: Page,
  path: string,
  open?: () => Promise<void>,
) {
  const seen = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === path &&
      r.request().headers()["next-action"] !== undefined,
  );
  if (open) await open();
  else await page.goto(path);
  expect((await seen).ok()).toBe(true);
}

test("the badge counts unseen notes: opening drops it, an edit brings it back, and the kiosk counts until everyone has read", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "server-clock", "Runs alone, in server-clock.");
  const suffix = Math.random().toString(36).slice(2, 8);
  const reader = `Reader ${suffix}`;
  const title = `Boiler ${suffix}`;
  const founder = `Founder ${project}`;

  await founderAdmin(page, project);
  const invite = await mintCode(page, 1);
  const member = await newAccount(browser, `seen-${suffix}`);
  await redeem(member.page, invite, reader);
  await expect(member.page).toHaveURL(/\/$/);
  const other = member.page;

  // The new member writes a note: it is new to the founder, not to them.
  const otherBefore = await phoneCount(other);
  const before = await phoneCount(page);
  await other.goto("/notes");
  await other.getByRole("button", { name: "New note" }).click();
  const sheet = other.getByRole("dialog", { name: "New note" });
  await sheet.getByLabel("Title").fill(title);
  await sheet.getByLabel("Note").fill("Service on **Thursday**");
  await sheet.getByRole("button", { name: "Add note" }).click();
  await expect(sheet).toBeHidden();
  expect(await phoneCount(page)).toBe(before + 1);
  // Not new to the writer (and their Board marked the rest seen too).
  expect(await phoneCount(other)).toBeLessThanOrEqual(otherBefore);

  // Opening the Board marks it seen: the founder's count goes down.
  const unseen = before + 1;
  await openAndSee(page, "/notes");
  await expect(page.getByTestId(`note-${title}`)).toBeVisible();
  const afterOpen = await phoneCount(page);
  expect(afterOpen).toBeLessThan(unseen);

  // The other member edits it: it is new to the founder again.
  await other.goto("/notes");
  await other
    .getByRole("button", { name: `Edit ${title}`, exact: true })
    .click();
  const edit = other.getByRole("dialog", {
    name: `Edit ${title}`,
    exact: true,
  });
  await edit.getByLabel("Title").fill(`${title}!`);
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toBeHidden();
  const edited = `${title}!`;
  expect(await phoneCount(page)).toBe(afterOpen + 1);
  await openAndSee(page, "/notes");
  expect(await phoneCount(page)).toBe(afterOpen);

  // The founder edits it back: now the other member has not seen it.
  await page.goto("/notes");
  await page
    .getByRole("button", { name: `Edit ${edited}`, exact: true })
    .click();
  const back = page.getByRole("dialog", {
    name: `Edit ${edited}`,
    exact: true,
  });
  await back.getByLabel("Title").fill(title);
  await back.getByRole("button", { name: "Save" }).click();
  await expect(back).toBeHidden();
  expect(await phoneCount(page)).toBe(afterOpen);
  const otherUnseen = await phoneCount(other);
  expect(otherUnseen).toBeGreaterThan(0);

  // The kitchen screen counts it: not everyone has seen it.
  const ipad = await pairedKiosk(browser, page, `iPad ${suffix}`);
  const kiosk = ipad.page;
  const icon = kiosk.locator('[data-icon="messages"]');
  const module = kiosk.getByRole("dialog", { name: "Messages" });
  const message = module.getByTestId(`message-${title}`);
  const kioskBefore = Number(await icon.getAttribute("data-count"));
  expect(kioskBefore).toBeGreaterThan(0);

  // Opened with nobody picked, it marks nothing for anyone.
  await icon.click();
  await expect(message).toBeVisible();
  await expect(message.locator("strong")).toHaveText("Thursday");
  await module.getByRole("button", { name: "Close" }).click();
  await expect(module).toBeHidden();
  expect(await phoneCount(other)).toBe(otherUnseen);

  /** Pick `name` (on the Scores page), then open the home's Messages. */
  async function openMessagesAs(name: string) {
    await kioskNav(kiosk, "Scores");
    await kiosk
      .getByRole("navigation", { name: "Who is here" })
      .getByRole("button", { name, exact: true })
      .click();
    await expect(kiosk.getByTestId("acting-as")).toHaveText(name);
    await kioskNav(kiosk, "Home");
    await expect(kiosk.getByTestId("kiosk-home")).toBeVisible();
  }

  // The founder (who has seen it) opens it: only the founder is marked, so
  // the other member's count does not move, and the note is still listed.
  await openMessagesAs(founder);
  await icon.click();
  await expect(message).toBeVisible();
  await module.getByRole("button", { name: "Close" }).click();
  expect(await phoneCount(other)).toBe(otherUnseen);

  // The other member opens it on the kiosk: their own count goes down.
  await openMessagesAs(reader);
  await openAndSee(kiosk, "/kiosk", () => icon.click());
  await expect(message).toBeVisible();
  await module.getByRole("button", { name: "Close" }).click();
  expect(await phoneCount(other)).toBeLessThan(otherUnseen);

  // Every other member in turn: it stays listed until the last of them has
  // read it, and then the kitchen's count drops.
  await kioskNav(kiosk, "Scores");
  const faces = kiosk
    .getByRole("navigation", { name: "Who is here" })
    .getByRole("button");
  await expect(faces.first()).toBeVisible();
  // Each face's name as written (the bar shows it in capitals).
  const names = (
    await faces.evaluateAll((buttons) =>
      buttons.map((b) => b.lastElementChild?.textContent?.trim() ?? ""),
    )
  ).filter((n) => n !== founder && n !== reader);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    await openMessagesAs(name);
    await openAndSee(kiosk, "/kiosk", () => icon.click());
    // Still listed while this member was reading it.
    await expect(message).toBeVisible();
    await module.getByRole("button", { name: "Close" }).click();
    await expect(module).toBeHidden();
  }
  await kiosk.reload();
  await expect
    .poll(async () => Number((await icon.getAttribute("data-count")) ?? 0))
    .toBeLessThan(kioskBefore);
  await icon.click();
  await expect(module).toBeVisible();
  await expect(message).toHaveCount(0);

  await ipad.context.close();
  await member.context.close();
});
