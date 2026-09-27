import { z } from "zod";

// The house shopping list at its boundaries (SPEC §3.4, §6.6, issue #26).
// baumy-brain owns the list (ADR 0003); Olympics only reads it and sends it
// items to add or check off, by name, through brain's kitchen API.
// `add_shopping_items` and `check_off_shopping_items` parse with these.

/** Brain clamps an item to 80 characters; longer is refused here instead. */
export const SHOPPING_ITEM_MAX = 80;
/** Brain takes at most 30 items in one write. */
export const SHOPPING_ITEMS_MAX = 30;

export const ShoppingItem = z
  .string({ error: "Name the item." })
  .trim()
  .min(1, "Name the item.")
  .max(SHOPPING_ITEM_MAX, `Keep each item to ${SHOPPING_ITEM_MAX} characters.`);

/**
 * Split what someone typed in the quick-add field into items: commas and new
 * lines separate them, and blanks are dropped. "and" does not, so "salt and
 * vinegar crisps" stays one item. The UI splits before it sends; the actions
 * never split, so an item whose name has a comma can still be checked off.
 */
export function splitShoppingText(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * One or more items, each as it is: an array (JSON, a repeated form field)
 * or one string (a form with a single item).
 */
export const ShoppingItems = z
  .union([z.array(z.string()), z.string()], {
    error: "Name at least one item.",
  })
  .transform((v) => (Array.isArray(v) ? v : [v]))
  .pipe(
    z
      .array(ShoppingItem)
      .min(1, "Name at least one item.")
      .max(SHOPPING_ITEMS_MAX, `Add at most ${SHOPPING_ITEMS_MAX} at once.`),
  );

export const ListShoppingInput = z.strictObject({});

export const ShoppingWrite = z.strictObject({
  items: ShoppingItems.describe(
    'The items, one entry each, as people would write them: ["milk", "eggs"]. Put every item of one request in this one list.',
  ),
});
