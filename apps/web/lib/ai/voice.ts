// The browser side of speaking to Baumy (SPEC §3.6, issue #22), pure and
// client-safe so components/baumy/voice-recorder.tsx stays a thin view.
// After intake-tracker `apps/web/src/components/voice/voice-recorder.tsx`.

/**
 * What MediaRecorder should write, first supported wins: webm/opus on
 * Chrome, Edge and Firefox; mp4/AAC on Safari (iPad, iPhone), which has no
 * webm recorder. All of these pass the transcribe route's allow-list.
 */
export const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/ogg;codecs=opus",
] as const;

/** A clip is cut off here, well under the route's 20 MB. */
export const MAX_RECORDING_MS = 60_000;

/** A press shorter than this is a tap: recording goes on until a second tap. */
export const HOLD_MS = 350;

/** A clip shorter than this has no words in it, so it is not sent. */
export const MIN_CLIP_MS = 250;

export function pickMimeType(
  isTypeSupported: ((type: string) => boolean) | undefined,
): string | null {
  if (!isTypeSupported) return null;
  for (const t of PREFERRED_MIME_TYPES) {
    try {
      if (isTypeSupported(t)) return t;
    } catch {
      // Some browsers throw for a type they do not know.
    }
  }
  return null;
}

/** Whether this browser can record at all; false during server rendering. */
export function canRecord(
  win: {
    MediaRecorder?: { isTypeSupported?: (type: string) => boolean };
    navigator?: { mediaDevices?: { getUserMedia?: unknown } };
  } | null,
): boolean {
  if (!win?.MediaRecorder || !win.navigator?.mediaDevices?.getUserMedia) {
    return false;
  }
  return pickMimeType(win.MediaRecorder.isTypeSupported) !== null;
}

/**
 * The type a finished clip is sent as: what the recorder says it wrote
 * (Safari on iPad says `audio/mp4`), else the type we asked it for. After
 * camp-404 `apps/web/components/voice/use-voice-recorder.ts`, which labels
 * the clip `mimeType ?? rec.mimeType`.
 */
export function clipType(asked: string, written: string | undefined): string {
  const w = written?.trim();
  return w ? w : asked;
}

// ------------------------------------------------- the microphone's machine
//
// Hold to talk on the kitchen iPad (issue #132) splits opening the
// microphone from recording. A tap on the cat (a click, which iOS Safari
// counts as a user gesture) opens it, and the bubble shows "Hold to talk";
// the hold then only starts a recorder on the stream already open, so no
// permission prompt sits between the finger and the recording. The sheet's
// button (voice-recorder.tsx) presses without opening first: the press
// opens the microphone, and the clip closes it again.
//
// Pure, so every path is tested (voice.test.ts); use-recorder.ts runs the
// effects each step returns.

export type MicPhase =
  /** The microphone is off. */
  | "off"
  /** Asking for the microphone, nobody holding (the cat's tap). */
  | "opening"
  /** Held before the microphone answered: record once it does. */
  | "pressing"
  /** Open, waiting for a hold. */
  | "ready"
  | "recording";

export interface MicMachine {
  phase: MicPhase;
  /**
   * Opened by a tap (the cat): the microphone stays open between clips,
   * until the bubble closes. Otherwise a clip turns it off (the sheet).
   */
  keep: boolean;
}

export type MicEvent =
  | { type: "open" }
  | { type: "press" }
  | { type: "granted" }
  | { type: "refused" }
  | { type: "release" }
  | { type: "close" };

export type MicEffect =
  /** Ask for the microphone (getUserMedia). */
  | "request"
  /** Start a recorder on the open stream. */
  | "record"
  /** Stop the recorder: its clip is sent. */
  | "stop"
  /** Throw away any recording and turn the microphone off. */
  | "shut";

export const MIC_OFF: MicMachine = { phase: "off", keep: false };

export function micStep(
  m: MicMachine,
  e: MicEvent,
): { next: MicMachine; effects: MicEffect[] } {
  const to = (phase: MicPhase, effects: MicEffect[] = [], keep = m.keep) => ({
    next: { phase, keep },
    effects,
  });
  const same = { next: m, effects: [] as MicEffect[] };
  if (e.type === "close") {
    return m.phase === "off" ? same : to("off", ["shut"], false);
  }
  switch (m.phase) {
    case "off":
      if (e.type === "open") return to("opening", ["request"], true);
      if (e.type === "press") return to("pressing", ["request"], false);
      return same;
    case "opening":
      if (e.type === "press") return to("pressing");
      if (e.type === "granted") return to("ready");
      if (e.type === "refused") return to("off", ["shut"], false);
      return same;
    case "pressing":
      if (e.type === "granted") return to("recording", ["record"]);
      if (e.type === "refused") return to("off", ["shut"], false);
      // Let go before the microphone answered: the cat waits for the next
      // hold; the sheet's button records on (it turns into tap-to-send).
      if (e.type === "release" && m.keep) return to("opening");
      return same;
    case "ready":
      if (e.type === "press") return to("recording", ["record"]);
      return same;
    case "recording":
      if (e.type === "release") {
        return m.keep ? to("ready", ["stop"]) : to("off", ["stop", "shut"]);
      }
      return same;
  }
}

export type MicFailure =
  /** Blocked or missing: hide the microphone and type instead. */
  | { kind: "unavailable"; message: string }
  /** Something passing: say so, and let them try again. */
  | { kind: "retry"; message: string };

/** What a failed `getUserMedia` or recorder means for the member. */
export function micFailure(err: unknown): MicFailure {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return {
      kind: "unavailable",
      message:
        "The microphone is blocked, so type to Baumy instead. You can allow it in the browser's settings.",
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return {
      kind: "unavailable",
      message: "There's no microphone here, so type to Baumy instead.",
    };
  }
  return {
    kind: "retry",
    message: "The microphone didn't start. Try again, or type instead.",
  };
}

/**
 * How loud a frame of time-domain samples is, 0 to 1: the root mean square
 * around the 128 midpoint, scaled so ordinary speech fills most of the bar.
 */
export function levelOf(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = ((samples[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 4);
}

/** What letting go of the button does, `heldMs` after pressing it. */
export function onRelease(heldMs: number): "send" | "keep" {
  return heldMs < HOLD_MS ? "keep" : "send";
}
