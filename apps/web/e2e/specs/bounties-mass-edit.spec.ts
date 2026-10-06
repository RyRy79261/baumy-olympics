import { expect, test, type Page } from "@playwright/test";
import { addChore } from "../lib/chores";
import { founderAdmin } from "../lib/household";

// Issue #175 on the admin page (SPEC §12 decision 31): "Edit many at once"
// turns /admin/chores' list into one editable row per bounty. The founder
// changes three rows (points and photo proof, a name, a restore), sees them
// marked, and saves them in one go. A save with one bad row (two bounties
// given the same name) says why and saves none of them.

function toast(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

test("an admin edits many bounties at once on /admin/chores, all or none", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(
    project === "ipad-portrait",
    "The kiosk's own editor is kiosk-bounties-mass-edit.spec.ts.",
  );
  test.setTimeout(120_000);
  const tag = Math.random().toString(36).slice(2, 8);
  const bins = `Bins ${tag}`;
  const sink = `Sink ${tag}`;
  const plates = `Plates ${tag}`;
  const oven = `Oven ${tag}`;

  await founderAdmin(page, project);
  await addChore(page, { name: bins, basePoints: 10, cooldownHours: 24 });
  await addChore(page, { name: sink, basePoints: 12, cooldownHours: 24 });
  await addChore(page, { name: oven, basePoints: 30, cooldownHours: 72 });
  await page.getByRole("button", { name: `Archive ${oven}` }).click();
  await expect(toast(page, `Archived ${oven}.`)).toBeVisible();

  await page.getByRole("button", { name: "Edit many at once" }).click();
  const editor = page.getByTestId("bounty-bulk-editor");
  await expect(editor).toBeVisible();
  const row = (name: string) => editor.getByTestId(`bulk-bounty-${name}`);
  await expect(row(bins).getByLabel("Points")).toHaveValue("10");
  await expect(row(oven).getByLabel("Status")).toHaveValue("archived");
  await expect(
    editor.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();

  // One bad row: Sink renamed to Bins' name.
  await row(bins).getByLabel("Points").fill("25");
  await row(bins).getByLabel("Photo proof").selectOption("required");
  await row(sink).getByLabel("Name").fill(bins);
  await row(oven).getByLabel("Status").selectOption("active");
  for (const name of [bins, sink, oven]) {
    await expect(row(name)).toHaveAttribute("data-changed", "true");
  }
  await expect(editor).toContainText("3 bounties changed, not saved yet.");
  await editor.getByRole("button", { name: "Save 3 changes" }).click();
  await expect(editor.getByRole("alert")).toHaveText(
    `There is already a chore called ${bins}. Pick another name.`,
  );
  // None of it was saved: a fresh look at the page has the old values.
  const fresh = await page.context().newPage();
  await fresh.goto("/admin/chores");
  await expect(fresh.getByTestId(`admin-chore-${bins}`)).toContainText(
    "10 pts",
  );
  await expect(fresh.getByTestId(`admin-chore-${sink}`)).toBeVisible();
  await expect(fresh.getByTestId(`admin-chore-${oven}`)).toContainText(
    "archived",
  );
  await fresh.close();

  // Fixed: the edits were kept, so only the name changes.
  await expect(row(bins).getByLabel("Points")).toHaveValue("25");
  await row(sink).getByLabel("Name").fill(plates);
  await editor.getByRole("button", { name: "Save 3 changes" }).click();
  await expect(toast(page, "Saved 3 bounties.")).toBeVisible();
  await expect(editor).toBeHidden();

  // The list shows all three changes.
  await expect(page.getByTestId(`admin-chore-${bins}`)).toContainText("25 pts");
  await expect(page.getByTestId(`admin-chore-${bins}`)).toContainText(
    "proof required",
  );
  await expect(page.getByTestId(`admin-chore-${plates}`)).toContainText(
    "12 pts",
  );
  await expect(page.getByTestId(`admin-chore-${sink}`)).toHaveCount(0);
  await expect(page.getByTestId(`admin-chore-${oven}`)).toContainText("30 pts");
  await expect(page.getByTestId(`admin-chore-${oven}`)).not.toContainText(
    "archived",
  );

  // Discard throws edits away; Close goes back to the list.
  await page.getByRole("button", { name: "Edit many at once" }).click();
  await row(bins).getByLabel("Points").fill("99");
  await expect(row(bins)).toHaveAttribute("data-changed", "true");
  await editor.getByRole("button", { name: "Discard" }).click();
  await expect(row(bins).getByLabel("Points")).toHaveValue("25");
  await expect(row(bins)).not.toHaveAttribute("data-changed", "true");
  await editor.getByRole("button", { name: "Close" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId(`admin-chore-${bins}`)).toContainText("25 pts");
});
