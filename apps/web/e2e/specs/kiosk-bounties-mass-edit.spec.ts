import { expect, test } from "@playwright/test";
import { addChore } from "../lib/chores";
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
// neither: kiosk-admin.spec.ts).

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
  await expect(row(kettle).getByLabel("Points")).toHaveValue("8");

  await row(kettle).getByLabel("Points").fill("33");
  await row(kettle).getByLabel("Kind").selectOption("consumable");
  await row(towels).getByLabel("Photo proof").selectOption("required");
  await row(towels).getByLabel("Status").selectOption("archived");
  await expect(row(kettle)).toHaveAttribute("data-changed", "true");
  await expect(row(towels)).toHaveAttribute("data-changed", "true");
  await expectKioskTargets(editor);
  for (const field of ["Name", "Points", "Kind", "Status"]) {
    const box = (await row(kettle).getByLabel(field).boundingBox())!;
    expect(box.height, field).toBeGreaterThanOrEqual(56);
  }

  await editor.getByRole("button", { name: "Save 2 changes" }).click();
  const pad = kiosk.getByRole("dialog", { name: `${founder}'s PIN` });
  await expect(pad).toBeVisible();
  // The rows are kept for the PIN's second send.
  await expect(row(kettle).getByLabel("Points")).toHaveValue("33");
  await expect(row(kettle).getByLabel("Kind")).toHaveValue("consumable");
  await typePin(pad, PIN);
  await expect(pad).toBeHidden();
  await expect(
    kiosk.getByRole("status").filter({ hasText: "Saved 2 bounties." }),
  ).toBeVisible();
  await expect(row(kettle)).not.toHaveAttribute("data-changed", "true");
  await expect(row(kettle).getByLabel("Points")).toHaveValue("33");
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
