// The hub header's folded menus (issue #64): the main pages are always in
// the nav row; Settings and Sign out sit in the account menu (the button
// showing who is signed in), and the admin pages in the Admin menu.

import { expect, type Page } from "@playwright/test";

/** Opens the account menu (Settings, Sign out). */
export async function openAccountMenu(page: Page) {
  const menu = page.getByTestId("account-menu");
  await menu.getByRole("button").click();
  await expect(menu.getByRole("link", { name: "Settings" })).toBeVisible();
}

/** Opens the Admin menu (Members, Edit chores, Weights). */
export async function openAdminMenu(page: Page) {
  const menu = page.getByTestId("admin-menu");
  await menu.getByRole("button", { name: "Admin" }).click();
  await expect(menu.getByRole("link", { name: "Members" })).toBeVisible();
}
