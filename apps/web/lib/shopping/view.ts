import type { GlyphName } from "@baumy/ui";
import {
  SHOPPING_CATEGORIES,
  shoppingCategoryLabel,
  splitShoppingText,
  type ShoppingCategory,
} from "@baumy/types";
import type {
  AddShoppingData,
  CheckOffShoppingData,
  SetShoppingCategoryData,
} from "@/lib/actions/shopping";
import { listPhrase } from "@/lib/actions/shopping-text";
import type { ShoppingEntry } from "@/lib/integrations/brain";

// The shopping list's words and forms (SPEC §3.4, issue #26). Pure and
// client-safe: the quick-add field and the rows on /shopping, the hub and
// the kitchen screen use these.

/**
 * Each group's heading icon (issue #208): existing glyphs of the kit only
 * (packages/ui/src/pixel/glyphs.ts), never drawn for this. Pantry is the tin
 * (`catfood`, a can with a ring-pull lid), Fresh the fridge, Coffee the cup,
 * Cleaning the soap bottle, Maintenance the wrench and Household the house
 * (`home`). Owner, 2026-10-13: the tin for Pantry stays, and Household is
 * `home`, not the toilet roll. "Not sorted" has none: its heading is the
 * words only.
 */
export const CATEGORY_GLYPHS: Record<ShoppingCategory, GlyphName> = {
  pantry: "catfood",
  fresh: "fridge",
  coffee: "coffee",
  cleaning: "soap",
  maintenance: "wrench",
  household: "home",
};

/** One heading's items: a group's, or the unsorted ones (null). */
export interface ShoppingGroup {
  category: ShoppingCategory | null;
  label: string;
  items: ShoppingEntry[];
}

/**
 * The list under its group headings, in the fixed order with "Not sorted"
 * last, leaving out every group with nothing in it; each keeps brain's order
 * (oldest first). Null when no item has a group at all (a brain from before
 * groups, or everything just added and not sorted yet): then the list is
 * shown flat, as before groups.
 */
export function groupShopping(items: ShoppingEntry[]): ShoppingGroup[] | null {
  if (!items.some((i) => i.category !== null)) return null;
  const order: (ShoppingCategory | null)[] = [...SHOPPING_CATEGORIES, null];
  return order
    .map((category) => ({
      category,
      label: shoppingCategoryLabel(category),
      items: items.filter((i) => i.category === category),
    }))
    .filter((g) => g.items.length > 0);
}

/** The toast after a group was picked for an item. */
export function categoryMessage(d: SetShoppingCategoryData): string {
  return d.category
    ? `Put ${d.item} under ${shoppingCategoryLabel(d.category)}.`
    : `Moved ${d.item} to ${shoppingCategoryLabel(null)}.`;
}

/** The toast after an add: what is new, and what was there already. */
export function addedMessage(d: AddShoppingData): string {
  const parts: string[] = [];
  if (d.added.length > 0) {
    const into = d.category ? ` to ${shoppingCategoryLabel(d.category)}` : "";
    parts.push(`Added ${listPhrase(d.added)}${into}.`);
    if (d.notSorted && d.notSorted.length > 0) {
      parts.push(
        `${listPhrase(d.notSorted)} stayed in ${shoppingCategoryLabel(null)}.`,
      );
    }
  }
  if (d.already.length > 0) {
    parts.push(
      `${listPhrase(d.already)} ${d.already.length === 1 ? "was" : "were"} on the list already.`,
    );
  }
  return parts.join(" ");
}

/** The toast after a check-off. */
export function checkedOffMessage(d: CheckOffShoppingData): string {
  const done = `Checked off ${listPhrase(d.checkedOff)}.`;
  return d.notFound.length > 0
    ? `${done} ${listPhrase(d.notFound)} ${d.notFound.length === 1 ? "was" : "were"} not on the list.`
    : done;
}

/**
 * The quick-add form with what was typed split into one `items` field per
 * item ("milk, eggs" → items=milk, items=eggs). Every other field is kept.
 */
export function splitItemsForm(form: FormData): FormData {
  const out = new FormData();
  for (const [key, value] of form.entries()) {
    if (key === "items" && typeof value === "string") {
      const items = splitShoppingText(value);
      // Nothing but commas: send it empty, so the action says why.
      for (const item of items.length > 0 ? items : [""]) {
        out.append("items", item);
      }
    } else {
      out.append(key, value);
    }
  }
  return out;
}

/** What the "Not sorted" button sends, since a form cannot send null. */
export const NO_GROUP = "none";

/** A group form's input for `set_shopping_category`: "none" is null. */
export function groupFormInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return input.category === NO_GROUP ? { ...input, category: null } : input;
}
