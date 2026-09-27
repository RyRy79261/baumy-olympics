import { describe, expect, it } from "vitest";
import {
  ListShoppingInput,
  SHOPPING_ITEMS_MAX,
  SHOPPING_ITEM_MAX,
  ShoppingWrite,
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
    const r = ShoppingWrite.safeParse({
      items: ["x".repeat(SHOPPING_ITEM_MAX + 1)],
    });
    expect(r.error!.issues[0]!.message).toBe(
      `Keep each item to ${SHOPPING_ITEM_MAX} characters.`,
    );
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
