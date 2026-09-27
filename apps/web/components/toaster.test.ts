import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, toast, TOAST_DURATION_MS } from "@/lib/ui/toast";
import { Toaster } from "./toaster";

// The bare Toaster renders the store and removes a toast on its own timer or
// when dismissed.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  dismissToast();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("renders nothing without toasts, then each toast with its role", () => {
    act(() => root.render(createElement(Toaster)));
    expect(container.innerHTML).toBe("");
    act(() => {
      toast.error("That PIN is not right.");
      toast.success("Saved.");
    });
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute("role")).toBe("alert");
    expect(items[0]?.textContent).toContain("That PIN is not right.");
    expect(items[1]?.getAttribute("role")).toBe("status");
  });

  it("removes a toast when dismissed and after its duration", () => {
    act(() => root.render(createElement(Toaster)));
    act(() => {
      toast.info("First");
    });
    act(() => container.querySelector("button")?.click());
    expect(container.querySelectorAll("li")).toHaveLength(0);

    act(() => {
      toast.info("Second");
    });
    expect(container.querySelectorAll("li")).toHaveLength(1);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });
});
