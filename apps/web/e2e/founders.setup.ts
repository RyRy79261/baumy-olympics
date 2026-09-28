import { test as setup } from "@playwright/test";
import { founderAdmin } from "./lib/household";

// The `founders` project (playwright.config.ts): each project's founder signs
// up, confirms the address and joins as admin once, here, before any spec
// runs. Left to the specs, the first two tests of a project would bootstrap
// the same founder at the same moment, and the loser of that race fails
// (a duplicate sign-up, or a stale "confirm your email" on /join). Every
// spec still calls founderAdmin, which then only signs in.
const PROJECTS = [
  "server-clock",
  "desktop-chromium",
  "ipad-portrait",
  "mobile-360",
];

for (const project of PROJECTS) {
  setup(`founder of ${project}`, async ({ page }) => {
    await founderAdmin(page, project);
  });
}
