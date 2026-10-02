"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_RECORDING_MS,
  MIC_OFF,
  MIN_CLIP_MS,
  clipType,
  levelOf,
  micFailure,
  micStep,
  pickMimeType,
  type MicEvent,
  type MicMachine,
} from "@/lib/ai/voice";

// Recording a clip for Baumy (SPEC §3.6, issue #22), shared by the sheet's
// hold-to-speak button (voice-recorder.tsx) and the kitchen cat's "Hold to
// talk" (issue #132). MediaRecorder writing webm/opus, or mp4 on Safari
// (iPad), and a level from an analyser. A clip is cut at a minute; one too
// short to hold words is dropped. A blocked or missing microphone calls
// `onUnavailable`, and the caller falls back to typing. Unmounting drops a
// recording without sending it.
//
// The steps are lib/ai/voice.ts's `micStep`; this runs their effects. The
// cat calls `open()` from its tap, so the microphone (and the AudioContext
// behind the level meter, which iOS starts suspended outside a user
// gesture) are opened by a gesture, and the hold only starts a recorder.
// After camp-404 `apps/web/components/voice/use-voice-recorder.ts`: pick
// the type the browser supports, clear the handlers before stopping on
// unmount, and stop a stream that arrives after the caller has gone.

export type RecorderState =
  | "idle"
  /** The cat's tap is opening the microphone. */
  | "opening"
  /** Held, waiting for the microphone. */
  | "starting"
  /** Open, waiting for a hold. */
  | "ready"
  | "recording";

const STATE_OF: Record<MicMachine["phase"], RecorderState> = {
  off: "idle",
  opening: "opening",
  pressing: "starting",
  ready: "ready",
  recording: "recording",
};

export interface RecorderCallbacks {
  onStart: () => void;
  onClip: (clip: Blob, mime: string) => void;
  /** Recording stopped with nothing to send; `message` says why. */
  onCancel: (message: string | null) => void;
  onUnavailable: (message: string) => void;
  /** Recording has begun (after any permission prompt). */
  onRecording?: () => void;
}

export interface Recorder {
  state: RecorderState;
  level: number;
  /** Open the microphone and keep it open for holds (the cat's tap). */
  open: () => void;
  /** A hold begins: record (opening the microphone first if need be). */
  begin: () => void;
  /** The hold ends: the clip goes to `onClip`. */
  finish: () => void;
  /** Drop any recording and turn the microphone off. */
  close: () => void;
  /** Make the level meter's audio ready inside a user gesture. */
  warm: () => void;
}

const UNSUPPORTED = "This browser can't record here, so type to Baumy instead.";

/** Some level change worth a render: the meter has 5 bars. */
const LEVEL_STEP = 0.02;

/** This browser can record a type the transcribe route takes. */
function supported(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    pickMimeType((t) => MediaRecorder.isTypeSupported(t)) !== null
  );
}

export function useRecorder(callbacks: RecorderCallbacks): Recorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);

  const machine = useRef<MicMachine>(MIC_OFF);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const frame = useRef<number | null>(null);
  const cutoff = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const shown = useRef(0);
  const mounted = useRef(true);
  // Which request a granted stream answers: one that comes back after a
  // close (or a newer open) is turned straight off.
  const asked = useRef(0);
  // The latest callbacks: the recorder's onstop fires long after the render
  // that started it, and must not send with that render's history.
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });

  const showLevel = useCallback((l: number) => {
    if (Math.abs(l - shown.current) < LEVEL_STEP && l !== 0) return;
    shown.current = l;
    setLevel(l);
  }, []);

  const stopMeter = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    showLevel(0);
  }, [showLevel]);

  const startMeter = useCallback(() => {
    const node = analyser.current;
    if (!node || frame.current !== null) return;
    void audioCtx.current?.resume().catch(() => undefined);
    const buf = new Uint8Array(node.fftSize);
    const tick = () => {
      node.getByteTimeDomainData(buf);
      showLevel(levelOf(buf));
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }, [showLevel]);

  const warm = useCallback(() => {
    try {
      if (!audioCtx.current || audioCtx.current.state === "closed") {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctx) return;
        audioCtx.current = new Ctx();
      }
      void audioCtx.current.resume().catch(() => undefined);
    } catch {
      // Without Web Audio the clip still records; the meter stays still.
      audioCtx.current = null;
    }
  }, []);

  /** Throw away any recording; turn the microphone and the meter off. */
  const shut = useCallback(() => {
    asked.current += 1;
    const rec = recorder.current;
    if (rec) {
      rec.ondataavailable = null;
      rec.onstop = null;
      if (rec.state !== "inactive") rec.stop();
    }
    recorder.current = null;
    if (cutoff.current !== null) clearTimeout(cutoff.current);
    cutoff.current = null;
    stopMeter();
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    analyser.current = null;
    if (audioCtx.current && audioCtx.current.state !== "closed") {
      audioCtx.current.close().catch(() => undefined);
    }
    audioCtx.current = null;
  }, [stopMeter]);

  // `dispatch` and the effects call each other (a cut-off releases, a
  // refusal closes); the ref breaks the cycle.
  const dispatchRef = useRef<(e: MicEvent) => void>(() => undefined);

  const request = useCallback(() => {
    const mine = ++asked.current;
    // Inside the gesture, before any await: iOS only lets audio start here.
    warm();
    let pending: Promise<MediaStream>;
    try {
      pending = navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      pending = Promise.reject(err);
    }
    pending.then(
      (media) => {
        // Closed (or unmounted) while the permission prompt was up: turn
        // the microphone straight back off, and record nothing.
        if (!mounted.current || asked.current !== mine) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        stream.current = media;
        try {
          const ctx = audioCtx.current;
          if (ctx) {
            const node = ctx.createAnalyser();
            node.fftSize = 512;
            ctx.createMediaStreamSource(media).connect(node);
            analyser.current = node;
          }
        } catch {
          analyser.current = null;
        }
        dispatchRef.current({ type: "granted" });
      },
      (err: unknown) => {
        if (!mounted.current || asked.current !== mine) return;
        dispatchRef.current({ type: "refused" });
        const f = micFailure(err);
        if (f.kind === "unavailable") latest.current.onUnavailable(f.message);
        else latest.current.onCancel(f.message);
      },
    );
  }, [warm]);

  const record = useCallback(() => {
    const media = stream.current;
    const mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    let rec: MediaRecorder;
    try {
      if (!media) throw new Error("no stream");
      rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
    } catch (err) {
      dispatchRef.current({ type: "close" });
      latest.current.onCancel(micFailure(err).message);
      return;
    }
    const chunks: Blob[] = [];
    recorder.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const type = clipType(mime ?? "audio/mp4", rec.mimeType);
      const clip = new Blob(chunks, { type });
      if (Date.now() - startedAt.current < MIN_CLIP_MS || clip.size === 0) {
        latest.current.onCancel("Hold the button while you speak.");
        return;
      }
      latest.current.onClip(clip, type);
    };
    rec.start();
    startedAt.current = Date.now();
    cutoff.current = setTimeout(
      () => dispatchRef.current({ type: "release" }),
      MAX_RECORDING_MS,
    );
    startMeter();
    latest.current.onRecording?.();
    latest.current.onStart();
  }, [startMeter]);

  const stop = useCallback(() => {
    if (cutoff.current !== null) clearTimeout(cutoff.current);
    cutoff.current = null;
    stopMeter();
    // Let go of it first: its onstop (which sends the clip) fires later,
    // and a `shut` right after this must not take that clip away.
    const rec = recorder.current;
    recorder.current = null;
    if (rec && rec.state !== "inactive") rec.stop();
  }, [stopMeter]);

  const dispatch = useCallback(
    (e: MicEvent) => {
      const { next, effects } = micStep(machine.current, e);
      machine.current = next;
      if (mounted.current) setState(STATE_OF[next.phase]);
      for (const effect of effects) {
        if (effect === "request") request();
        else if (effect === "record") record();
        else if (effect === "stop") stop();
        else shut();
      }
    },
    [request, record, stop, shut],
  );
  dispatchRef.current = dispatch;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      machine.current = MIC_OFF;
      shut();
    };
  }, [shut]);

  const open = useCallback(() => {
    if (machine.current.phase !== "off") return;
    if (!supported()) {
      latest.current.onUnavailable(UNSUPPORTED);
      return;
    }
    dispatch({ type: "open" });
  }, [dispatch]);

  const begin = useCallback(() => {
    if (machine.current.phase === "off" && !supported()) {
      latest.current.onUnavailable(UNSUPPORTED);
      return;
    }
    // The finger is on the screen: wake the meter's audio while we may.
    if (audioCtx.current) void audioCtx.current.resume().catch(() => {});
    dispatch({ type: "press" });
  }, [dispatch]);

  const finish = useCallback(() => dispatch({ type: "release" }), [dispatch]);
  const close = useCallback(() => dispatch({ type: "close" }), [dispatch]);

  return { state, level, open, begin, finish, close, warm };
}
