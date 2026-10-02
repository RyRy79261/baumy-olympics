import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SetPinNudge, pinNudgeKey } from "./set-pin-nudge";

// The PIN nudge (issues #145, #152): a one-line strip with a link to
// Settings and a × that hides it for that member on this device.

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let div: HTMLDivElement;

beforeEach(() => {
  window.localStorage.clear();
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
});

afterEach(() => {
  act(() => root?.unmount());
  div.remove();
});

const strip = () => div.querySelector('[data-testid="set-pin-nudge"]');

describe("SetPinNudge", () => {
  it("shows one line linking to the PIN in Settings", () => {
    act(() => root!.render(<SetPinNudge memberId="m1" />));
    expect(strip()).not.toBeNull();
    expect(strip()!.textContent).toContain(
      "Set your personal PIN for the kitchen iPad",
    );
    const link = strip()!.querySelector("a")!;
    expect(link.textContent).toBe("Set it");
    expect(link.getAttribute("href")).toBe("/settings#pin");
  });

  it("hides for that member on this device when its × is tapped", () => {
    act(() => root!.render(<SetPinNudge memberId="m1" />));
    expect(strip()).not.toBeNull();
    const close = div.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide the PIN reminder"]',
    )!;
    act(() => close.click());
    expect(strip()).toBeNull();
    expect(window.localStorage.getItem(pinNudgeKey("m1"))).toBe("1");
  });

  it("stays hidden for a member who hid it, and shows for another", () => {
    window.localStorage.setItem(pinNudgeKey("m1"), "1");
    act(() => root!.render(<SetPinNudge memberId="m2" />));
    expect(strip()).not.toBeNull();
    act(() => root!.render(<SetPinNudge memberId="m1" />));
    expect(strip()).toBeNull();
  });

  it("renders nothing on the server, which cannot read the device", () => {
    expect(renderToStaticMarkup(<SetPinNudge memberId="m9" />)).toBe("");
  });
});
