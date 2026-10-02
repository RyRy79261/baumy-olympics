import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SpriteState } from "@baumy/ui";
import { usePublishToBar } from "@/components/baumy/bar-relay";

// Issue #152: below lg the hub home's Baumy is a button in the top bar. It
// shows the sheet's mood and opens that one sheet (at the end of the home)
// through the relay, and only the home has it.

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const { HubBaumy } = await import("./hub-baumy");

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let div: HTMLDivElement;
beforeEach(() => {
  pathname = "/";
  div = document.createElement("div");
  document.body.append(div);
  root = createRoot(div);
});
afterEach(() => {
  act(() => root?.unmount());
  div.remove();
});

/** Stands in for the sheet: publishes its mood and a wake that counts. */
let woken = 0;
let setMood: (m: SpriteState) => void = () => {};
function FakeSheet() {
  const [mood, set] = useState<SpriteState>("idle");
  setMood = set;
  usePublishToBar(true, mood, () => {
    woken += 1;
  });
  return null;
}

const button = () =>
  div.querySelector<HTMLButtonElement>('button[aria-label="Ask Baumy"]');

describe("HubBaumy", () => {
  it("is the bar's button below lg, and wakes the sheet when tapped", () => {
    woken = 0;
    act(() =>
      root!.render(
        <>
          <HubBaumy />
          <FakeSheet />
        </>,
      ),
    );
    expect(button()).not.toBeNull();
    expect(button()!.className).toContain("lg:hidden");
    expect(button()!.className).toContain("min-h-11");
    act(() => button()!.click());
    expect(woken).toBe(1);
  });

  it("shows the sheet's mood", () => {
    act(() =>
      root!.render(
        <>
          <HubBaumy />
          <FakeSheet />
        </>,
      ),
    );
    expect(div.querySelector('[data-state="idle"]')).not.toBeNull();
    act(() => setMood("listening"));
    expect(div.querySelector('[data-state="listening"]')).not.toBeNull();
  });

  it("does nothing before the sheet is there, and is idle on the server", () => {
    act(() => root!.render(<HubBaumy />));
    expect(button()).not.toBeNull();
    act(() => button()!.click());
    expect(renderToStaticMarkup(<HubBaumy />)).toContain('data-state="idle"');
  });

  it("shows nothing on the other hub pages", () => {
    expect(renderToStaticMarkup(<HubBaumy />)).toContain("Ask Baumy");
    pathname = "/chores";
    expect(renderToStaticMarkup(<HubBaumy />)).toBe("");
  });
});
