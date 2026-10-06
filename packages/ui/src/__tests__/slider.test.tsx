// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Slider, stepStops, stopIndex, withStop } from "../slider";

// The pixel kit's slider (issue #179): stops by index, the value in words
// beside it and as aria-valuetext, keys that move one stop, ten, or to the
// ends, and "not set" until it is touched.

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

const STOPS = stepStops(0, 30, 2); // 0, 2, … 30: 16 stops
const pts = (n: number) => `${n} pts`;

/** A slider that holds its own value, and reports each change. */
async function mount(
  initial: number | null,
  props: { kiosk?: boolean; stops?: readonly number[] } = {},
) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <Slider
        aria-label="Points for Trash"
        stops={props.stops ?? STOPS}
        value={value}
        valueText={pts}
        kiosk={props.kiosk}
        onValueChange={(v) => {
          onChange(v);
          setValue(v);
        }}
      />
    );
  }
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => root!.render(<Harness />));
  const input = el.querySelector<HTMLInputElement>('input[type="range"]')!;
  const shown = () =>
    el.querySelector<HTMLElement>("[data-slider-value]")!.textContent;
  const key = (k: string) =>
    act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: k,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
  return { el, input, shown, key, onChange };
}

describe("stops", () => {
  it("steps from min to max, both included", () => {
    expect(stepStops(0, 6, 2)).toEqual([0, 2, 4, 6]);
    expect(stepStops(1, 1, 5)).toEqual([1]);
  });

  it("adds a value off the scale in its place, and leaves the rest alone", () => {
    const stops = [0, 5, 10];
    expect(withStop(stops, 7)).toEqual([0, 5, 7, 10]);
    expect(withStop(stops, 5)).toBe(stops);
    expect(withStop(stops, null)).toBe(stops);
  });

  it("finds the nearest stop, and the first for no value", () => {
    expect(stopIndex([0, 5, 10], 10)).toBe(2);
    expect(stopIndex([0, 5, 10], 6)).toBe(1);
    expect(stopIndex([0, 5, 10], null)).toBe(0);
  });
});

describe("Slider", () => {
  it("is a range over the stops' indexes, saying its value with the unit", async () => {
    const { input, shown } = await mount(10);
    expect(input.getAttribute("aria-label")).toBe("Points for Trash");
    expect(input.min).toBe("0");
    expect(input.max).toBe(String(STOPS.length - 1));
    expect(input.value).toBe("5");
    expect(input.getAttribute("aria-valuetext")).toBe("10 pts");
    expect(shown()).toBe("10 pts");
    expect(input.style.getPropertyValue("--fill")).toBe("33.33333333333333%");
    expect(input.className).toContain("min-h-11");
  });

  it("moves one stop with the arrows, ten with Page keys, to the ends with Home and End", async () => {
    const { input, shown, key, onChange } = await mount(10);
    await key("ArrowRight");
    expect(shown()).toBe("12 pts");
    await key("ArrowUp");
    expect(input.getAttribute("aria-valuetext")).toBe("14 pts");
    await key("ArrowLeft");
    await key("ArrowDown");
    expect(shown()).toBe("10 pts");
    await key("PageUp");
    expect(shown()).toBe("30 pts");
    await key("PageDown");
    expect(shown()).toBe("10 pts");
    await key("PageDown");
    expect(shown()).toBe("0 pts");
    await key("End");
    expect(shown()).toBe("30 pts");
    await key("Home");
    expect(shown()).toBe("0 pts");
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([
      12, 14, 12, 10, 30, 10, 0, 30, 0,
    ]);
  });

  it("stops at its min and max, and reports nothing when a key moves nothing", async () => {
    const { shown, key, onChange } = await mount(30);
    await key("ArrowRight");
    await key("End");
    await key("PageUp");
    expect(shown()).toBe("30 pts");
    await key("Home");
    await key("ArrowLeft");
    await key("PageDown");
    expect(shown()).toBe("0 pts");
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([0]);
  });

  it("leaves other keys to the browser", async () => {
    const { input, onChange } = await mount(10);
    const tab = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => input.dispatchEvent(tab));
    expect(tab.defaultPrevented).toBe(false);
    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => input.dispatchEvent(arrow));
    expect(arrow.defaultPrevented).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("follows a drag or a tap on the track", async () => {
    const { input, shown, onChange } = await mount(10);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "15");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(shown()).toBe("30 pts");
    expect(onChange).toHaveBeenLastCalledWith(30);
    // A tap that moves nothing (the thumb where it stands) changes nothing.
    await act(async () => input.click());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("says Not set until touched, and a tap where the thumb stands sets that stop", async () => {
    const { input, shown, onChange } = await mount(null);
    expect(shown()).toBe("Not set");
    expect(input.getAttribute("aria-valuetext")).toBe("Not set");
    expect(input.hasAttribute("data-unset")).toBe(true);
    expect(input.style.getPropertyValue("--fill")).toBe("0%");
    await act(async () => input.click());
    expect(onChange).toHaveBeenCalledWith(0);
    expect(shown()).toBe("0 pts");
    expect(input.hasAttribute("data-unset")).toBe(false);
  });

  it("while not set, Home sets the first stop", async () => {
    const { shown, key, onChange } = await mount(null);
    await key("Home");
    expect(onChange).toHaveBeenCalledWith(0);
    expect(shown()).toBe("0 pts");
  });

  it("on the kiosk, is a 56px touch target", async () => {
    const { input, shown } = await mount(4, { kiosk: true });
    expect(input.className).toContain("pixel-slider-kiosk");
    expect(input.className).toContain("min-h-14");
    expect(shown()).toBe("4 pts");
  });

  it("with a single stop, stands at it", async () => {
    const { input } = await mount(5, { stops: [5] });
    expect(input.max).toBe("0");
    expect(input.style.getPropertyValue("--fill")).toBe("0%");
  });
});
