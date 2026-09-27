import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SpriteState } from "@baumy/ui";
import { NIGHT_EVENT } from "@/lib/kiosk/night";
import { useBaumyMood } from "./use-mood";

// Baumy follows the kiosk's night screen (issue #29): it sleeps when the
// screen does and wakes with it.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

let mood: SpriteState = "idle";
function Probe() {
  [mood] = useBaumyMood();
  return null;
}

const night = (asleep: boolean) =>
  act(() => {
    window.dispatchEvent(new CustomEvent(NIGHT_EVENT, { detail: { asleep } }));
  });

describe("useBaumyMood and night mode", () => {
  it("sleeps and wakes with the night screen", () => {
    root = createRoot(document.createElement("div"));
    act(() => root!.render(<Probe />));
    expect(mood).toBe("idle");
    night(true);
    expect(mood).toBe("sleeping");
    night(false);
    expect(mood).toBe("idle");
  });

  it("stops listening when unmounted", () => {
    root = createRoot(document.createElement("div"));
    act(() => root!.render(<Probe />));
    act(() => root!.unmount());
    root = null;
    night(true);
    expect(mood).toBe("idle");
  });
});
