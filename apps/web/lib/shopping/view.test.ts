import { describe, expect, it } from "vitest";
import { addedMessage, checkedOffMessage, splitItemsForm } from "./view";

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
