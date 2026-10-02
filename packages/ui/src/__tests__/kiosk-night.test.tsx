// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KioskShell } from "../kiosk-shell";
import { KioskNotice } from "../kiosk-night";
import { SCREENSAVER_ART, Screensaver } from "../screensaver";

// The kiosk's always-on pieces (SPEC §8, issue #29; ADR 0005 §6): the
// screensaver wakes on a touch anywhere, the notice is a polite live region, and the shell
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

describe("Screensaver", () => {
  it("covers the screen with the night room, the clock and a sleeping Baumy", () => {
    const out = renderToStaticMarkup(
      <Screensaver time="23:41" date="Sunday 27 September" onWake={() => {}} />,
    );
    expect(out).toContain("fixed inset-0");
    expect(out).toContain('data-state="sleeping"');
    // Two floating z's, as in the prototype; not the cat's own mark too.
    expect(out.match(/>z<\/span>/g)).toHaveLength(2);
    expect(out).not.toContain("data-mark");
    expect(out).toContain("23:41");
    expect(out).toContain("Sunday 27 September · all quiet");
    expect(out).toContain("TAP ANYWHERE TO WAKE");
    expect(out).toContain('type="button"');
    // The three raccoons: into the bin, off with a sock, pushing a box.
    for (const r of ["bin", "sock", "box"]) {
      expect(out).toContain(`data-raccoon="${r}"`);
    }
    expect(out.match(/data-light/g)).toHaveLength(16);
    expect(out).toContain("@keyframes bm-ss-run");
  });

  it("moves every pixel: the room drifts, the clock hops, the light washes", () => {
    const div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
    act(() =>
      root!.render(<Screensaver time="02:10" date="d" onWake={() => {}} />),
    );
    const screen = div.querySelector("button")!;
    const drift = screen.querySelector<HTMLElement>("[data-drift]")!;
    expect(drift.style.animation).toContain("bm-ss-drift-x");
    expect(drift.querySelector<HTMLElement>("span")!.style.animation).toContain(
      "bm-ss-drift-y",
    );
    // Everything drawn is inside the drift; beside it are only the scene's
    // styles and the washes.
    expect(
      drift.querySelector('[data-testid="screensaver-time"]'),
    ).not.toBeNull();
    expect(drift.querySelectorAll("[data-raccoon]")).toHaveLength(3);
    const outside = [...screen.children].filter((el) => el !== drift);
    expect(outside.length).toBeGreaterThan(0);
    for (const el of outside) {
      expect(el.matches("style, [data-wash]"), el.outerHTML).toBe(true);
    }
    const washes = screen.querySelectorAll<HTMLElement>("[data-wash]");
    expect(washes).toHaveLength(2);
    for (const wash of washes) {
      expect(wash.className).toContain("inset-0");
      expect(
        wash.querySelector<HTMLElement>("span")!.style.animation,
      ).toContain("bm-ss-wash");
    }
    expect(
      drift.querySelector<HTMLElement>("[data-clock]")!.style.animation,
    ).toContain("bm-ss-clock");
    // The floor reaches past the edges, so the drift never shows a gap.
    expect(screen.innerHTML).toContain("-inset-x-8");
  });

  it("draws the floor clutter from its own grids", () => {
    for (const grid of Object.values(SCREENSAVER_ART)) {
      const width = grid[0]!.length;
      expect(grid.every((row) => row.length === width)).toBe(true);
    }
  });

  it("wakes on a tap, and only on the tap's click", () => {
    const onWake = vi.fn();
    const div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
    act(() =>
      root!.render(<Screensaver time="01:00" date="d" onWake={onWake} />),
    );
    const screen = div.querySelector("button")!;
    expect(screen.getAttribute("aria-label")).toBe(
      "Screensaver, 01:00. Tap anywhere to wake the screen.",
    );
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
