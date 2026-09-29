import { expect, test, type Page } from "@playwright/test";
import { openChore } from "../lib/chores";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issue #109: an admin adds and edits bounties from the Bounties page. The
// founder adds one with New bounty, renames it and makes it a consumable
// with its Edit button, then schedules a points change from the dialog's
// Change points (schedule_weight: next Monday at the earliest, vetoable).
// The partner, a member, sees the board without New bounty or Edit.
//
// A points change needs the week's suggestion, so, as in weights.spec.ts,
// the founder logs it seven times for the partner (confirmed at once) and
// the test-only /api/test/weights runs the weekly compute; 40 points done
// every few seconds suggests 30.

function toast(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

async function logFor(page: Page, chore: string, doer: string) {
  await page.goto("/chores");
  const sheet = await openChore(page, chore);
  await sheet.getByText(doer, { exact: true }).click();
  await expect(sheet.getByRole("radio", { name: doer })).toBeChecked();
  await sheet.getByRole("button", { name: "Log it" }).click();
  await expect(sheet).toBeHidden();
}

test("an admin adds and edits a bounty on /chores; a member cannot", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(
    project === "ipad-portrait",
    "Admin edits need a real session; the kiosk's board stays read-only.",
  );
  // Two accounts, seven logs and the weekly compute: longer than most.
  test.setTimeout(180_000);
  const tag = Math.random().toString(36).slice(2, 8);
  const first = `Mop ${tag}`;
  const renamed = `Milk ${tag}`;
  const partnerName = `Partner ${tag}`;

  await founderAdmin(page, project);
  await page.goto("/chores");
  await expect(
    page.getByRole("heading", { name: "Bounties", level: 1 }),
  ).toBeVisible();

  // New bounty: the /admin/chores form, in a dialog.
  await page.getByRole("button", { name: "New bounty" }).click();
  const create = page.getByRole("dialog", { name: "New bounty" });
  await create.getByLabel("Name", { exact: true }).fill(first);
  await create.getByLabel("Base points").fill("40");
  // No cooldown, so it can be logged again straight away.
  await create.getByLabel("Cooldown (hours)").fill("0");
  await create.getByRole("button", { name: "Add bounty" }).click();
  await expect(toast(page, `Added ${first}.`)).toBeVisible();
  await expect(create).toBeHidden();
  const row = page.getByTestId(`chore-${first}`);
  await expect(row).toContainText("40 pts");
  await expect(row.locator("[data-kind]").first()).toHaveAttribute(
    "data-kind",
    "maintenance",
  );

  // Edit: the name and the kind; the points are not a field here.
  await page.getByRole("button", { name: `Edit ${first}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${first}` });
  await expect(edit.getByTestId("bounty-points")).toContainText("40 pts");
  await expect(edit.getByLabel("Name", { exact: true })).toHaveValue(first);
  await expect(edit.getByLabel("Base points")).toHaveCount(0);
  await expect(
    edit.getByRole("link", { name: "More options" }),
  ).toHaveAttribute("href", "/admin/chores");
  await edit.getByLabel("Name", { exact: true }).fill(renamed);
  await edit.getByLabel("Kind").selectOption("consumable");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(toast(page, `Saved ${renamed}.`)).toBeVisible();
  await expect(edit).toBeHidden();
  const moved = page.getByTestId(`chore-${renamed}`);
  await expect(moved.locator("[data-kind]").first()).toHaveAttribute(
    "data-kind",
    "consumable",
  );
  await expect(moved).toContainText("40 pts");
  await expect(page.getByTestId(`chore-${first}`)).toHaveCount(0);

  // Without a suggestion, Change points says none is due.
  await page.getByRole("button", { name: `Edit ${renamed}` }).click();
  const again = page.getByRole("dialog", { name: `Edit ${renamed}` });
  await again.getByRole("button", { name: "Change points" }).click();
  await expect(again.getByTestId("no-suggestion")).toContainText(
    "No change is due yet.",
  );
  await again.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(again).toBeHidden();

  // A partner, and a week's suggestion to schedule.
  const invite = await mintCode(page, 1);
  const partner = await newAccount(browser, `bounties-${project}`);
  await redeem(partner.page, invite, partnerName);
  await expect(partner.page).toHaveURL(/\/$/);
  for (let i = 0; i < 7; i += 1) await logFor(page, renamed, partnerName);
  const res = await page.request.post("/api/test/weights", {
    data: { run: "compute" },
  });
  expect(res.status()).toBe(200);
  expect((await res.json()).suggested).toBeGreaterThanOrEqual(1);

  await page.goto("/chores");
  await page.getByRole("button", { name: `Edit ${renamed}` }).click();
  const points = page.getByRole("dialog", { name: `Edit ${renamed}` });
  await points.getByRole("button", { name: "Change points" }).click();
  await expect(points).toContainText("unless another member vetoes it");
  await expect(points).toContainText("40 → 30 pts");
  const schedule = points.getByRole("form", { name: `Schedule ${renamed}` });
  await schedule.getByLabel("Points").fill("32");
  await schedule.getByRole("button", { name: "Schedule" }).click();
  await expect(toast(page, "unless someone vetoes it")).toBeVisible();
  const section = points.getByTestId("bounty-points");
  await expect(section).toContainText("Scheduled: 40 → 32 pts");
  await expect(
    section.getByRole("button", { name: `Cancel the ${renamed} change` }),
  ).toBeVisible();
  // Scheduled, not applied: the bounty is still worth 40.
  await expect(section).toContainText("40 pts");
  await expect(moved).toContainText("40 pts");

  // The partner sees the bounty, and neither New bounty nor Edit.
  const p = partner.page;
  await p.goto("/chores");
  await expect(p.getByTestId(`chore-${renamed}`)).toBeVisible();
  await expect(p.getByRole("button", { name: "New bounty" })).toHaveCount(0);
  await expect(p.getByRole("button", { name: `Edit ${renamed}` })).toHaveCount(
    0,
  );
  // …and the change waits on their veto in /inbox.
  await p.goto("/inbox");
  await expect(p.getByTestId(`scheduled-${renamed}`)).toContainText(
    "40 → 32 pts",
  );
  await partner.context.close();
});
