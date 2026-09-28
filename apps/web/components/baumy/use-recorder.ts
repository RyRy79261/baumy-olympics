"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_RECORDING_MS,
  MIN_CLIP_MS,
  levelOf,
  micFailure,
  pickMimeType,
} from "@/lib/ai/voice";

// Recording a clip for Baumy (SPEC §3.6, issue #22), shared by the sheet's
// hold-to-speak button (voice-recorder.tsx) and the kitchen dashboard's cat
// (ADR 0005 §1: "Mrrp? I'm listening…"). MediaRecorder writing webm/opus,
// or mp4 on Safari (iPad), and a level from an analyser. A clip is cut at a
// minute; one too short to hold words is dropped. A blocked or missing
// microphone calls `onUnavailable`, and the caller falls back to typing.
// Unmounting drops a recording without sending it.

export type RecorderState = "idle" | "starting" | "recording";

export interface RecorderCallbacks {
  onStart: () => void;
  onClip: (clip: Blob, mime: string) => void;
  /** Recording stopped with nothing to send; `message` says why. */
  onCancel: (message: string | null) => void;
  onUnavailable: (message: string) => void;
  /** Recording has begun (after any permission prompt). */
  onRecording?: () => void;
}

export function useRecorder(callbacks: RecorderCallbacks): {
  state: RecorderState;
  level: number;
  begin: () => Promise<void>;
  finish: () => void;
} {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const frame = useRef<number | null>(null);
  const cutoff = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const mounted = useRef(true);
  // The latest callbacks: the recorder's onstop fires long after the render
  // that started it, and must not send with that render's history.
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
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
    // Closed while the permission prompt was up: turn the microphone
    // straight back off, and record nothing.
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
    latest.current.onRecording?.();
    setState("recording");
    latest.current.onStart();
  }, [state, finish, release]);

  return { state, level, begin, finish };
}
