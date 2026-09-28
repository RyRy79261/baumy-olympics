// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KioskShell } from "../kiosk-shell";
import { KioskIndicator, KioskNotice, NightScreen } from "../kiosk-night";

// The kiosk's always-on pieces (SPEC §8, issue #29): the night screen wakes
// on a touch anywhere, the notice is a polite live region, and the shell
// carries its time-of-day skin for issue #7 to theme.

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

describe("NightScreen", () => {
  it("covers the screen with a sleeping Baumy and the clock", () => {
    const out = renderToStaticMarkup(
      <NightScreen time="23:41" date="Sunday 27 September" onWake={() => {}} />,
    );
    expect(out).toContain("fixed inset-0");
    expect(out).toContain('data-state="sleeping"');
    expect(out).toContain("23:41");
    expect(out).toContain("Sunday 27 September");
    expect(out).toContain("Touch to wake");
    expect(out).toContain('type="button"');
  });

  it("wakes on a tap, and only on the tap's click", () => {
    const onWake = vi.fn();
    const div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
    act(() =>
      root!.render(<NightScreen time="01:00" date="d" onWake={onWake} />),
    );
    const screen = div.querySelector("button")!;
    act(() => {
      screen.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onWake).not.toHaveBeenCalled();
    act(() => screen.click());
    expect(onWake).toHaveBeenCalledOnce();
  });
});

describe("KioskNotice", () => {
  it("is a polite status line that never catches a touch", () => {
    const out = renderToStaticMarkup(
      <KioskNotice data-testid="n">Back to the start in 5 s</KioskNotice>,
    );
    expect(out).toContain('role="status"');
    expect(out).toContain('data-testid="n"');
    expect(out).toContain("pointer-events-none");
    expect(out).toContain("Back to the start in 5 s");
  });
});

describe("KioskIndicator", () => {
  it("is a status tag pinned out of the way of the avatar bar", () => {
    const out = renderToStaticMarkup(
      <KioskIndicator data-testid="w">Screen may sleep</KioskIndicator>,
    );
    expect(out).toContain('role="status"');
    expect(out).toContain('data-testid="w"');
    expect(out).toContain("Screen may sleep");
    expect(out).toContain("fixed");
    expect(out).toContain("pointer-events-none");
    // In the gap over the footer nav (84px), never over its labels.
    expect(out).toContain("bottom-[100px]");
  });
});

describe("KioskShell skin", () => {
  it("is day unless told night", () => {
    expect(renderToStaticMarkup(<KioskShell>x</KioskShell>)).toContain(
      'data-skin="day"',
    );
    expect(
      renderToStaticMarkup(<KioskShell skin="night">x</KioskShell>),
    ).toContain('data-skin="night"');
  });
});
