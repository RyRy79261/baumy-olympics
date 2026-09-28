// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NavMenu } from "../nav-menu";

// The hub header's folded menu (issue #64): opens on its button, and closes
// on Escape, on a press outside, and when the path (closeKey) changes.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const menu = (closeKey: string) => (
  <NavMenu label="Admin" closeKey={closeKey} data-testid="admin-menu">
    <a href="/admin/members">Members</a>
  </NavMenu>
);
const button = () => container.querySelector("button")!;
const links = () => container.querySelectorAll("a");

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(menu("/")));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function open() {
  act(() => button().click());
  expect(button().getAttribute("aria-expanded")).toBe("true");
  expect(links()).toHaveLength(1);
}

describe("NavMenu", () => {
  it("is closed until its button is pressed, then shows its links", () => {
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(links()).toHaveLength(0);
    open();
    expect(container.querySelector("[data-menu]")).not.toBeNull();
    act(() => button().click());
    expect(links()).toHaveLength(0);
  });

  it("closes on Escape and gives focus back to its button", () => {
    open();
    act(() => links()[0]!.focus());
    expect(document.activeElement).toBe(links()[0]);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(links()).toHaveLength(0);
    expect(document.activeElement).toBe(button());
  });

  it("closes when focus leaves it, not when it moves inside", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    open();
    act(() => links()[0]!.focus());
    act(() => button().focus());
    expect(links()).toHaveLength(1);
    act(() => outside.focus());
    expect(links()).toHaveLength(0);
    outside.remove();
  });

  it("closes on a press outside, not inside", () => {
    open();
    act(() => {
      links()[0]!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(links()).toHaveLength(1);
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(links()).toHaveLength(0);
  });

  it("closes when the path changes (a link was followed)", () => {
    open();
    act(() => root.render(menu("/admin/members")));
    expect(links()).toHaveLength(0);
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });
});
