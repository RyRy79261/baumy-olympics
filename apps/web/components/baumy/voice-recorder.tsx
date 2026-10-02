"use client";

import { useEffect, useRef, useState } from "react";
import { LevelMeter, MicButton, type MicState } from "@baumy/ui";
import { onRelease } from "@/lib/ai/voice";
import { useRecorder } from "./use-recorder";

// Hold to speak (SPEC §3.6, issue #22), ported from intake-tracker
// `apps/web/src/components/voice/voice-recorder.tsx`. The recording itself
// is use-recorder.ts; this is the button:
//
// - Hold the button, speak, let go: the clip goes to `onClip`.
// - A short tap (or Enter/Space, or a hold the permission prompt cut short)
//   keeps it recording until the button is tapped again.
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
  const [tapMode, setTapMode] = useState(false);
  const pressedAt = useRef(0);
  const releasedEarly = useRef(false);
  const tap = useRef(false);
  const { state, level, begin, finish } = useRecorder({
    onStart,
    onClip,
    onCancel,
    onUnavailable,
    onRecording: () => {
      // Let go while the permission prompt was up: keep going until a tap.
      tap.current = tap.current || releasedEarly.current;
      setTapMode(tap.current);
    },
  });
  useEffect(() => {
    if (state === "idle") setTapMode(false);
  }, [state]);

  function start() {
    releasedEarly.current = false;
    begin();
  }

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
    start();
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
      start();
    }
  }

  // This button never opens the microphone ahead of a press, so it is
  // never "opening" or "ready"; those read as waiting and as idle.
  const micState: MicState = sending
    ? "sending"
    : state === "opening"
      ? "starting"
      : state === "ready"
        ? "idle"
        : state;
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
