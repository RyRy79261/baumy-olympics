import { describe, expect, it } from "vitest";
import { BAUMY_STATES, type SpriteState } from "@baumy/ui";
import { SETTLE_MS, nextMood, type MoodEvent } from "./mood";

// Baumy's state machine (SPEC §3.6): every state, every event.

const run = (from: SpriteState, ...events: MoodEvent[]) =>
  events.reduce(nextMood, from);

describe("nextMood", () => {
  it("speaking: listening while held, thinking once let go, talking with the answer", () => {
    expect(
      run(
        "idle",
        { type: "record_start" },
        { type: "record_stop" },
        { type: "ask" },
        { type: "reply" },
        { type: "settle" },
      ),
    ).toBe("idle");
    expect(run("idle", { type: "record_start" })).toBe("listening");
    expect(run("idle", { type: "record_start" }, { type: "record_stop" })).toBe(
      "thinking",
    );
    expect(run("thinking", { type: "reply" })).toBe("talking");
  });

  it("typing: thinking, then talking", () => {
    expect(run("idle", { type: "ask" })).toBe("thinking");
    expect(run("sad", { type: "ask" }, { type: "reply" })).toBe("talking");
  });

  it("a cancelled recording goes back to idle", () => {
    expect(run("listening", { type: "record_cancel" })).toBe("idle");
    expect(run("talking", { type: "record_cancel" })).toBe("talking");
    expect(run("idle", { type: "record_stop" })).toBe("idle");
  });

  it("an error is sad, a save with points is happy, and both settle", () => {
    expect(run("thinking", { type: "error" })).toBe("sad");
    expect(run("talking", { type: "points", points: 25 })).toBe("happy");
    expect(run("talking", { type: "points", points: 0 })).toBe("talking");
    expect(run("talking", { type: "points", points: null })).toBe("talking");
    expect(run("happy", { type: "settle" })).toBe("idle");
    expect(run("sad", { type: "settle" })).toBe("idle");
  });

  it("ignores a late answer or error while the member is speaking again", () => {
    expect(run("listening", { type: "reply" })).toBe("listening");
    expect(run("listening", { type: "error" })).toBe("listening");
  });

  it("settles only the passing states", () => {
    for (const s of BAUMY_STATES) {
      const settled = nextMood(s, { type: "settle" });
      if (SETTLE_MS[s] !== undefined) expect(settled).toBe("idle");
      else expect(settled).toBe(s);
    }
    expect(Object.keys(SETTLE_MS).sort()).toEqual(["happy", "sad", "talking"]);
  });

  it("sleeps at night unless busy, and wakes on wake or a press", () => {
    expect(run("idle", { type: "sleep" })).toBe("sleeping");
    expect(run("happy", { type: "sleep" })).toBe("sleeping");
    expect(run("listening", { type: "sleep" })).toBe("listening");
    expect(run("thinking", { type: "sleep" })).toBe("thinking");
    expect(run("sleeping", { type: "wake" })).toBe("idle");
    expect(run("idle", { type: "wake" })).toBe("idle");
    expect(run("sleeping", { type: "record_start" })).toBe("listening");
    expect(run("sleeping", { type: "ask" })).toBe("thinking");
    expect(run("sleeping", { type: "settle" })).toBe("sleeping");
  });

  it("reaches all seven states", () => {
    const seen = new Set<SpriteState>(["idle"]);
    const events: MoodEvent[] = [
      { type: "record_start" },
      { type: "record_stop" },
      { type: "reply" },
      { type: "points", points: 5 },
      { type: "error" },
      { type: "settle" },
      { type: "sleep" },
    ];
    let s: SpriteState = "idle";
    for (const e of events) {
      s = nextMood(s, e);
      seen.add(s);
    }
    expect([...seen].sort()).toEqual([...BAUMY_STATES].sort());
  });
});
