import { expect, test } from "@playwright/test";
import { addChore, slideTo } from "../lib/chores";
import { founderAdmin } from "../lib/household";
import {
  expectKioskTargets,
  openKioskSettings,
  pairedKiosk,
  setPersonalPin,
  typePin,
} from "../lib/kiosk";

// Issue #175 on the kitchen iPad (SPEC §12 decision 31): an admin picked on
// the kiosk edits many bounties on its Settings page, one row per bounty,
// and the one Save asks their PIN. Nobody picked sees no editor (a member
// neither: kiosk-admin.spec.ts). Points, effort and cooldown are sliders
// (issue #179), driven here by keys, by − and + (points only, SPEC §12
// decision 33) and by a finger's tap (Chromium only).

const PIN = "1357";

test("on the kiosk, an admin edits many bounties in one save with their PIN", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(project !== "ipad-portrait", "The kiosk is an iPad in portrait.");
  test.setTimeout(120_000);
  const tag = Math.random().toString(36).slice(2, 8);
  const kettle = `Kettle ${tag}`;
  const towels = `Towels ${tag}`;
  const founder = `Founder ${project}`;

  await founderAdmin(page, project);
  await setPersonalPin(page, PIN);
  await addChore(page, { name: kettle, basePoints: 8, cooldownHours: 48 });
  await addChore(page, { name: towels, basePoints: 6, cooldownHours: 24 });

  const ipad = await pairedKiosk(browser, page, `iPad ${tag}`);
  const kiosk = ipad.page;
  await openKioskSettings(kiosk);
  // Nobody picked: the idle card, and no editor.
  await expect(
    kiosk.getByText("Tap your avatar at the top to change it."),
  ).toBeVisible();
  await expect(kiosk.getByTestId("bounty-bulk-editor")).toHaveCount(0);

  await kiosk.getByRole("button", { name: founder, exact: true }).click();
  await expect(kiosk.getByTestId("acting-as")).toHaveText(founder);
  const editor = kiosk.getByTestId("bounty-bulk-editor");
  await expect(editor).toBeVisible();
  const row = (name: string) => editor.getByTestId(`bulk-bounty-${name}`);
  // The numbers are sliders (issue #179), each named for its bounty.
  const slider = (name: string, label: string) =>
    row(name).getByRole("slider", { name: `${label} for ${name}` });
  const points = (name: string) => slider(name, "Points");
  await expect(points(kettle)).toHaveAttribute("aria-valuetext", "8 pts");
  await expect(slider(kettle, "Cooldown (h)")).toHaveAttribute(
    "aria-valuetext",
    "48 h · 2 days",
  );

  await slideTo(points(kettle), "33 pts");
  await expect(row(kettle)).toContainText("33 pts");
  // − and + step the points by one (SPEC §12 decision 33).
  await row(kettle)
    .getByRole("button", { name: `One point more for ${kettle}` })
    .click();
  await expect(points(kettle)).toHaveAttribute("aria-valuetext", "34 pts");
  await row(kettle)
    .getByRole("button", { name: `One point less for ${kettle}` })
    .click();
  await expect(points(kettle)).toHaveAttribute("aria-valuetext", "33 pts");
  // A finger's tap at the start of the effort track sets the least effort.
  // Chromium only: iPad Safari does not jump to a tap on the track (there
  // you drag the thumb, as the manual says), and this project is Chromium.
  const effort = slider(kettle, "Effort (%)");
  const track = (await effort.boundingBox())!;
  await effort.tap({ position: { x: 2, y: track.height / 2 } });
  await expect(effort).toHaveAttribute("aria-valuetext", "50%");
  await row(kettle).getByLabel("Kind").selectOption("consumable");
  await row(towels).getByLabel("Photo proof").selectOption("required");
  await row(towels).getByLabel("Status").selectOption("archived");
  await expect(row(kettle)).toHaveAttribute("data-changed", "true");
  await expect(row(towels)).toHaveAttribute("data-changed", "true");
  await expectKioskTargets(editor);
  for (const field of [
    "Name",
    "Points",
    "Kind",
    "Status",
    "Effort (%)",
    "Cooldown (h)",
  ]) {
    const box = (await row(kettle).getByLabel(field).boundingBox())!;
    expect(box.height, field).toBeGreaterThanOrEqual(56);
  }

  // The Save bar sticks to the bottom of the screen, in view while the rows
  // scroll, and Baumy covers neither button.
  await row(kettle).scrollIntoViewIfNeeded();
  const bar = editor.getByTestId("bulk-save-bar");
  const save = bar.getByRole("button", { name: "Save 2 changes" });
  await expect(save).toBeInViewport();
  // Flush on the footer: no rows show under the bar.
  const mainBox = (await kiosk.locator("main").boundingBox())!;
  const barAt = (await bar.boundingBox())!;
  expect(
    Math.abs(barAt.y + barAt.height - (mainBox.y + mainBox.height)),
  ).toBeLessThanOrEqual(1);
  const cat = (await kiosk
    .getByRole("button", { name: "Ask Baumy" })
    .boundingBox())!;
  for (const b of [save, bar.getByRole("button", { name: "Discard" })]) {
    const box = (await b.boundingBox())!;
    const overlaps =
      box.x < cat.x + cat.width &&
      cat.x < box.x + box.width &&
      box.y < cat.y + cat.height &&
      cat.y < box.y + box.height;
    expect(overlaps, (await b.textContent()) ?? "").toBe(false);
  }
  // A field hidden behind the bar comes out from under it when it gets the
  // focus: each of the last row's fields, scrolled behind the bar first.
  const main = kiosk.locator("main");
  const last = editor.getByRole("listitem").last();
  for (const label of ["Kind", "Photo proof", "Effort (%)", "Cooldown (h)"]) {
    const field = last.getByLabel(label);
    await field.scrollIntoViewIfNeeded();
    let box = (await field.boundingBox())!;
    let barBox = (await bar.boundingBox())!;
    // Its bottom edge at the middle of the bar: on screen, but covered.
    const by = box.y + box.height - (barBox.y + barBox.height / 2);
    await main.evaluate((m, dy) => m.scrollBy(0, dy), by);
    box = (await field.boundingBox())!;
    barBox = (await bar.boundingBox())!;
    expect(box.y + box.height, `${label} starts covered`).toBeGreaterThan(
      barBox.y,
    );
    await field.focus();
    box = (await field.boundingBox())!;
    barBox = (await bar.boundingBox())!;
    expect(box.y + box.height, label).toBeLessThanOrEqual(barBox.y);
  }
  await save.click();
  const pad = kiosk.getByRole("dialog", { name: `${founder}'s PIN` });
  await expect(pad).toBeVisible();
  // The rows are kept for the PIN's second send.
  await expect(points(kettle)).toHaveAttribute("aria-valuetext", "33 pts");
  await expect(effort).toHaveAttribute("aria-valuetext", "50%");
  await expect(row(kettle).getByLabel("Kind")).toHaveValue("consumable");
  await typePin(pad, PIN);
  await expect(pad).toBeHidden();
  await expect(
    kiosk.getByRole("status").filter({ hasText: "Saved 2 bounties." }),
  ).toBeVisible();
  await expect(row(kettle)).not.toHaveAttribute("data-changed", "true");
  await expect(points(kettle)).toHaveAttribute("aria-valuetext", "33 pts");
  await expect(effort).toHaveAttribute("aria-valuetext", "50%");
  await expect(row(towels).getByLabel("Status")).toHaveValue("archived");

  // The phone's admin page has them.
  await page.goto("/admin/chores");
  const k = page.getByTestId(`admin-chore-${kettle}`);
  await expect(k).toContainText("33 pts");
  await expect(k).toContainText("consumable");
  const t = page.getByTestId(`admin-chore-${towels}`);
  await expect(t).toContainText("proof required");
  await expect(t).toContainText("archived");

  await ipad.context.close();
});
