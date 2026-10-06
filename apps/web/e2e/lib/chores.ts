// Chore steps shared by the chore specs, through the real pages.

import { expect, type Locator, type Page } from "@playwright/test";

export interface NewChore {
  name: string;
  basePoints: number;
  cooldownHours: number;
  /** Maintenance unless given (ADR 0005 §2). */
  kind?: "consumable" | "maintenance";
}

/** An admin adds a chore on /admin/chores. */
export async function addChore(admin: Page, chore: NewChore) {
  await admin.goto("/admin/chores");
  await expect(
    admin.getByRole("heading", { name: "Edit chores", level: 1 }),
  ).toBeVisible();
  const form = admin.locator("form").filter({
    has: admin.getByRole("button", { name: "Add chore" }),
  });
  await form.getByLabel("Name").fill(chore.name);
  if (chore.kind) await form.getByLabel("Kind").selectOption(chore.kind);
  await form.getByLabel("Base points").fill(String(chore.basePoints));
  await form.getByLabel("Cooldown (hours)").fill(String(chore.cooldownHours));
  await form.getByRole("button", { name: "Add chore" }).click();
  await expect(admin.getByTestId(`admin-chore-${chore.name}`)).toContainText(
    `${chore.basePoints} pts`,
  );
}

/** The tile of a chore in the grid. */
export function tile(page: Page, name: string): Locator {
  // The first: an admin also has the Edit button beside it (issue #109).
  return page.getByTestId(`chore-${name}`).getByRole("button").first();
}

/**
 * Move a slider (the mass editor's points, effort and cooldown, issue #179)
 * with the keyboard until it says `text` (its aria-valuetext, e.g.
 * "25 pts"): one arrow press at a time from where it stands.
 */
export async function slideTo(slider: Locator, text: string, max = 250) {
  const said = () => slider.getAttribute("aria-valuetext");
  const number = (s: string | null) => parseFloat(s ?? "");
  const target = number(text);
  for (let i = 0; (await said()) !== text; i++) {
    expect(i, `the slider never said ${text}`).toBeLessThan(max);
    const now = await said();
    // "Not set" is no number: start from the first stop.
    const key = Number.isNaN(number(now))
      ? "Home"
      : number(now) < target
        ? "ArrowRight"
        : "ArrowLeft";
    await slider.press(key);
  }
}

/** Tap a chore's tile and return its sheet. */
export async function openChore(page: Page, name: string): Promise<Locator> {
  await tile(page, name).click();
  const sheet = page.getByRole("dialog", { name: `Log ${name}` });
  await expect(sheet).toBeVisible();
  return sheet;
}
