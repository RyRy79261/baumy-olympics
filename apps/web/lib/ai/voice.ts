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
