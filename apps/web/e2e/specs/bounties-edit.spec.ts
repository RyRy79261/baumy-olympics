import { expect, test, type Page } from "@playwright/test";
import { founderAdmin, mintCode, newAccount, redeem } from "../lib/household";

// Issues #109 and #115: an admin adds and edits bounties from the Bounties
// page, and changes any bounty's points in the open. The founder adds one
// with New bounty, renames it and makes it a consumable with its Edit
// button, then schedules new points with a reason from the dialog's Change
// points (schedule_points_change: next Monday at the earliest, vetoable).
// The partner, a member, sees the board without New bounty or Edit, vetoes
// the change in Activity, and the points history shows who proposed it and who
// vetoed it, to both of them. On /admin/chores, clearing both points and
// cooldown is an inline "Required", not a silent keep. At 360px the Edit
// button sits on its own line under the row, so the name never breaks.

function toast(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

test("an admin schedules any points on /chores; a member vetoes them; the history shows both", async ({
  page,
  browser,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(
    project === "ipad-portrait",
    "Admin edits need a real session; the kiosk's board stays read-only.",
  );
  test.setTimeout(120_000);
  const tag = Math.random().toString(36).slice(2, 8);
  const first = `Bathroom ${tag}`;
  const renamed = `Bathroom sink ${tag}`;
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
  await create.getByLabel("Cooldown (hours)").fill("24");
  await create.getByRole("button", { name: "Add bounty" }).click();
  await expect(toast(page, `Added ${first}.`)).toBeVisible();
  await expect(create).toBeHidden();
  const row = page.getByTestId(`chore-${first}`);
  await expect(row).toContainText("40 pts");

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

  // Below `sm` Edit sits under the row, which keeps the whole width for
  // the name; wider, it sits beside it.
  const editButton = page.getByRole("button", { name: `Edit ${renamed}` });
  const rowBox = (await moved.locator("button").first().boundingBox())!;
  const editBox = (await editButton.boundingBox())!;
  if (project === "mobile-360") {
    expect(editBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1);
    expect(rowBox.width).toBeGreaterThan(300);
    // The screen around the row, not the whole (long) board.
    await moved.scrollIntoViewIfNeeded();
    const shot = await page.screenshot();
    await testInfo.attach("bounties-360", {
      body: shot,
      contentType: "image/png",
    });
  } else {
    expect(editBox.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width - 1);
  }

  // Change points: any points, a reason, scheduled.
  await editButton.click();
  const dialog = page.getByRole("dialog", { name: `Edit ${renamed}` });
  const points = dialog.getByTestId("bounty-points");
  await points.getByRole("button", { name: "Change points" }).click();
  await expect(points).toContainText("unless another member vetoes them");
  const change = points.getByRole("form", {
    name: `Change ${renamed}'s points`,
  });
  await expect(change.getByLabel("Points")).toHaveValue("40");
  await change.getByLabel("Points").fill("55");
  await change.getByLabel("Cooldown (hours)").fill("12");
  await change.getByLabel("Reason (optional)").fill("Takes ages");
  await change.getByRole("button", { name: "Schedule change" }).click();
  await expect(toast(page, "unless someone vetoes it")).toBeVisible();
  await expect(points).toContainText("Scheduled: 40 → 55 pts");
  await expect(
    points.getByRole("button", { name: `Cancel the ${renamed} change` }),
  ).toBeVisible();
  const waiting = points
    .getByTestId("points-change")
    .and(page.locator('[data-outcome="pending"]'));
  await expect(waiting).toContainText("40 → 55 pts");
  await expect(waiting).toContainText("Takes ages");
  await expect(waiting).toContainText("Set by an admin");
  // Scheduled, not applied: the bounty is still worth 40.
  await expect(moved).toContainText("40 pts");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeHidden();

  // The partner sees the bounty, and neither New bounty nor Edit…
  const invite = await mintCode(page, 1);
  const partner = await newAccount(browser, `bounties-${project}`);
  await redeem(partner.page, invite, partnerName);
  await expect(partner.page).toHaveURL(/\/$/);
  const p = partner.page;
  await p.goto("/chores");
  await expect(p.getByTestId(`chore-${renamed}`)).toBeVisible();
  await expect(p.getByRole("button", { name: "New bounty" })).toHaveCount(0);
  await expect(p.getByRole("button", { name: `Edit ${renamed}` })).toHaveCount(
    0,
  );
  // …and vetoes the change in Activity, where its reason shows.
  await p.goto("/activity");
  const scheduled = p.locator(
    `[data-testid="activity-points-${renamed}"][data-event="scheduled"]`,
  );
  await expect(scheduled).toContainText("40 → 55 pts");
  await expect(scheduled).toContainText("Takes ages");
  await scheduled.getByRole("button", { name: "Veto" }).click();
  await expect(toast(p, "Vetoed.")).toBeVisible();
  await expect(scheduled.getByRole("button")).toHaveCount(0);

  // The history, for the member: from the Bounties page's link.
  await p.goto("/chores");
  await p.getByRole("link", { name: "Points history" }).click();
  await expect(
    p.getByRole("heading", { name: "Points history", level: 1 }),
  ).toBeVisible();
  const history = p.getByTestId(`history-${renamed}`);
  const vetoed = history
    .getByTestId("points-change")
    .and(p.locator('[data-outcome="vetoed"]'));
  await expect(vetoed).toContainText("40 → 55 pts");
  await expect(vetoed).toContainText(`Founder ${project}`);
  await expect(vetoed).toContainText("Takes ages");
  await expect(vetoed).toContainText(`Vetoed by ${partnerName}`);
  await expect(
    history
      .getByTestId("points-change")
      .and(p.locator('[data-outcome="landed"]')),
  ).toContainText("Starting points");
  await partner.context.close();

  // …and for the admin, in the dialog, where Change points is back.
  await page.goto("/chores");
  await page.getByRole("button", { name: `Edit ${renamed}` }).click();
  const after = page.getByRole("dialog", { name: `Edit ${renamed}` });
  await expect(
    after
      .getByTestId("points-change")
      .and(page.locator('[data-outcome="vetoed"]')),
  ).toContainText(`Vetoed by ${partnerName}`);
  await expect(
    after.getByRole("button", { name: "Change points" }),
  ).toBeVisible();
  await expect(page.getByTestId(`chore-${renamed}`)).toContainText("40 pts");
});

test("admin chores says points and cooldown are required when both are cleared", async ({
  page,
}, testInfo) => {
  const project = testInfo.project.name;
  test.skip(
    project !== "desktop-chromium",
    "One viewport is enough for a form rule.",
  );
  const tag = Math.random().toString(36).slice(2, 8);
  const name = `Windows ${tag}`;
  await founderAdmin(page, project);
  await page.goto("/admin/chores");
  const add = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add chore" }),
  });
  await add.getByLabel("Name", { exact: true }).fill(name);
  await add.getByLabel("Base points").fill("30");
  await add.getByLabel("Cooldown (hours)").fill("48");
  await add.getByRole("button", { name: "Add chore" }).click();
  await expect(toast(page, `Added ${name}.`)).toBeVisible();

  await page.getByRole("button", { name: `Edit ${name}` }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${name}` });
  await edit.getByLabel("Base points").fill("");
  await edit.getByLabel("Cooldown (hours)").fill("");
  await edit.getByRole("button", { name: "Save" }).click();
  const required = "Required: give the points and the cooldown.";
  await expect(edit.getByText(required)).toHaveCount(2);
  await expect(edit.getByLabel("Base points")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(edit).toBeVisible();
  await edit.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId(`admin-chore-${name}`)).toContainText(
    "30 pts · cooldown 48h",
  );
});
