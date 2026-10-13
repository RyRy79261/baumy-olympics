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
  .max(SHOPPING_ITEM_MAX, {
    error: (iss) =>
      `${namedItem(iss.input)} is over ${SHOPPING_ITEM_MAX} characters.`,
  });

/**
 * How a too-long item is named in its error: its first 20 characters. Only a
 * trimmed string over the limit gets here, so it is always cut.
 */
function namedItem(input: unknown): string {
  return `"${String(input).slice(0, 20)}…"`;
}

/**
 * A string that is a JSON array of strings, as some MCP clients send a list
 * (issue #206): that array. Anything else is not a list, so null.
 */
function jsonStringList(text: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return Array.isArray(parsed) && parsed.every((x) => typeof x === "string")
    ? parsed
    : null;
}

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
 * One or more items, each as it is: an array (JSON, a repeated form field),
 * a string holding a JSON array of strings (some MCP clients send the list
 * that way, issue #206), or any other string as one item (a form with a
 * single item). One bad item refuses the whole call.
 */
export const ShoppingItems = z
  .union([z.array(z.string()), z.string()], {
    error: "Name at least one item.",
  })
  .transform((v) => (Array.isArray(v) ? v : (jsonStringList(v) ?? [v])))
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

// --- Groups (issue #208, SPEC §3.4, §12 decision 39) -------------------------
// Owner, 2026-10-11: six groups. Brain owns each item's group (baumy-brain
// PR #30, `lib/lists/categories.ts`): it sorts a new item by itself a few
// seconds after the add, and a pick here sets it. The keys are brain's; the
// labels and the order are what people see, "Not sorted" (a null group) last.

export const SHOPPING_CATEGORIES = [
  "pantry",
  "fresh",
  "coffee",
  "cleaning",
  "maintenance",
  "household",
] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

/** What people see, in the order the groups are shown. */
export const SHOPPING_CATEGORY_LABELS: Record<ShoppingCategory, string> = {
  pantry: "Pantry",
  fresh: "Fresh",
  coffee: "Coffee",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  household: "Household",
};

/** The heading of the items in no group. Always shown last. */
export const NOT_SORTED_LABEL = "Not sorted";

export function isShoppingCategory(x: unknown): x is ShoppingCategory {
  return (
    typeof x === "string" &&
    (SHOPPING_CATEGORIES as readonly string[]).includes(x)
  );
}

/** "Coffee", or "Not sorted" for null. */
export function shoppingCategoryLabel(c: ShoppingCategory | null): string {
  return c ? SHOPPING_CATEGORY_LABELS[c] : NOT_SORTED_LABEL;
}

export const ShoppingCategoryKey = z.enum(SHOPPING_CATEGORIES, {
  error: `Pick one of the groups: ${SHOPPING_CATEGORIES.join(", ")}.`,
});

/** `add_shopping_items`: the items, and optionally the group they go into. */
export const ShoppingAdd = ShoppingWrite.extend({
  category: ShoppingCategoryKey.optional().describe(
    "Optional: the group every new item goes into (pantry, fresh, coffee, cleaning, maintenance or household). Leave it out and brain sorts each new item by itself a few seconds later.",
  ),
});

/** Brain's ids are UUIDs. */
export const ShoppingItemId = z.guid({ error: "That is not an item's id." });

/**
 * `set_shopping_category`: one item, by its id from `list_shopping` or by
 * its name, and its group, or null for "Not sorted". With both, the id wins.
 */
export const SetShoppingCategoryInput = z
  .strictObject({
    id: ShoppingItemId.optional().describe(
      "The item's id, as list_shopping gives it. Wins over `item`.",
    ),
    item: ShoppingItem.optional().describe(
      "The item's name, as list_shopping gives it, when you have no id.",
    ),
    category: ShoppingCategoryKey.nullable().describe(
      'The group: pantry, fresh, coffee, cleaning, maintenance or household; null for "Not sorted".',
    ),
  })
  .refine((v) => v.id !== undefined || v.item !== undefined, {
    error: "Name the item.",
    path: ["item"],
  });
