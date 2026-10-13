import { describe, expect, it } from "vitest";
import { GLYPH_NAMES } from "@baumy/ui";
import { SHOPPING_CATEGORIES } from "@baumy/types";
import type { ShoppingEntry } from "@/lib/integrations/brain";
import {
  CATEGORY_GLYPHS,
  NO_GROUP,
  addedMessage,
  categoryMessage,
  checkedOffMessage,
  groupFormInput,
  groupShopping,
  splitItemsForm,
} from "./view";

// Issue #208: the groups, their order, their icons and their words.

function entry(
  item: string,
  category: ShoppingEntry["category"] = null,
): ShoppingEntry {
  return { id: item, item, addedAt: "2026-10-13T09:00:00.000Z", category };
}

describe("groupShopping", () => {
  it("puts the items under their groups in the fixed order, Not sorted last, and only groups with items", () => {
    const groups = groupShopping([
      entry("bleach", "cleaning"),
      entry("mystery"),
      entry("beans", "coffee"),
      entry("rice", "pantry"),
      entry("filters", "coffee"),
      entry("tp", "household"),
    ]);
    expect(
      groups!.map((g) => [g.category, g.label, g.items.map((i) => i.item)]),
    ).toEqual([
      ["pantry", "Pantry", ["rice"]],
      ["coffee", "Coffee", ["beans", "filters"]],
      ["cleaning", "Cleaning", ["bleach"]],
      ["household", "Household", ["tp"]],
      [null, "Not sorted", ["mystery"]],
    ]);
  });

  it("shows every group in order when each has an item", () => {
    const groups = groupShopping(
      [...SHOPPING_CATEGORIES].reverse().map((c) => entry(c, c)),
    );
    expect(groups!.map((g) => g.label)).toEqual([
      "Pantry",
      "Fresh",
      "Coffee",
      "Cleaning",
      "Maintenance",
      "Household",
    ]);
  });

  it("is null, a flat list, when no item has a group", () => {
    expect(groupShopping([entry("milk"), entry("eggs")])).toBeNull();
    expect(groupShopping([])).toBeNull();
  });
});

describe("CATEGORY_GLYPHS", () => {
  it("gives each group an existing glyph of the kit, each a different one", () => {
    const names = SHOPPING_CATEGORIES.map((c) => CATEGORY_GLYPHS[c]);
    for (const n of names) expect(GLYPH_NAMES).toContain(n);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("categoryMessage", () => {
  it("says where the item went", () => {
    expect(
      categoryMessage({ item: "Oat milk", category: "fresh", items: [] }),
    ).toBe("Put Oat milk under Fresh.");
    expect(
      categoryMessage({ item: "Oat milk", category: null, items: [] }),
    ).toBe("Moved Oat milk to Not sorted.");
  });
});

describe("groupFormInput", () => {
  it("turns the Not sorted button into null and leaves a group as it is", () => {
    expect(groupFormInput({ id: "x", category: NO_GROUP })).toEqual({
      id: "x",
      category: null,
    });
    expect(groupFormInput({ id: "x", category: "coffee" })).toEqual({
      id: "x",
      category: "coffee",
    });
    expect(groupFormInput({ id: "x" })).toEqual({ id: "x" });
  });
});

// The shopping list's toasts, and the quick-add field split into items.

describe("addedMessage", () => {
  it("says what is new and what was there already", () => {
    expect(
      addedMessage({ added: ["milk", "eggs"], already: [], items: [] }),
    ).toBe("Added milk and eggs.");
    expect(addedMessage({ added: ["tea"], already: ["milk"], items: [] })).toBe(
      "Added tea. milk was on the list already.",
    );
    expect(addedMessage({ added: [], already: ["a", "b"], items: [] })).toBe(
      "a and b were on the list already.",
    );
  });

  it("names the group the new items went into, and what stayed Not sorted", () => {
    expect(
      addedMessage({
        added: ["beans", "filters"],
        already: ["milk"],
        items: [],
        category: "coffee",
        notSorted: [],
      }),
    ).toBe("Added beans and filters to Coffee. milk was on the list already.");
    expect(
      addedMessage({
        added: ["beans", "filters"],
        already: [],
        items: [],
        category: "coffee",
        notSorted: ["filters"],
      }),
    ).toBe("Added beans and filters to Coffee. filters stayed in Not sorted.");
  });
});

describe("checkedOffMessage", () => {
  it("says what was checked off, and what was not there", () => {
    expect(
      checkedOffMessage({ checkedOff: ["milk"], notFound: [], items: [] }),
    ).toBe("Checked off milk.");
    expect(
      checkedOffMessage({ checkedOff: ["milk"], notFound: ["tea"], items: [] }),
    ).toBe("Checked off milk. tea was not on the list.");
    expect(
      checkedOffMessage({ checkedOff: ["a"], notFound: ["b", "c"], items: [] }),
    ).toBe("Checked off a. b and c were not on the list.");
  });
});

describe("splitItemsForm", () => {
  it("sends one items field per item typed, and keeps the rest", () => {
    const form = new FormData();
    form.set("requestId", "req-12345678");
    form.set("items", " milk, eggs\nbread ,");
    const out = splitItemsForm(form);
    expect(out.getAll("items")).toEqual(["milk", "eggs", "bread"]);
    expect(out.get("requestId")).toBe("req-12345678");
  });

  it("sends nothing but commas as empty, for the action to refuse", () => {
    const form = new FormData();
    form.set("items", " , ");
    expect(splitItemsForm(form).getAll("items")).toEqual([""]);
  });
});
