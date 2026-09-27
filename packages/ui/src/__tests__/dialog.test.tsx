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
