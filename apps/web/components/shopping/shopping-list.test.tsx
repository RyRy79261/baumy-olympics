import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShoppingList } from "./shopping-list";

// The shopping list on the page, the hub and the kiosk (issue #26): big
// tap-to-check rows and the quick-add field for someone who may change it,
// a plain list for the kitchen screen before anyone taps in.

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

  it("says when the list is empty, and still offers to add", () => {
    const out = renderToStaticMarkup(
      <ShoppingList items={[]} canEdit actions={actions} />,
    );
    expect(out).toContain("The list is empty.");
    expect(out).toContain("Add to the list");
  });
});
