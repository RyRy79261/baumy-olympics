import { describe, expect, it } from "vitest";
import {
  ListShoppingInput,
  NOT_SORTED_LABEL,
  SHOPPING_CATEGORIES,
  SHOPPING_CATEGORY_LABELS,
  SHOPPING_ITEMS_MAX,
  SHOPPING_ITEM_MAX,
  SetShoppingCategoryInput,
  ShoppingAdd,
  ShoppingCategoryKey,
  ShoppingWrite,
  isShoppingCategory,
  shoppingCategoryLabel,
  splitShoppingText,
} from "../shopping";

describe("splitShoppingText", () => {
  it("splits on commas and new lines and drops blanks", () => {
    expect(splitShoppingText(" milk, eggs \n\n bread ,, ")).toEqual([
      "milk",
      "eggs",
      "bread",
    ]);
  });

  it("keeps 'and' inside one item", () => {
    expect(splitShoppingText("salt and vinegar crisps")).toEqual([
      "salt and vinegar crisps",
    ]);
  });
});

describe("ShoppingWrite", () => {
  it("takes an array, as the AI and MCP send it", () => {
    expect(ShoppingWrite.parse({ items: ["milk", " eggs "] })).toEqual({
      items: ["milk", "eggs"],
    });
  });

  it("takes one form field's item as it is, commas and all", () => {
    expect(ShoppingWrite.parse({ items: " Bread, wholemeal " })).toEqual({
      items: ["Bread, wholemeal"],
    });
  });

  it("refuses nothing to add", () => {
    for (const items of ["", " ", [], ["  "], ["milk", ""]]) {
      const r = ShoppingWrite.safeParse({ items });
      expect(r.success, JSON.stringify(items)).toBe(false);
      expect(r.error!.issues[0]!.message).toMatch(/Name (at least one|the)/);
    }
  });

  it("refuses a missing or wrongly typed list", () => {
    expect(ShoppingWrite.safeParse({}).success).toBe(false);
    expect(ShoppingWrite.safeParse({ items: 3 }).success).toBe(false);
  });

  it(`refuses an item over ${SHOPPING_ITEM_MAX} characters`, () => {
    expect(
      ShoppingWrite.safeParse({ items: ["x".repeat(SHOPPING_ITEM_MAX)] })
        .success,
    ).toBe(true);
    const long = `Organic oat milk ${"x".repeat(SHOPPING_ITEM_MAX)}`;
    const r = ShoppingWrite.safeParse({ items: ["milk", long, "eggs"] });
    // The whole call is refused, and the error names the item.
    expect(r.success).toBe(false);
    expect(r.error!.issues).toHaveLength(1);
    expect(r.error!.issues[0]!.message).toBe(
      `"Organic oat milk xxx…" is over ${SHOPPING_ITEM_MAX} characters.`,
    );
  });

  it("takes 13 items as an array", () => {
    const items = Array.from({ length: 13 }, (_, i) => `item ${i + 1}`);
    expect(ShoppingWrite.parse({ items })).toEqual({ items });
  });

  it("takes a JSON-string array as that array (issue #206)", () => {
    expect(ShoppingWrite.parse({ items: '["Ginger"]' })).toEqual({
      items: ["Ginger"],
    });
    expect(ShoppingWrite.parse({ items: '["a", " b "]' })).toEqual({
      items: ["a", "b"],
    });
    const thirteen = Array.from({ length: 13 }, (_, i) => `item ${i + 1}`);
    expect(ShoppingWrite.parse({ items: JSON.stringify(thirteen) })).toEqual({
      items: thirteen,
    });
  });

  it("checks each item of a JSON-string array", () => {
    const long = "y".repeat(SHOPPING_ITEM_MAX + 1);
    const r = ShoppingWrite.safeParse({ items: JSON.stringify(["a", long]) });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe(
      `"${"y".repeat(20)}…" is over ${SHOPPING_ITEM_MAX} characters.`,
    );
    expect(ShoppingWrite.safeParse({ items: "[]" }).success).toBe(false);
    const many = JSON.stringify(
      Array.from({ length: SHOPPING_ITEMS_MAX + 1 }, (_, i) => `i${i}`),
    );
    expect(
      ShoppingWrite.safeParse({ items: many }).error!.issues[0]!.message,
    ).toBe(`Add at most ${SHOPPING_ITEMS_MAX} at once.`);
  });

  it("keeps any other string as one item", () => {
    for (const items of [
      "[1,2]",
      '{"a":1}',
      "[not json",
      '["a", 1]',
      '"milk"',
    ]) {
      expect(ShoppingWrite.parse({ items }), items).toEqual({
        items: [items],
      });
    }
  });

  it(`refuses more than ${SHOPPING_ITEMS_MAX} items at once`, () => {
    const items = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);
    expect(
      ShoppingWrite.safeParse({ items: items(SHOPPING_ITEMS_MAX) }).success,
    ).toBe(true);
    const r = ShoppingWrite.safeParse({ items: items(SHOPPING_ITEMS_MAX + 1) });
    expect(r.error!.issues[0]!.message).toBe(
      `Add at most ${SHOPPING_ITEMS_MAX} at once.`,
    );
  });

  it("refuses fields it does not know", () => {
    expect(
      ShoppingWrite.safeParse({ items: ["milk"], groupId: "x" }).success,
    ).toBe(false);
  });
});

describe("ListShoppingInput", () => {
  it("takes nothing", () => {
    expect(ListShoppingInput.parse({})).toEqual({});
    expect(ListShoppingInput.safeParse({ fresh: true }).success).toBe(false);
  });
});

// Issue #208: brain's six keys (baumy-brain lib/lists/categories.ts), in the
// owner's order (2026-10-11), and "Not sorted" for none.
describe("the shopping groups", () => {
  it("are brain's six keys, in the order they are shown, each with its label", () => {
    expect(SHOPPING_CATEGORIES).toEqual([
      "pantry",
      "fresh",
      "coffee",
      "cleaning",
      "maintenance",
      "household",
    ]);
    expect(SHOPPING_CATEGORIES.map(shoppingCategoryLabel)).toEqual([
      "Pantry",
      "Fresh",
      "Coffee",
      "Cleaning",
      "Maintenance",
      "Household",
    ]);
    expect(Object.keys(SHOPPING_CATEGORY_LABELS)).toEqual([
      ...SHOPPING_CATEGORIES,
    ]);
    expect(shoppingCategoryLabel(null)).toBe("Not sorted");
    expect(NOT_SORTED_LABEL).toBe("Not sorted");
  });

  it("know a key from anything else", () => {
    expect(isShoppingCategory("coffee")).toBe(true);
    for (const x of ["Coffee", "garden", "", null, undefined, 3, {}]) {
      expect(isShoppingCategory(x), String(x)).toBe(false);
    }
    expect(ShoppingCategoryKey.safeParse("fresh").success).toBe(true);
    const label = ShoppingCategoryKey.safeParse("Fresh");
    expect(label.error!.issues[0]!.message).toBe(
      "Pick one of the groups: pantry, fresh, coffee, cleaning, maintenance, household.",
    );
  });
});

describe("ShoppingAdd", () => {
  it("takes the items and, optionally, one group", () => {
    expect(ShoppingAdd.parse({ items: ["beans"] })).toEqual({
      items: ["beans"],
    });
    expect(ShoppingAdd.parse({ items: "beans", category: "coffee" })).toEqual({
      items: ["beans"],
      category: "coffee",
    });
    for (const category of ["Coffee", null, ""]) {
      expect(
        ShoppingAdd.safeParse({ items: ["beans"], category }).success,
      ).toBe(false);
    }
    expect(ShoppingAdd.safeParse({ items: ["x"], extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("SetShoppingCategoryInput", () => {
  const id = "6f1f3f0d-2a11-4c38-9a53-0b0e6c1a3a7e";

  it("takes an item by id or by name, and a group or null", () => {
    expect(SetShoppingCategoryInput.parse({ id, category: "pantry" })).toEqual({
      id,
      category: "pantry",
    });
    expect(
      SetShoppingCategoryInput.parse({ item: " Oat milk ", category: null }),
    ).toEqual({ item: "Oat milk", category: null });
    expect(
      SetShoppingCategoryInput.parse({ id, item: "x", category: "fresh" }),
    ).toEqual({ id, item: "x", category: "fresh" });
  });

  it("needs the item and a group, and nothing else", () => {
    const none = SetShoppingCategoryInput.safeParse({ category: "fresh" });
    expect(none.error!.issues).toEqual([
      expect.objectContaining({ path: ["item"], message: "Name the item." }),
    ]);
    for (const input of [
      { item: "milk" },
      { item: "milk", category: "Fresh" },
      { id: "7", category: "fresh" },
      { item: "x".repeat(SHOPPING_ITEM_MAX + 1), category: "fresh" },
      { item: "milk", category: "fresh", telegramUserId: 1 },
    ]) {
      expect(
        SetShoppingCategoryInput.safeParse(input).success,
        JSON.stringify(input),
      ).toBe(false);
    }
  });
});
