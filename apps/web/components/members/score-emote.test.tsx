import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announceScore, onScore, SCORED_EVENT } from "@/lib/ui/scored";
import { ScoreEmote } from "./score-emote";

// The "+N" moment (issue #111): whatever shows the score pop announces it,
// and the acting character plays its emote once per score.

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const img = (src: string) => ({ src, width: 20, height: 64 });
const SET = {
  idle: img("/idle.png"),
  emote: img("/emote.png"),
  walk: img("/walk.png"),
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("announceScore and onScore", () => {
  it("tells every listener about a positive score only, until unsubscribed", () => {
    const heard = vi.fn();
    const off = onScore(heard);
    announceScore(10);
    announceScore(0);
    expect(heard).toHaveBeenCalledTimes(1);
    expect((heard.mock.calls[0]![0] as CustomEvent).type).toBe(SCORED_EVENT);
    off();
    announceScore(5);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("ScoreEmote", () => {
  it("walks in first, then emotes once for each score", () => {
    act(() =>
      root.render(<ScoreEmote sprites={SET} moment="walk-in" scale={2} />),
    );
    const moment = () =>
      container
        .querySelector("[data-member-sprite]")
        ?.getAttribute("data-moment");
    expect(moment()).toBe("walk-in");
    const first = container.querySelector("[data-member-sprite]");
    act(() => announceScore(30));
    expect(moment()).toBe("emote");
    // A new element each time, so the animation plays again.
    const second = container.querySelector("[data-member-sprite]");
    expect(second).not.toBe(first);
    act(() => announceScore(5));
    expect(container.querySelector("[data-member-sprite]")).not.toBe(second);
  });
});
