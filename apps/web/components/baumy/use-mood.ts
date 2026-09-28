"use client";

import { useEffect, useReducer } from "react";
import type { SpriteState } from "@baumy/ui";
import { SETTLE_MS, nextMood, type MoodEvent } from "@/lib/ai/mood";
import { NIGHT_EVENT, type NightEventDetail } from "@/lib/kiosk/night";

/**
 * Baumy's state (lib/ai/mood.ts) for the sheet and its button: talking,
 * happy and sad settle back to idle after their time, and the kiosk's night
 * screensaver (components/kiosk/screensaver.tsx) sends `sleep` and `wake`.
 */
export function useBaumyMood(): [SpriteState, (e: MoodEvent) => void] {
  const [mood, dispatch] = useReducer(nextMood, "idle" as SpriteState);
  useEffect(() => {
    const ms = SETTLE_MS[mood];
    if (ms === undefined) return;
    const timer = setTimeout(() => dispatch({ type: "settle" }), ms);
    return () => clearTimeout(timer);
  }, [mood]);
  useEffect(() => {
    const onNight = (e: Event) => {
      const { asleep } = (e as CustomEvent<NightEventDetail>).detail;
      dispatch({ type: asleep ? "sleep" : "wake" });
    };
    window.addEventListener(NIGHT_EVENT, onNight);
    return () => window.removeEventListener(NIGHT_EVENT, onNight);
  }, []);
  return [mood, dispatch];
}
