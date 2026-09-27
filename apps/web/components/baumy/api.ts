"use client";

import type { ActionResult } from "@/lib/actions/result";
import type { Proposal } from "@/lib/ai/proposal";
import type { HistoryTurn } from "@/lib/ai/command";
import type { CommandData } from "@/lib/ai/routes";

// The sheet's three requests (lib/ai/routes.ts). Each answers an
// ActionResult; a network failure or a non-JSON answer becomes one too, so
// the sheet has one shape to show.

export type Device = "ui" | "kiosk";

const OFFLINE = {
  ok: false as const,
  code: "UNAVAILABLE" as const,
  message: "Baumy can't be reached. Check the connection and try again.",
};

async function post<T>(url: string, body: unknown): Promise<ActionResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    return (await res.json()) as ActionResult<T>;
  } catch {
    return OFFLINE;
  }
}

export function askBaumy(
  text: string,
  history: readonly HistoryTurn[],
  surface: Device,
): Promise<ActionResult<CommandData>> {
  return post("/api/ai/command", { text, history, surface });
}

export function recheckProposal(
  name: string,
  input: Record<string, unknown>,
  surface: Device,
): Promise<ActionResult<Proposal>> {
  return post("/api/ai/proposal", { name, input, surface });
}

export function runProposal(
  proposal: Proposal,
  surface: Device,
  pin?: string,
): Promise<ActionResult<unknown>> {
  return post("/api/actions/run", {
    name: proposal.name,
    input: proposal.input,
    requestId: proposal.proposalId,
    surface,
    ...(pin ? { pin } : {}),
  });
}

/** A clip's file name, so the route and Groq see its container. */
function clipName(mime: string): string {
  return mime.startsWith("audio/mp4") ? "clip.mp4" : "clip.webm";
}

/** Send a held-to-speak clip to be transcribed (lib/ai/transcribe.ts). */
export async function transcribeClip(
  clip: Blob,
  mime: string,
  surface: Device,
): Promise<ActionResult<{ text: string }>> {
  const form = new FormData();
  form.append("audio", new File([clip], clipName(mime), { type: mime }));
  form.append("surface", surface);
  try {
    const res = await fetch("/api/ai/transcribe", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    return (await res.json()) as ActionResult<{ text: string }>;
  } catch {
    return OFFLINE;
  }
}
