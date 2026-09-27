import type { SpriteState } from "@baumy/ui";

// Baumy's state machine (SPEC §3.6, issue #22): what the sprite in the sheet
// and on the Baumy button shows. Pure and client-safe; the sheet feeds it
// events and `useBaumyMood` (components/baumy) settles the passing states
// back to idle after `SETTLE_MS`.
//
//   idle ──record_start──▶ listening ──record_stop──▶ thinking
//     ▲                      │record_cancel             │ask (typed)
//     │                      ▼                          ▼
//     └──────settle────── talking ◀──reply── thinking ──error──▶ sad
//   points (> 0) ──▶ happy        (talking, happy, sad settle to idle)
//   sleep ──▶ sleeping (night mode, issue #29) ──wake / any press──▶ …
//
// A reply or an error that arrives while Baumy is listening again (a new
// recording started) is stale and ignored, so a slow answer never cuts off
// the member speaking.

export type MoodEvent =
  /** The microphone opened and is recording. */
  | { type: "record_start" }
  /** The member let go: the clip is on its way to be transcribed. */
  | { type: "record_stop" }
  /** The recording ended with nothing to send (too short, denied). */
  | { type: "record_cancel" }
  /** A command was sent (typed, or the transcript). */
  | { type: "ask" }
  /** Baumy answered. */
  | { type: "reply" }
  /** Something failed: the transcript, the command, a save. */
  | { type: "error" }
  /** An approved proposal saved; `points` it scored (0 or null: none yet). */
  | { type: "points"; points: number | null }
  /** A passing state has been shown long enough. */
  | { type: "settle" }
  /** Night mode. */
  | { type: "sleep" }
  | { type: "wake" };

/** How long each passing state shows before it settles to idle. */
export const SETTLE_MS: Readonly<Partial<Record<SpriteState, number>>> = {
  talking: 4_000,
  happy: 3_000,
  sad: 4_000,
};

const BUSY: ReadonlySet<SpriteState> = new Set(["listening", "thinking"]);

export function nextMood(state: SpriteState, event: MoodEvent): SpriteState {
  switch (event.type) {
    case "record_start":
      return "listening";
    case "record_stop":
      return state === "listening" ? "thinking" : state;
    case "record_cancel":
      return state === "listening" ? "idle" : state;
    case "ask":
      return "thinking";
    case "reply":
      return state === "listening" ? state : "talking";
    case "error":
      return state === "listening" ? state : "sad";
    case "points":
      return event.points !== null && event.points > 0 ? "happy" : state;
    case "settle":
      return SETTLE_MS[state] !== undefined ? "idle" : state;
    case "sleep":
      return BUSY.has(state) ? state : "sleeping";
    case "wake":
      return state === "sleeping" ? "idle" : state;
  }
}
