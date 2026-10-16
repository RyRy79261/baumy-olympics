"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  createConversation,
  type Conversation,
  type ConversationState,
} from "@/lib/ai/conversation";
import type { MoodEvent } from "@/lib/ai/mood";
import {
  askBaumy,
  recheckProposal,
  runProposal,
  transcribeClip,
  type Device,
} from "./api";

/**
 * The conversation (lib/ai/conversation.ts) the sheet and the cat's bubble
 * show, with its port on this surface's requests (./api.ts). One per
 * mounted sheet; the latest surface and callbacks are always used.
 */
export function useConversation(opts: {
  surface: Device;
  feel: (e: MoodEvent) => void;
  onSaved: (points: number | null) => void;
}): [ConversationState, Conversation] {
  const latest = useRef(opts);
  latest.current = opts;
  const [conversation] = useState(() =>
    createConversation({
      port: {
        ask: (text, history) => askBaumy(text, history, latest.current.surface),
        transcribe: (clip, mime) =>
          transcribeClip(clip, mime, latest.current.surface),
        recheck: (name, input) =>
          recheckProposal(name, input, latest.current.surface),
        run: (proposal, pin) =>
          runProposal(proposal, latest.current.surface, pin),
      },
      feel: (e) => latest.current.feel(e),
      onSaved: (points) => latest.current.onSaved(points),
    }),
  );
  const state = useSyncExternalStore(
    conversation.subscribe,
    conversation.getState,
    conversation.getState,
  );
  return [state, conversation];
}
