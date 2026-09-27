"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LevelMeter, MicButton, type MicState } from "@baumy/ui";
import {
  MAX_RECORDING_MS,
  MIN_CLIP_MS,
  levelOf,
  micFailure,
  onRelease,
  pickMimeType,
} from "@/lib/ai/voice";

// Hold to speak (SPEC §3.6, issue #22), ported from intake-tracker
// `apps/web/src/components/voice/voice-recorder.tsx`: MediaRecorder writing
// webm/opus, or mp4 on Safari (iPad), and a level meter from an analyser.
//
// - Hold the button, speak, let go: the clip goes to `onClip`.
// - A short tap (or Enter/Space, or a hold the permission prompt cut short)
//   keeps it recording until the button is tapped again.
// - A clip is cut at a minute; one too short to hold words is dropped.
// - A blocked or missing microphone calls `onUnavailable`, and the sheet
//   hides this and falls back to typing.

export function VoiceRecorder({
  kiosk = false,
  sending = false,
  disabled = false,
  onStart,
  onClip,
  onCancel,
  onUnavailable,
}: {
  kiosk?: boolean;
  /** The last clip is still being transcribed or answered. */
  sending?: boolean;
  disabled?: boolean;
  onStart: () => void;
  onClip: (clip: Blob, mime: string) => void;
  /** Recording stopped with nothing to send; `message` says why. */
  onCancel: (message: string | null) => void;
  onUnavailable: (message: string) => void;
}) {
  const [state, setState] = useState<"idle" | "starting" | "recording">("idle");
  const [tapMode, setTapMode] = useState(false);
  const [level, setLevel] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const cutoff = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressedAt = useRef(0);
  const startedAt = useRef(0);
  const releasedEarly = useRef(false);
  const tap = useRef(false);
  const mounted = useRef(true);
  // The sheet's latest callbacks: the recorder's onstop fires long after the
  // render that started it, and must not send with that render's history.
  const latest = useRef({ onStart, onClip, onCancel, onUnavailable });
  useEffect(() => {
    latest.current = { onStart, onClip, onCancel, onUnavailable };
  });

  /** Stop the microphone, the meter and the timers; keep the recorder. */
  const release = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (cutoff.current !== null) clearTimeout(cutoff.current);
    cutoff.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (audioCtx.current && audioCtx.current.state !== "closed") {
      audioCtx.current.close().catch(() => undefined);
    }
    audioCtx.current = null;
    setLevel(0);
  }, []);

  // Unmounting (the sheet closed) drops a recording without sending it.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const rec = recorder.current;
      if (rec) {
        rec.ondataavailable = null;
        rec.onstop = null;
        if (rec.state !== "inactive") rec.stop();
      }
      recorder.current = null;
      release();
    };
  }, [release]);

  const finish = useCallback(() => {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    rec.stop();
    release();
  }, [release]);

  const begin = useCallback(async () => {
    if (state !== "idle" || recorder.current) return;
    const mime = pickMimeType(
      typeof MediaRecorder === "undefined"
        ? undefined
        : (t) => MediaRecorder.isTypeSupported(t),
    );
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      latest.current.onUnavailable(
        "This browser can't record here, so type to Baumy instead.",
      );
      return;
    }
    releasedEarly.current = false;
    setState("starting");
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      if (!mounted.current) return;
      setState("idle");
      const f = micFailure(err);
      if (f.kind === "unavailable") latest.current.onUnavailable(f.message);
      else latest.current.onCancel(f.message);
      return;
    }
    // The sheet closed while the permission prompt was up: turn the
    // microphone straight back off, and record nothing.
    if (!mounted.current) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    stream.current = media;

    // The level meter. Without Web Audio the clip still records.
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      audioCtx.current = ctx;
      void ctx.resume().catch(() => undefined);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(media).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        setLevel(levelOf(buf));
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    } catch {
      audioCtx.current = null;
    }

    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(media, { mimeType: mime });
    } catch (err) {
      release();
      setState("idle");
      latest.current.onCancel(micFailure(err).message);
      return;
    }
    recorder.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      recorder.current = null;
      setState("idle");
      setTapMode(false);
      const clip = new Blob(chunks, { type: mime });
      if (Date.now() - startedAt.current < MIN_CLIP_MS || clip.size === 0) {
        latest.current.onCancel("Hold the button while you speak.");
        return;
      }
      latest.current.onClip(clip, mime);
    };
    rec.start();
    startedAt.current = Date.now();
    cutoff.current = setTimeout(finish, MAX_RECORDING_MS);
    // Let go while the permission prompt was up: keep going until a tap.
    tap.current = tap.current || releasedEarly.current;
    setTapMode(tap.current);
    setState("recording");
    latest.current.onStart();
  }, [state, finish, release]);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || disabled) return;
    e.preventDefault();
    if (state === "recording") {
      // The second tap of a tap-to-talk.
      if (tap.current) finish();
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pressedAt.current = Date.now();
    tap.current = false;
    void begin();
  }

  function onPointerUp() {
    if (state === "starting") {
      releasedEarly.current = true;
      return;
    }
    if (state !== "recording" || tap.current) return;
    if (onRelease(Date.now() - pressedAt.current) === "keep") {
      tap.current = true;
      setTapMode(true);
      return;
    }
    finish();
  }

  // Enter, Space or a screen reader's activation: a click with no pointer.
  function onClick(e: React.MouseEvent<HTMLButtonElement>) {
    if (e.detail !== 0 || disabled) return;
    if (state === "recording") {
      finish();
    } else if (state === "idle") {
      tap.current = true;
      void begin();
    }
  }

  const micState: MicState = sending ? "sending" : state;
  return (
    <div className="flex flex-col gap-2" data-testid="voice-recorder">
      <MicButton
        state={micState}
        kiosk={kiosk}
        disabled={disabled}
        label={state === "recording" && tapMode ? "Tap to send" : undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      {state === "recording" ? <LevelMeter level={level} /> : null}
    </div>
  );
}
