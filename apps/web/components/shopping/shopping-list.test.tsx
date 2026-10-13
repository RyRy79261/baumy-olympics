import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/lib/actions/result";
import type {
  AddShoppingData,
  SetShoppingCategoryData,
} from "@/lib/actions/shopping";
import type { ShoppingEntry } from "@/lib/integrations/brain";
import { ShoppingList, type ShoppingActions } from "./shopping-list";

// The shopping list on the page, the hub and the kiosk (issue #26): big
// tap-to-check rows and the quick-add field for someone who may change it,
// and the same rows, only to read, for the kitchen screen before anyone taps
// in (issue #204). Issue #208: the rows under their groups' headings, the
// group buttons on each row and the quick-add's group buttons.

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ui/toast", () => ({
  toast: { success: toastSuccess, error: toastError },
  toastActionError: () => false,
}));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

let root: Root | null = null;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  toastSuccess.mockReset();
  toastError.mockReset();
});

function entry(
  id: string,
  item: string,
  category: ShoppingEntry["category"] = null,
): ShoppingEntry {
  return { id, item, addedAt: "2026-09-27T09:00:00.000Z", category };
}

const items = [entry("1", "milk"), entry("2", "eggs")];
const grouped = [
  entry("a", "bleach", "cleaning"),
  entry("b", "mystery"),
  entry("c", "beans", "coffee"),
  entry("d", "rice", "pantry"),
  entry("e", "filters", "coffee"),
];
const never = async (): Promise<never> => {
  throw new Error("not in a static render");
};
const actions: ShoppingActions = {
  add: never,
  checkOff: never,
  setCategory: never,
};

function html(markup: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = markup;
  return el;
}

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
    expect(out).not.toContain("shopping-group-button");
  });

  // Issue #204: the kitchen screen with nobody picked shows the picked
  // view's rows (the same framed, 56px rows with their box), with nothing
  // to tap and no quick-add.
  it("shows the kiosk's rows read-only, with no button, form or field", () => {
    const el = html(
      renderToStaticMarkup(
        <ShoppingList items={items} canEdit={false} kiosk actions={actions} />,
      ),
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
    const el = html(
      renderToStaticMarkup(
        <ShoppingList items={items} canEdit kiosk actions={actions} />,
      ),
    );
    const buttons = el.querySelectorAll(
      '[data-testid="shopping-items"] > li button[aria-label^="Check off"]',
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

describe("ShoppingList's groups (issue #208)", () => {
  const headings = (el: HTMLElement) =>
    [...el.querySelectorAll("section > h2, section > h3")].map((h) => [
      h.textContent,
      h.querySelector("svg")?.getAttribute("data-glyph") ?? null,
    ]);
  const itemsOf = (el: HTMLElement, key: string) =>
    [
      ...el.querySelectorAll(
        `[data-testid="shopping-group-${key}"] [data-testid^="shopping-item-"]`,
      ),
    ].map((li) =>
      li.getAttribute("data-testid")!.slice("shopping-item-".length),
    );

  it("puts the rows under their groups' headings, in order, Not sorted last, only groups with items", () => {
    const el = html(
      renderToStaticMarkup(
        <ShoppingList items={grouped} canEdit kiosk actions={actions} />,
      ),
    );
    expect(headings(el)).toEqual([
      ["Pantry", "catfood"],
      ["Coffee", "coffee"],
      ["Cleaning", "soap"],
      ["Not sorted", null],
    ]);
    expect(itemsOf(el, "pantry")).toEqual(["rice"]);
    expect(itemsOf(el, "coffee")).toEqual(["beans", "filters"]);
    expect(itemsOf(el, "none")).toEqual(["mystery"]);
    expect(el.querySelector('[data-testid="shopping-group-fresh"]')).toBeNull();
  });

  it("shows the groups read-only too, with nothing to tap", () => {
    const el = html(
      renderToStaticMarkup(
        <ShoppingList
          items={grouped}
          canEdit={false}
          kiosk
          actions={actions}
        />,
      ),
    );
    expect(headings(el).map(([label]) => label)).toEqual([
      "Pantry",
      "Coffee",
      "Cleaning",
      "Not sorted",
    ]);
    expect(itemsOf(el, "coffee")).toEqual(["beans", "filters"]);
    expect(el.querySelectorAll("button, form, input")).toHaveLength(0);
  });

  it("is a flat list with no headings while no item has a group", () => {
    const el = html(
      renderToStaticMarkup(
        <ShoppingList items={items} canEdit kiosk actions={actions} />,
      ),
    );
    expect(el.querySelectorAll("section, h2")).toHaveLength(0);
    // The group square is there anyway, to sort the first one: Not sorted's
    // neutral mark, no icon and no text.
    const square = el.querySelector(
      '[data-testid="shopping-item-milk"] [data-testid="shopping-group-button"]',
    )!;
    expect(square.getAttribute("aria-label")).toBe(
      "Group: Not sorted — change",
    );
    expect(
      square.querySelector('[data-testid="not-sorted-mark"]'),
    ).not.toBeNull();
    expect(square.querySelector("svg")).toBeNull();
    expect(square.textContent).toBe("");
  });

  it("gives each row a 56px square with its group's icon on the kiosk, and six icon chips to add into", () => {
    const el = html(
      renderToStaticMarkup(
        <ShoppingList items={grouped} canEdit kiosk actions={actions} />,
      ),
    );
    const groupButtons = [
      ...el.querySelectorAll('[data-testid="shopping-group-button"]'),
    ];
    expect(groupButtons).toHaveLength(grouped.length);
    // Each shows the item's current group: its icon, and its name to AT.
    const beans = el.querySelector(
      '[data-testid="shopping-item-beans"] [data-testid="shopping-group-button"]',
    )!;
    expect(beans.getAttribute("aria-label")).toBe("Group: Coffee — change");
    expect(beans.querySelector("svg")!.getAttribute("data-glyph")).toBe(
      "coffee",
    );
    expect(beans.textContent).toBe("");
    for (const b of groupButtons) expect(b.className).toContain("size-14");
    // Room after the last row, so Baumy in the corner never covers its button.
    expect(
      el.querySelector('[data-testid="shopping-end-room"]'),
    ).not.toBeNull();
    const phone = html(
      renderToStaticMarkup(
        <ShoppingList items={grouped} canEdit actions={actions} />,
      ),
    );
    expect(phone.querySelector('[data-testid="shopping-end-room"]')).toBeNull();
    const choices = el.querySelectorAll(
      '[data-testid="shopping-add-groups"] button',
    );
    expect([...choices].map((b) => b.getAttribute("aria-label"))).toEqual([
      "Pantry",
      "Fresh",
      "Coffee",
      "Cleaning",
      "Maintenance",
      "Household",
    ]);
    for (const b of choices) {
      expect(b.getAttribute("aria-pressed")).toBe("false");
      // Icon only, and a 56px square on the kiosk.
      expect(b.textContent).toBe("");
      expect(b.querySelector("svg")).not.toBeNull();
      expect(b.className).toContain("size-14");
    }
    // Owner 2026-10-13: a short caption over them, in the field label's
    // style, which also names the group of chips; on the phone too.
    const groupRow = el.querySelector('[data-testid="shopping-add-groups"]')!;
    const caption = el.querySelector(
      `#${groupRow.getAttribute("aria-labelledby")}`,
    )!;
    expect(caption.textContent).toBe("Group (optional)");
    expect(caption.className).toContain("font-label");
    expect(caption.className).toContain("uppercase");
    expect(
      caption.compareDocumentPosition(groupRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(phone.textContent).toContain("Group (optional)");
    expect(el.textContent).not.toContain("Add into a group");
    // On the phone: 44px squares in one row that wraps rather than cuts.
    const phoneChips = phone.querySelectorAll(
      '[data-testid="shopping-add-groups"] button',
    );
    expect(phoneChips).toHaveLength(6);
    for (const b of phoneChips) expect(b.className).toContain("size-11");
    expect(
      phone.querySelector('[data-testid="shopping-add-groups"]')!.className,
    ).toContain("flex-wrap");
  });

  it("makes the groups h3 under a widget's h2 title", () => {
    const el = html(
      renderToStaticMarkup(
        <ShoppingList
          items={grouped}
          canEdit
          headingLevel={3}
          actions={actions}
        />,
      ),
    );
    expect(
      [...el.querySelectorAll("section > h3")].map((h) => h.textContent),
    ).toEqual(["Pantry", "Coffee", "Cleaning", "Not sorted"]);
    expect(el.querySelectorAll("h2")).toHaveLength(0);
  });
});

describe("ShoppingList's group buttons (issue #208)", () => {
  type SetResult = ActionResult<SetShoppingCategoryData>;
  type AddResult = ActionResult<AddShoppingData>;

  async function mount(
    list: ShoppingEntry[],
    over: Partial<ShoppingActions> = {},
  ) {
    const el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
    await act(async () =>
      root!.render(
        <ShoppingList
          items={list}
          canEdit
          kiosk
          actions={{ ...actions, ...over }}
        />,
      ),
    );
    return el;
  }

  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll("button")].find((b) => b.textContent === text)!;
  const dialog = () => document.querySelector("dialog");
  const chip = (el: HTMLElement, name: string) =>
    el.querySelector<HTMLButtonElement>(
      `[data-testid="shopping-add-groups"] [aria-label="${name}"]`,
    )!;

  it("opens the groups for one item, sends the one tapped, and closes", async () => {
    const setCategory = vi.fn(async (): Promise<SetResult> => ({
      ok: true,
      data: { item: "beans", category: "pantry", items: [] },
    }));
    const el = await mount(grouped, { setCategory });
    expect(dialog()).toBeNull();
    await act(async () =>
      el
        .querySelector<HTMLButtonElement>(
          '[data-testid="shopping-item-beans"] [data-testid="shopping-group-button"]',
        )!
        .click(),
    );
    const open = dialog()!;
    expect(open.getAttribute("aria-label")).toBe("Group for beans");
    const choices = [...open.querySelectorAll("button[name=category]")];
    expect(
      choices.map((b) => [b.textContent, b.getAttribute("value")]),
    ).toEqual([
      ["Pantry", "pantry"],
      ["Fresh", "fresh"],
      ["CoffeeNow", "coffee"],
      ["Cleaning", "cleaning"],
      ["Maintenance", "maintenance"],
      ["Household", "household"],
      ["Not sorted", "none"],
    ]);
    // Where it is now is marked "Now" and outlined, not a green "go".
    const now = choices.filter(
      (b) => b.getAttribute("aria-current") === "true",
    );
    expect(now.map((b) => b.getAttribute("value"))).toEqual(["coffee"]);
    expect(now[0]!.querySelector('[data-testid="group-now"]')).not.toBeNull();
    expect(now[0]!.className).toContain("[--pf:var(--color-bm-green)]");
    for (const b of choices) {
      expect(b.className).toContain("min-h-14");
      // No choice is the green "go" fill.
      expect(b.className).not.toContain("bg-bm-green");
    }
    // "Not sorted" has no icon: the rows' neutral mark in an icon-sized box
    // keeps it in line.
    const notSorted = choices.at(-1)!;
    expect(notSorted.querySelector("svg")).toBeNull();
    const box = notSorted.querySelector('span[aria-hidden="true"]')!;
    expect(box.className).toContain("size-8");
    expect(box.querySelector('[data-testid="not-sorted-mark"]')).not.toBeNull();
    expect(choices[0]!.querySelector("svg")!.getAttribute("width")).toBe("32");
    await act(async () => button(open, "Pantry").click());
    expect(setCategory).toHaveBeenCalledTimes(1);
    const form = (setCategory.mock.calls[0] as unknown[])[1] as FormData;
    expect(form.get("id")).toBe("c");
    expect(form.get("item")).toBe("beans");
    expect(form.get("category")).toBe("pantry");
    expect(form.get("requestId")).toBeTruthy();
    expect(toastSuccess).toHaveBeenCalledWith("Put beans under Pantry.");
    expect(dialog()).toBeNull();
  });

  it("sends Not sorted as none, and keeps the groups open with the reason when it fails", async () => {
    const setCategory = vi.fn(async (): Promise<SetResult> => ({
      ok: false,
      code: "UNAVAILABLE",
      message: "The shopping list is unavailable right now.",
    }));
    const el = await mount(grouped, { setCategory });
    await act(async () =>
      el
        .querySelector<HTMLButtonElement>(
          '[data-testid="shopping-item-rice"] [data-testid="shopping-group-button"]',
        )!
        .click(),
    );
    await act(async () => button(dialog()!, "Not sorted").click());
    const form = (setCategory.mock.calls[0] as unknown[])[1] as FormData;
    expect(form.get("category")).toBe("none");
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain(
      "The shopping list is unavailable right now.",
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("says so and closes when the item is gone by the time a group is tapped", async () => {
    const setCategory = vi.fn(async (): Promise<SetResult> => ({
      ok: false,
      code: "NOT_FOUND",
      message: "That item is not on the shopping list any more.",
    }));
    const el = await mount(grouped, { setCategory });
    await act(async () =>
      el
        .querySelector<HTMLButtonElement>(
          '[data-testid="shopping-item-rice"] [data-testid="shopping-group-button"]',
        )!
        .click(),
    );
    await act(async () => button(dialog()!, "Fresh").click());
    expect(toastError).toHaveBeenCalledWith(
      "That item is not on the shopping list any more.",
    );
    expect(dialog()).toBeNull();
  });

  it("follows the list as it re-reads: a new group shows as Now, and a gone item closes it", async () => {
    const el = await mount(grouped);
    await act(async () =>
      el
        .querySelector<HTMLButtonElement>(
          '[data-testid="shopping-item-rice"] [data-testid="shopping-group-button"]',
        )!
        .click(),
    );
    const nowOf = () =>
      dialog()!.querySelector('[aria-current="true"]')!.getAttribute("value");
    expect(nowOf()).toBe("pantry");
    // Brain (or Telegram) moved it meanwhile; the page re-read the list.
    const moved = grouped.map((i) =>
      i.item === "rice" ? { ...i, category: "fresh" as const } : i,
    );
    await act(async () =>
      root!.render(
        <ShoppingList items={moved} canEdit kiosk actions={actions} />,
      ),
    );
    expect(dialog()!.getAttribute("aria-label")).toBe("Group for rice");
    expect(nowOf()).toBe("fresh");
    // Ticked off in Telegram: the next re-read has no rice, so it closes.
    await act(async () =>
      root!.render(
        <ShoppingList
          items={moved.filter((i) => i.item !== "rice")}
          canEdit
          kiosk
          actions={actions}
        />,
      ),
    );
    expect(dialog()).toBeNull();
    // And it does not come back on the next render.
    await act(async () =>
      root!.render(
        <ShoppingList items={moved} canEdit kiosk actions={actions} />,
      ),
    );
    expect(dialog()).toBeNull();
  });

  it("adds into the group picked, then forgets the pick", async () => {
    const add = vi.fn(async (): Promise<AddResult> => ({
      ok: true,
      data: {
        added: ["beans"],
        already: [],
        items: [],
        category: "coffee",
        notSorted: [],
      },
    }));
    const el = await mount(items, { add });
    const coffee = chip(el, "Coffee");
    await act(async () => coffee.click());
    expect(coffee.getAttribute("aria-pressed")).toBe("true");
    // Its icon turns to ink on the green, so it never vanishes into it.
    expect(coffee.querySelector("svg path")!.getAttribute("fill")).toBe(
      "var(--color-bm-ink)",
    );
    expect(
      chip(el, "Fresh").querySelector("svg path")!.getAttribute("fill"),
    ).toBe("var(--color-bm-green)");
    expect(el.textContent).toContain("Add to Coffee");
    // A second group replaces the first; tapping it again picks none.
    await act(async () => chip(el, "Fresh").click());
    expect(coffee.getAttribute("aria-pressed")).toBe("false");
    await act(async () => chip(el, "Fresh").click());
    expect(
      el.querySelectorAll(
        '[data-testid="shopping-add-groups"] [aria-pressed="true"]',
      ),
    ).toHaveLength(0);
    await act(async () => coffee.click());

    const field = el.querySelector<HTMLInputElement>('input[name="items"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, "beans");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(el, "Add").click());
    expect(add).toHaveBeenCalledTimes(1);
    const form = (add.mock.calls[0] as unknown[])[1] as FormData;
    expect(form.get("items")).toBe("beans");
    expect(form.get("category")).toBe("coffee");
    expect(toastSuccess).toHaveBeenCalledWith("Added beans to Coffee.");
    expect(coffee.getAttribute("aria-pressed")).toBe("false");
    expect(el.textContent).toContain("Add to the list");
  });

  it("sends no group when none is picked", async () => {
    const add = vi.fn(async (): Promise<AddResult> => ({
      ok: true,
      data: { added: ["tea"], already: [], items: [] },
    }));
    const el = await mount(items, { add });
    const field = el.querySelector<HTMLInputElement>('input[name="items"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, "tea");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button(el, "Add").click());
    const form = (add.mock.calls[0] as unknown[])[1] as FormData;
    expect(form.get("items")).toBe("tea");
    expect(form.has("category")).toBe(false);
  });
});
