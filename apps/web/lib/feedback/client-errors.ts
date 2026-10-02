import { DIAGNOSTICS_LIMITS as L, type ReportDiagnostics } from "@baumy/types";

// The recent-errors buffer a bug report can attach (issue #133). Ported from
// camp-404 `apps/web/lib/client-errors.ts`, plus a listener so the reporter
// can offer "Report this bug" when something breaks.
//
// A buffer, not a log: entries live in memory, die with the tab, and leave
// the device only when the member ticks "Attach device details and recent
// errors" and sends. On the way to the public issue they are redacted again.
// The caps are hard because an error message can quote what was on screen.
// Browser-only: on the server every function is a no-op.

export type ClientError = ReportDiagnostics["errors"][number];

/** Where an error came from. Only an uncaught one is offered for a report. */
export type ErrorSource = "window.error" | "unhandledrejection" | "console.error";

const buffer: ClientError[] = [];
const listeners = new Set<(error: ClientError) => void>();
let installed = false;

function clamp(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Keep one error, and tell the listeners. */
export function recordClientError(source: ErrorSource, value: unknown): void {
  if (typeof window === "undefined") return;
  const entry: ClientError = {
    at: new Date().toISOString(),
    source: clamp(source, L.source),
    message: clamp(describe(value), L.message),
    // The path only, never the query or hash: those can carry codes.
    route: clamp(window.location.pathname, L.route),
  };
  buffer.push(entry);
  // Drop the oldest: the errors just before someone reaches for the
  // reporter are the ones that matter.
  while (buffer.length > L.errors) buffer.shift();
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // A listener must never turn one error into two.
    }
  }
}

/** Hear every error as it is kept. Returns the unsubscribe. */
export function onClientError(
  listener: (error: ClientError) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Start capturing uncaught errors, rejected promises and console.error (React
 * reports render failures only there). Idempotent; a no-op on the server.
 * Returns a teardown.
 */
export function installClientErrorCapture(): () => void {
  if (typeof window === "undefined" || installed) return () => {};
  installed = true;

  const onError = (event: ErrorEvent) =>
    recordClientError("window.error", event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) =>
    recordClientError("unhandledrejection", event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    // Pass through first and always: the console shows what it would have.
    originalConsoleError.apply(console, args as never[]);
    try {
      recordClientError("console.error", args.map(describe).join(" "));
    } catch {
      // Capturing an error must never throw one.
    }
  };

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    console.error = originalConsoleError;
    installed = false;
  };
}

/** Empty the buffer and the listeners (tests). */
export function clearClientErrors(): void {
  buffer.length = 0;
  listeners.clear();
}

/**
 * What a report would attach right now: facts about the device (never the
 * person: no member id, name or email) and the recent errors, oldest first.
 */
export function collectDiagnostics(): ReportDiagnostics {
  const environment: ReportDiagnostics["environment"] = [];
  if (typeof navigator !== "undefined") {
    environment.push({ label: "Browser", value: navigator.userAgent });
    environment.push({ label: "Language", value: navigator.language });
    environment.push({
      label: "Online",
      value: navigator.onLine ? "yes" : "no",
    });
  }
  if (typeof window !== "undefined") {
    environment.push({
      label: "Screen",
      value: `${window.innerWidth}×${window.innerHeight} @ ${window.devicePixelRatio}x`,
    });
    environment.push({ label: "Page", value: window.location.pathname });
  }
  return {
    environment: environment.slice(0, L.environmentFields).map((f) => ({
      label: clamp(f.label, L.label),
      value: clamp(f.value, L.value),
    })),
    errors: buffer.map((e) => ({ ...e })),
  };
}
