// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AvatarButton, KioskShell, KioskTopBar } from "../kiosk-shell";
import { PIN_MAX_LENGTH, PinPad } from "../pin-pad";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}

const hidden = (c: HTMLElement) =>
  c.querySelector<HTMLInputElement>('input[type="hidden"][name="pin"]')!;
const button = (c: HTMLElement, name: string) =>
  [...c.querySelectorAll("button")].find(
    (b) => b.textContent === name || b.getAttribute("aria-label") === name,
  )!;
const click = (el: HTMLElement) => act(async () => el.click());
const key = (k: string) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k }));
  });

describe("PinPad", () => {
  it("collects digits into the hidden field and submits from 4 digits", async () => {
    const c = await mount(<PinPad label="Ryan's PIN" submitLabel="Confirm" />);
    const submit = button(c, "Confirm");
    expect(submit.type).toBe("submit");
    expect(submit.disabled).toBe(true);
    for (const d of ["1", "2", "3"]) await click(button(c, d));
    expect(hidden(c).value).toBe("123");
    expect(submit.disabled).toBe(true);
    await click(button(c, "4"));
    expect(submit.disabled).toBe(false);
    expect(
      c.querySelector('[data-testid="pin-dots"]')!.getAttribute("aria-label"),
    ).toBe("4 of 6 digits entered");
  });

  it("stops at 6 digits, deletes and clears", async () => {
    const c = await mount(<PinPad label="PIN" />);
    for (let i = 0; i < PIN_MAX_LENGTH + 2; i++) await click(button(c, "7"));
    expect(hidden(c).value).toBe("777777");
    await click(button(c, "Delete last digit"));
    expect(hidden(c).value).toBe("77777");
    await click(button(c, "0"));
    expect(hidden(c).value).toBe("777770");
    await click(button(c, "Clear"));
    expect(hidden(c).value).toBe("");
    expect(button(c, "Clear").disabled).toBe(true);
  });

  it("takes the physical keyboard too, but not while pending", async () => {
    const c = await mount(<PinPad label="PIN" />);
    await key("5");
    await key("x");
    await key("6");
    await key("Backspace");
    expect(hidden(c).value).toBe("5");
    await act(async () => root!.render(<PinPad label="PIN" pending />));
    await key("9");
    expect(hidden(c).value).toBe("5");
    expect(button(c, "Checking...").disabled).toBe(true);
    expect(button(c, "1").disabled).toBe(true);
  });

  it("offers Cancel only with onCancel, and every key is a 56px+ target", async () => {
    const onCancel = vi.fn();
    const c = await mount(<PinPad label="PIN" onCancel={onCancel} />);
    await click(button(c, "Cancel"));
    expect(onCancel).toHaveBeenCalledOnce();
    for (const b of c.querySelectorAll("button")) {
      expect(b.className).toMatch(/min-h-1[46]/);
    }
    const plain = renderToStaticMarkup(<PinPad label="PIN" />);
    expect(plain).not.toContain("Cancel");
    expect(plain).toContain('aria-label="PIN"');
  });
});

describe("KioskShell and AvatarButton", () => {
  it("frames the kiosk without page scrolling, footer and Baumy on top", () => {
    const out = renderToStaticMarkup(
      <KioskShell footer={<nav>Footer</nav>} corner={<span>Cat</span>}>
        body
      </KioskShell>,
    );
    expect(out).toContain("overflow-hidden");
    expect(out).toContain("touch-manipulation");
    expect(out).toContain("h-dvh");
    // The content keeps the footer's 84px clear; Baumy sits over its end.
    expect(out).toContain("pb-[84px]");
    expect(out).toContain("<nav>Footer</nav>");
    expect(out).toMatch(/absolute right-3\.5 bottom-1 z-30"><span>Cat/);
    const bare = renderToStaticMarkup(<KioskShell>x</KioskShell>);
    expect(bare).toContain('data-skin="day"');
    expect(bare).not.toContain("z-30");
  });

  it("puts the avatar bar and its status over the other pages", () => {
    const out = renderToStaticMarkup(
      <KioskTopBar
        avatars={<AvatarButton displayName="Ryan" color="#123456" />}
        status={<span>Acting as Ryan</span>}
      />,
    );
    expect(out).toContain('aria-label="Who is here"');
    expect(out).toContain("Acting as Ryan");
    expect(renderToStaticMarkup(<KioskTopBar avatars={null} />)).not.toContain(
      "gap-3",
    );
  });

  it("marks the acting member as pressed, with a 64px target", () => {
    const on = renderToStaticMarkup(
      <AvatarButton displayName="Ryan" color="#123456" selected />,
    );
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain('type="button"');
    expect(on).toContain("min-h-16");
    expect(on).toContain("Ryan");
    const off = renderToStaticMarkup(
      <AvatarButton displayName="Kim" color="#654321" type="submit" />,
    );
    expect(off).toContain('aria-pressed="false"');
    expect(off).toContain('type="submit"');
  });
});
