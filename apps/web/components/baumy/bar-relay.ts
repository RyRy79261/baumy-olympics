"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { SpriteState } from "@baumy/ui";

// The hub's Baumy has two buttons and one sheet (issue #152). The sheet,
// with the corner button, sits at the end of the hub home, so on a wide
// screen (89rem, 1424px, up) the button is the last thing tabbed to, as it
// is drawn; below that the corner button is hidden and the top bar's
// (components/hub/hub-baumy.tsx) opens the same sheet. This relay hands the bar button the sheet's mood
// (lib/ai/mood.ts, never set by hand) and its way to wake it.

type Relay = { mood: SpriteState; wake: (() => void) | null };

const IDLE: Relay = { mood: "idle", wake: null };
let relay: Relay = IDLE;
const listeners = new Set<() => void>();

function publish(next: Relay) {
  relay = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The sheet's side: offer its mood and wake to the bar while mounted. */
export function usePublishToBar(
  enabled: boolean,
  mood: SpriteState,
  wake: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    publish({ mood, wake });
  }, [enabled, mood, wake]);
  useEffect(() => {
    if (!enabled) return;
    return () => publish(IDLE);
  }, [enabled]);
}

/** The bar button's side: the sheet's mood, and wake (null until mounted). */
export function useBarRelay(): Relay {
  return useSyncExternalStore(
    subscribe,
    () => relay,
    () => IDLE,
  );
}
