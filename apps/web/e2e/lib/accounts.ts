// Accounts for the e2e specs, made through the real sign-up and sign-in
// forms (SPEC §10: no database back door).

import { expect, type Page } from "@playwright/test";
import { PASSWORD_MIN_LENGTH } from "@baumy/auth/password";

export const PASSWORD = "e2e-member-passphrase-".padEnd(
  PASSWORD_MIN_LENGTH + 2,
  "z",
);

/** A fresh address per call, since every project shares one database. */
export function freshEmail(label: string): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${label}-${id}@example.com`;
}

/**
 * The founder address for this Playwright project. scripts/e2e-local.sh puts
 * exactly these on FOUNDER_EMAILS, one per project, so projects running in
 * parallel each bootstrap their own admin.
 */
export function founderEmail(project: string): string {
  return `founder-${project}@example.com`;
}

export async function signUp(page: Page, email: string, password = PASSWORD) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/auth/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/**
 * Sign up, or sign in when the account is already there: a founder address
 * is fixed per project, so a retry or a second local run finds it taken.
 */
export async function signUpOrIn(page: Page, email: string) {
  await signUp(page, email);
  const taken = page
    .getByRole("alert")
    .filter({ hasText: "already an account" });
  const left = page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
  const outcome = await Promise.race([
    left.then(() => "in" as const),
    taken.waitFor().then(() => "taken" as const),
  ]);
  if (outcome === "taken") {
    await signIn(page, email);
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
  }
}
