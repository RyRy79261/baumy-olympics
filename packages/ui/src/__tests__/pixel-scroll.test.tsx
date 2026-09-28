// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KioskModal } from "../kiosk-modal";
import { PixelScroll, seekTo, thumbFor } from "../pixel-scroll";

// The day sheet's pixel scrollbar and the dashboard's module sheet (ADR
// 0005, issue #65).

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
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

describe("thumbFor and seekTo", () => {
  it("hides the thumb when everything fits", () => {
    expect(thumbFor({ top: 0, view: 500, full: 500, track: 500 })).toEqual({
      scrollable: false,
      height: 0,
      top: 0,
      atTop: true,
      atEnd: true,
    });
  });

  it("sizes the thumb to the view, on the 4px grid, at least 64px", () => {
    const top = thumbFor({ top: 0, view: 400, full: 1000, track: 412 });
    expect(top).toMatchObject({ scrollable: true, height: 160, top: 0 });
    expect(top.atTop).toBe(true);
    expect(top.atEnd).toBe(false);
    const end = thumbFor({ top: 600, view: 400, full: 1000, track: 412 });
    expect(end).toMatchObject({ top: 240, atTop: false, atEnd: true });
    expect(
      thumbFor({ top: 0, view: 100, full: 10_000, track: 412 }).height,
    ).toBe(64);
  });

  it("turns a tap on the track into a scroll offset, clamped", () => {
    const m = { top: 0, view: 400, full: 1000, track: 412 };
    expect(seekTo(0, m, 160)).toBe(0);
    expect(seekTo(412, m, 160)).toBe(600);
    expect(seekTo(6 + 80 + 120, m, 160)).toBe(300);
  });
});

describe("PixelScroll", () => {
  it("draws the thumb and More below when the list is longer than its view", async () => {
    const sizes = { clientHeight: 400, scrollHeight: 1000 };
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-scroll-list")
          ? sizes.clientHeight
          : this.hasAttribute("data-track")
            ? 412
            : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.hasAttribute("data-scroll-list") ? sizes.scrollHeight : 0;
      },
    );
    const out = await mount(
      <PixelScroll tone="#1e1432">
        <p>rows</p>
      </PixelScroll>,
    );
    const list = out.querySelector<HTMLElement>("[data-scroll-list]")!;
    expect(out.textContent).toContain("rows");
    const thumb = out.querySelector<HTMLElement>("[data-thumb]")!;
    expect(thumb.style.height).toBe("160px");
    expect(out.querySelector("[data-more]")?.textContent).toContain(
      "More below",
    );

    // More below pages down by three quarters of the view.
    list.scrollBy = vi.fn();
    await act(async () =>
      out.querySelector<HTMLButtonElement>("[data-more]")!.click(),
    );
    expect(list.scrollBy).toHaveBeenCalledWith({
      top: 300,
      behavior: "smooth",
    });

    // Scrolled to the end: no More below, a fade at the top instead.
    list.scrollTop = 600;
    await act(async () => list.dispatchEvent(new Event("scroll")));
    expect(out.querySelector("[data-more]")).toBeNull();
    expect(thumb.style.top).toBe(`${6 + 240}px`);

    // A tap on the track jumps there.
    const track = out.querySelector<HTMLElement>("[data-track]")!;
    track.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    await act(async () =>
      track.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientY: 100 }),
      ),
    );
    expect(list.scrollTop).toBe(0);
    vi.restoreAllMocks();
  });

  it("hides the track when everything fits", async () => {
    const out = await mount(
      <PixelScroll>
        <p>one</p>
      </PixelScroll>,
    );
    expect(out.querySelector("[data-thumb]")).toBeNull();
    expect(out.querySelector("[data-more]")).toBeNull();
    expect(out.querySelector<HTMLElement>("[data-track]")!.style.opacity).toBe(
      "0",
    );
  });
});

describe("KioskModal", () => {
  it("opens as a modal, and a tap on the dimmed margin closes it", async () => {
    const onClose = vi.fn();
    const out = await mount(
      <KioskModal open onClose={onClose} labelledBy="t">
        <h2 id="t">Urgent</h2>
      </KioskModal>,
    );
    const dialog = out.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe("t");
    expect(dialog.textContent).toContain("Urgent");
    // A tap inside the panel does not close it.
    await act(async () => out.querySelector("h2")!.click());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => dialog.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    // Closed from outside (a reminder coming up closes every open dialog):
    // it reports the close, so the page's state follows and it stays shut.
    await act(async () => dialog.close());
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () =>
      root!.render(
        <KioskModal open={false} onClose={onClose} labelledBy="t">
          <h2 id="t">Urgent</h2>
        </KioskModal>,
      ),
    );
    expect(dialog.open).toBe(false);
    expect(dialog.textContent).toBe("");
  });
});
