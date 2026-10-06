// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Dialog } from "../dialog";

// jsdom has <dialog> but not showModal/close, so they are stubbed to flip
// `open` the way a browser does.
beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Dialog", () => {
  it("opens as a modal, closes, and reports the close", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <Dialog open onClose={onClose} title="Deactivate?">
          <p>Sure?</p>
        </Dialog>,
      );
    });
    const dialog = container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-label")).toBe("Deactivate?");
    expect(dialog.textContent).toContain("Sure?");

    await act(async () => {
      root.render(
        <Dialog open={false} onClose={onClose} title="Deactivate?">
          <p>Sure?</p>
        </Dialog>,
      );
    });
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});

describe("Dialog's ways out (issue #174)", () => {
  async function mount() {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onClose = vi.fn();
    await act(async () => {
      root.render(
        <Dialog open onClose={onClose} title="Log Bins">
          <input aria-label="Note" />
        </Dialog>,
      );
    });
    const dialog = container.querySelector("dialog")!;
    const panel = container.querySelector<HTMLElement>(
      '[data-testid="dialog-panel"]',
    )!;
    const input = container.querySelector("input")!;
    expect(dialog.open).toBe(true);
    expect(panel).not.toBeNull();
    return { root, dialog, panel, input, onClose };
  }

  /** A press on `down` and a release on `up`: the click lands on `up`. */
  async function tap(down: Element, up: Element = down) {
    await act(async () => {
      down.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      up.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  it("closes on a tap on the dimmed backdrop", async () => {
    const { root, dialog, onClose } = await mount();
    await tap(dialog);
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("stays open on a tap on the panel, its padding, heading or a control", async () => {
    const { root, dialog, panel, input, onClose } = await mount();
    await tap(panel);
    await tap(panel.parentElement!);
    await tap(dialog.querySelector("h2")!);
    await tap(input);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("stays open after a drag from inside the panel to the backdrop", async () => {
    const { root, dialog, input, onClose } = await mount();
    await tap(input, dialog);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    // A real tap outside afterwards still closes it.
    await tap(dialog);
    expect(dialog.open).toBe(false);
    await act(async () => root.unmount());
  });

  it("closes from its 56px Close button, which comes after the content", async () => {
    const { root, dialog, input, onClose } = await mount();
    const close = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    )!;
    expect(close).not.toBeNull();
    expect(close.type).toBe("button");
    expect(close.className).toContain("size-14");
    // Last in the DOM, so the browser focuses the panel's own control first.
    expect(
      input.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await act(async () => close.click());
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
