"use client";

import type { ActionResult } from "@/lib/actions/result";
import type { Proposal } from "@/lib/ai/proposal";
import type { HistoryTurn } from "@/lib/ai/command";
import type { CommandData } from "@/lib/ai/routes";

// The sheet's three requests (lib/ai/routes.ts). Each answers an
// ActionResult; a network failure or a non-JSON answer becomes one too, so
// the sheet has one shape to show.
//
// Each request gives up after a while (issue #132 follow-up): a request
// that stalls (the iPad's Wi-Fi dropping mid-request) must not leave the
// kitchen cat "thinking" for ever, holding the kiosk's busy flag, which
// keeps the idle reset and the screensaver waiting. The limits sit just
// above the server's own deadlines, so an answer the server would still give
// is never cut off. A save that timed out is safe to retry: its proposal id
// is its idempotency key.

export type Device = "ui" | "kiosk";

/** The command loop's 50-second deadline (COMMAND_DEADLINE_MS), plus room. */
export const COMMAND_TIMEOUT_MS = 55_000;
/** Groq's 30-second limit (TRANSCRIBE_TIMEOUT_MS), plus room. */
export const TRANSCRIBE_CLIENT_TIMEOUT_MS = 35_000;
/** Checking a proposal and running one: a database write, no AI. */
export const ACTION_TIMEOUT_MS = 30_000;

const OFFLINE = {
  ok: false as const,
  code: "UNAVAILABLE" as const,
  message: "Baumy can't be reached. Check the connection and try again.",
};

const TIMED_OUT = {
  ok: false as const,
  code: "UNAVAILABLE" as const,
  message: "Baumy took too long to answer. Check the connection and try again.",
};

/** What a failed fetch means: it gave up waiting, or it never got there. */
function failed(err: unknown) {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  return name === "TimeoutError" || name === "AbortError" ? TIMED_OUT : OFFLINE;
}

async function send<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<ActionResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return (await res.json()) as ActionResult<T>;
  } catch (err) {
    return failed(err);
  }
}

function post<T>(
  url: string,
  body: unknown,
  timeoutMs: number,
): Promise<ActionResult<T>> {
  return send<T>(
    url,
    {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}

export function askBaumy(
  text: string,
  history: readonly HistoryTurn[],
  surface: Device,
): Promise<ActionResult<CommandData>> {
  return post(
    "/api/ai/command",
    { text, history, surface },
    COMMAND_TIMEOUT_MS,
  );
}

export function recheckProposal(
  name: string,
  input: Record<string, unknown>,
  surface: Device,
): Promise<ActionResult<Proposal>> {
  return post("/api/ai/proposal", { name, input, surface }, ACTION_TIMEOUT_MS);
}

export function runProposal(
  proposal: Proposal,
  surface: Device,
  pin?: string,
): Promise<ActionResult<unknown>> {
  return post(
    "/api/actions/run",
    {
      name: proposal.name,
      input: proposal.input,
      requestId: proposal.proposalId,
      surface,
      ...(pin ? { pin } : {}),
    },
    ACTION_TIMEOUT_MS,
  );
}

/** A clip's file name, so the route and Groq see its container. */
function clipName(mime: string): string {
  return mime.startsWith("audio/mp4") ? "clip.mp4" : "clip.webm";
}

/** Send a held-to-speak clip to be transcribed (lib/ai/transcribe.ts). */
export function transcribeClip(
  clip: Blob,
  mime: string,
  surface: Device,
): Promise<ActionResult<{ text: string }>> {
  const form = new FormData();
  form.append("audio", new File([clip], clipName(mime), { type: mime }));
  form.append("surface", surface);
  return send(
    "/api/ai/transcribe",
    { body: form },
    TRANSCRIBE_CLIENT_TIMEOUT_MS,
  );
}
