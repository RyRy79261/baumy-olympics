// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Dialog } from "../dialog";
import { KioskModal } from "../kiosk-modal";

// jsdom has <dialog> but not showModal/close, so they are stubbed to flip
// `open` and fire `close` the way a browser does.
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

let root: Root | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

/** A press on `down` and a release on `up`: the click lands on `up`. */
async function tap(down: Element, up: Element = down) {
  await act(async () => {
    down.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    up.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** What a keystroke in a field fires. */
async function type(field: HTMLInputElement | HTMLTextAreaElement) {
  await act(async () => {
    field.value = "Bins are out";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const closeButton = (dialog: Element) =>
  dialog.querySelector<HTMLButtonElement>(
    ':scope > div > button[aria-label="Close"]',
  )!;

/** A Dialog whose caller keeps `open`, as every page does. */
function Controlled({
  onClose,
  busy,
  children,
}: {
  onClose: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" data-testid="reopen" onClick={() => setOpen(true)}>
        Open
      </button>
      <Dialog
        open={open}
        busy={busy}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Log Bins"
      >
        {children ?? (
          <>
            <input aria-label="Note" />
            <textarea aria-label="Body" />
            <input type="radio" name="who" aria-label="Ryan" />
          </>
        )}
      </Dialog>
    </>
  );
}

async function mount(props: { busy?: boolean } = {}) {
  const onClose = vi.fn();
  const container = await render(<Controlled onClose={onClose} {...props} />);
  const dialog = container.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  const panel = container.querySelector<HTMLElement>(
    '[data-testid="dialog-panel"]',
  )!;
  expect(panel).not.toBeNull();
  const reopen = async () =>
    act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="reopen"]')!
        .click(),
    );
  return { container, dialog, panel, onClose, reopen };
}

describe("Dialog", () => {
  it("opens as a modal and closes when its caller shuts it, without calling back", async () => {
    const onClose = vi.fn();
    await render(
      <Dialog open onClose={onClose} title="Deactivate?">
        <p>Sure?</p>
      </Dialog>,
    );
    const dialog = document.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-label")).toBe("Deactivate?");
    expect(dialog.textContent).toContain("Sure?");

    await act(async () =>
      root!.render(
        <Dialog open={false} onClose={onClose} title="Deactivate?">
          <p>Sure?</p>
        </Dialog>,
      ),
    );
    expect(dialog.open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Dialog's ways out (issue #174)", () => {
  it("closes on a tap on the dimmed backdrop, and says so once", async () => {
    const { dialog, onClose } = await mount();
    await tap(dialog);
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open on a tap on the panel, its header, heading or a control", async () => {
    const { dialog, panel, onClose } = await mount();
    await tap(panel);
    await tap(panel.parentElement!);
    await tap(dialog.querySelector('[data-testid="dialog-header"]')!);
    await tap(dialog.querySelector("h2")!);
    await tap(dialog.querySelector("input")!);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open after a drag from inside the panel to the backdrop", async () => {
    const { dialog, onClose } = await mount();
    await tap(dialog.querySelector("input")!, dialog);
    expect(dialog.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    // A real tap outside afterwards still closes it.
    await tap(dialog);
    expect(dialog.open).toBe(false);
  });

  it("closes from its 56px Close button, in a header the body never scrolls under", async () => {
    const { dialog, panel, onClose } = await mount();
    const close = closeButton(dialog);
    expect(close).not.toBeNull();
    expect(close.type).toBe("button");
    expect(close.className).toContain("size-14");
    // Not in the scrolling body, and the header leaves room for it.
    expect(panel.contains(close)).toBe(false);
    const header = dialog.querySelector('[data-testid="dialog-header"]')!;
    expect(header.className).toContain("min-h-20");
    expect(header.className).toContain("pr-20");
    // Last in the DOM, so the browser focuses the panel's own control first.
    expect(
      dialog.querySelector("input")!.compareDocumentPosition(close) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await act(async () => close.click());
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe("owner ruling 2026-10-06: typed text keeps it open", () => {
    it("ignores a tap outside once something was typed; the × still closes it", async () => {
      const { dialog, onClose } = await mount();
      await type(dialog.querySelector("input")!);
      await tap(dialog);
      expect(dialog.open).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => closeButton(dialog).click());
      expect(dialog.open).toBe(false);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("counts a textarea as typing too", async () => {
      const { dialog } = await mount();
      await type(dialog.querySelector("textarea")!);
      await tap(dialog);
      expect(dialog.open).toBe(true);
    });

    it("still closes on a tap outside after a choice that is not typing", async () => {
      const { dialog } = await mount();
      const radio = dialog.querySelector<HTMLInputElement>(
        'input[type="radio"]',
      )!;
      await act(async () => {
        radio.checked = true;
        radio.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await tap(dialog);
      expect(dialog.open).toBe(false);
    });

    it("forgets the typing when it opens again", async () => {
      const { dialog, reopen } = await mount();
      await type(dialog.querySelector("input")!);
      await act(async () => closeButton(dialog).click());
      expect(dialog.open).toBe(false);
      await reopen();
      expect(dialog.open).toBe(true);
      await tap(dialog);
      expect(dialog.open).toBe(false);
    });
  });

  describe("while busy (a request on its way)", () => {
    it("disables the ×, ignores a tap outside and refuses Escape", async () => {
      const { dialog, onClose } = await mount({ busy: true });
      expect(closeButton(dialog).disabled).toBe(true);
      await tap(dialog);
      expect(dialog.open).toBe(true);
      const escape = new Event("cancel", { cancelable: true });
      await act(async () => dialog.dispatchEvent(escape));
      expect(escape.defaultPrevented).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("comes straight back if the browser closes it anyway", async () => {
      const { dialog, onClose } = await mount({ busy: true });
      await act(async () => dialog.close());
      expect(dialog.open).toBe(true);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("lets Escape through when not busy", async () => {
      const { dialog } = await mount();
      const escape = new Event("cancel", { cancelable: true });
      await act(async () => dialog.dispatchEvent(escape));
      expect(escape.defaultPrevented).toBe(false);
    });
  });

  it("closing a dialog opened inside another leaves the outer one alone", async () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    await render(
      <Dialog open onClose={outerClose} title="Log Bins">
        <input aria-label="Note" />
        <Dialog open onClose={innerClose} title="Ryan's PIN">
          <input aria-label="PIN" />
        </Dialog>
      </Dialog>,
    );
    const [outer, inner] = [...document.querySelectorAll("dialog")];
    expect(outer!.open && inner!.open).toBe(true);
    await act(async () => closeButton(inner!).click());
    expect(inner!.open).toBe(false);
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outer!.open).toBe(true);
    expect(outerClose).not.toHaveBeenCalled();
    // Typing in the inner one does not count as typing in the outer one.
    await type(inner!.querySelector("input")!);
    await tap(outer!);
    expect(outerClose).toHaveBeenCalledTimes(1);
  });
});

describe("KioskModal", () => {
  function Sheet({ onClose }: { onClose: () => void }) {
    const [open, setOpen] = useState(true);
    const shut = () => {
      onClose();
      setOpen(false);
    };
    return (
      <KioskModal open={open} onClose={shut} labelledBy="h">
        <section>
          <h2 id="h">Urgent</h2>
          <button type="button" onClick={shut}>
            Close
          </button>
          <Dialog open onClose={() => {}} title="Inner">
            <p>Inner</p>
          </Dialog>
        </section>
      </KioskModal>
    );
  }

  it("closes once on a tap outside, and not after a drag from inside", async () => {
    const onClose = vi.fn();
    await render(<Sheet onClose={onClose} />);
    const modal = document.querySelector("dialog")!;
    expect(modal.open).toBe(true);
    await tap(modal.querySelector("h2")!, modal);
    expect(modal.open).toBe(true);
    await tap(modal);
    expect(modal.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose once when its panel's own Close shuts it", async () => {
    const onClose = vi.fn();
    await render(<Sheet onClose={onClose} />);
    const modal = document.querySelector("dialog")!;
    await act(async () =>
      [...modal.querySelectorAll("button")]
        .find((b) => b.textContent === "Close")!
        .click(),
    );
    expect(modal.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a dialog inside it closes", async () => {
    const onClose = vi.fn();
    await render(<Sheet onClose={onClose} />);
    const [modal, inner] = [...document.querySelectorAll("dialog")];
    await act(async () => closeButton(inner!).click());
    expect(inner!.open).toBe(false);
    expect(modal!.open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});
