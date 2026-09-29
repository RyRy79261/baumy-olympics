// The kit's picture pickers (packages/ui pickers.tsx, issue #106): each
// option is a visually hidden radio, named by its label, inside a tile.

import type { Locator, Page } from "@playwright/test";

/** The radio for `option` in the group whose legend is `group`. */
export function tileRadio(
  scope: Page | Locator,
  group: string,
  option: string,
): Locator {
  return scope
    .getByRole("group", { name: group, exact: true })
    .getByRole("radio", { name: option, exact: true });
}

/** Tap the tile, as a finger would; the radio itself is hidden. */
export async function pickTile(
  scope: Page | Locator,
  group: string,
  option: string,
) {
  await tileRadio(scope, group, option).locator("xpath=..").click();
}
