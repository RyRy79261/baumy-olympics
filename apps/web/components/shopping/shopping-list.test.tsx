import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShoppingList } from "./shopping-list";

// The shopping list on the page, the hub and the kiosk (issue #26): big
// tap-to-check rows and the quick-add field for someone who may change it,
// and the same rows, only to read, for the kitchen screen before anyone taps
// in (issue #204).

const items = [
  { id: "1", item: "milk", addedAt: "2026-09-27T09:00:00.000Z" },
  { id: "2", item: "eggs", addedAt: "2026-09-27T09:01:00.000Z" },
];
const never = async () => {
  throw new Error("not in a static render");
};
const actions = { add: never, checkOff: never };

describe("ShoppingList", () => {
  it("offers the quick-add field and one check-off button per item", () => {
    const out = renderToStaticMarkup(
      <ShoppingList items={items} canEdit kiosk actions={actions} />,
    );
    expect(out).toContain("Add to the list");
    expect(out).toContain('name="items"');
    expect(out).toContain('aria-label="Check off milk"');
    expect(out).toContain('aria-label="Check off eggs"');
    expect(out).toContain('value="milk"');
    expect(out).toContain("min-h-14");
  });

  it("only shows the items to someone who cannot change them", () => {
    const out = renderToStaticMarkup(
      <ShoppingList items={items} canEdit={false} actions={actions} />,
    );
    expect(out).toContain('data-testid="shopping-item-milk"');
    expect(out).not.toContain("Add to the list");
    expect(out).not.toContain("Check off");
  });

  // Issue #204: the kitchen screen with nobody picked shows the picked
  // view's rows (the same framed, 56px rows with their box), with nothing
  // to tap and no quick-add.
  it("shows the kiosk's rows read-only, with no button, form or field", () => {
    const el = document.createElement("div");
    el.innerHTML = renderToStaticMarkup(
      <ShoppingList items={items} canEdit={false} kiosk actions={actions} />,
    );
    const rows = el.querySelectorAll('[data-testid="shopping-items"] > li');
    expect(rows).toHaveLength(2);
    const milk = el.querySelector('[data-testid="shopping-item-milk"]')!;
    expect(milk.textContent).toBe("milk");
    const row = milk.firstElementChild!;
    expect(row.tagName).toBe("DIV");
    expect(row.className).toContain("pixel-frame");
    expect(row.className).toContain("min-h-14");
    expect(row.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(el.querySelectorAll("button, form, input")).toHaveLength(0);
    expect(el.textContent).not.toContain("Add to the list");
  });

  it("makes each of the same rows a check-off button once someone is picked", () => {
    const el = document.createElement("div");
    el.innerHTML = renderToStaticMarkup(
      <ShoppingList items={items} canEdit kiosk actions={actions} />,
    );
    const buttons = el.querySelectorAll(
      '[data-testid="shopping-items"] > li button',
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.getAttribute("aria-label")).toBe("Check off milk");
    expect(buttons[0]!.className).toContain("pixel-frame");
    expect(buttons[0]!.className).toContain("min-h-14");
    expect(el.textContent).toContain("Add to the list");
  });

  it("says when the list is empty, and still offers to add", () => {
    const out = renderToStaticMarkup(
      <ShoppingList items={[]} canEdit actions={actions} />,
    );
    expect(out).toContain("The list is empty.");
    expect(out).toContain("Add to the list");
  });
});
