// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KioskShell } from "../kiosk-shell";
import { KioskNotice } from "../kiosk-night";
import { RACCOON_POSES } from "../raccoon";
import { PARKED, SCREENSAVER_ART, Screensaver } from "../screensaver";

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
    // The four raccoons (issue #191), each in its own approved pose.
    for (const [r, pose] of [
      ["sit", "sit"],
      ["reach", "reach"],
      ["jar", "carry"],
      ["box", "walk"],
    ]) {
      // The pose drawn before the next raccoon starts is this one's.
      const own = out.split(`data-raccoon="${r}"`)[1]!.split("data-raccoon")[0];
      expect(own).toContain(`data-pose="${pose}"`);
    }
    expect(out.match(/data-raccoon=/g)).toHaveLength(4);
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
    expect(drift.querySelectorAll("[data-raccoon]")).toHaveLength(4);
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

  it("stands the raccoons on whole pixels, feet on the floor, lanes apart", () => {
    const div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
    act(() =>
      root!.render(<Screensaver time="02:10" date="d" onWake={() => {}} />),
    );
    const at = (r: string) =>
      div.querySelector<HTMLElement>(`[data-raccoon="${r}"]`)!;
    // No layer at a fractional offset: px positions only, never vw or %.
    const floor = at("sit").parentElement!;
    for (const el of floor.querySelectorAll<HTMLElement>(":scope > span"))
      expect(el.className, el.className).not.toMatch(/calc\(|vw|left-\[\d+%/);
    // Feet on the floor line: the sitter's last art row is drawn, the
    // reacher's is clear, so it stands one art pixel (4px) lower.
    expect(RACCOON_POSES.sit[0]!.at(-1)).toMatch(/[^.]/);
    expect(RACCOON_POSES.reach[0]!.at(-1)).toMatch(/^\.+$/);
    expect(at("sit").className).toContain("-top-[120px]"); // 30 rows × 4
    expect(at("reach").className).toContain("-top-[140px]"); // 35 rows × 4
    // The reacher's hop is one whole art pixel.
    expect(at("reach").style.animation).toContain("bm-ss-hop");
    expect(div.innerHTML).toContain("translateY(-4px)");
    // At least 32px of floor between the carrier's lowest drawn row and the
    // walker's highest (its ears), worked out from the art and the lanes.
    const top = (r: string) => {
      const c = at(r).className;
      return c.includes(" top-0 ") ? 0 : Number(/ top-\[(\d+)px\]/.exec(c)![1]);
    };
    const drawn = (grid: readonly string[]) =>
      grid.map((row, y) => (/[^.]/.test(row) ? y : -1)).filter((y) => y >= 0);
    const feet =
      top("jar") + (Math.max(...drawn(RACCOON_POSES.carry[0]!)) + 1) * 4;
    const ears = top("box") + Math.min(...drawn(RACCOON_POSES.walk[0]!)) * 4;
    expect(ears - feet).toBeGreaterThanOrEqual(32);
  });

  it("parks the walkers apart and wholly on screen when motion is reduced", () => {
    const div = document.createElement("div");
    document.body.append(div);
    root = createRoot(div);
    act(() =>
      root!.render(<Screensaver time="02:10" date="d" onWake={() => {}} />),
    );
    // Under reduced motion the animation ends at once and lets go, so the
    // span's own transform is where it stands.
    const jar = div.querySelector<HTMLElement>('[data-raccoon="jar"]')!;
    const box = div.querySelector<HTMLElement>('[data-raccoon="box"]')!;
    expect(jar.style.transform).toBe(`translateX(${PARKED.jar}px)`);
    expect(box.style.transform).toBe(`translateX(${PARKED.box}px)`);
    expect(jar.style.animation).toContain("bm-ss-run-back");
    expect(box.style.animation).toContain("bm-ss-run");
    // On an 820px screen, with the floor's left edge 32px off screen: the
    // carrier is 42 × 4 wide, the walker and its box 42 × 4 + 12 × 6 − 16.
    const span = (x: number, w: number) => [x - 32, x - 32 + w] as const;
    const [j0, j1] = span(PARKED.jar, 168);
    const [b0, b1] = span(PARKED.box, 224);
    for (const [a, z] of [
      [j0, j1],
      [b0, b1],
    ]) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(820);
    }
    expect(b1 <= j0 || j1 <= b0).toBe(true);
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
