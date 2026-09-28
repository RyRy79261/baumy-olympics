import type { ActionResult } from "@/lib/actions/result";

// Toasts: a module-level store, read by the one mounted <Toaster/>
// (components/toaster.tsx). A one-tap action reports its outcome here; a form
// shows its errors inline instead (AGENTS.md "UI"). The shape follows camp-404
// `packages/ui/src/components/toast.tsx`; the pixel kit draws it
// (packages/ui toast.tsx).
//
// CLIENT-ONLY state: the server never reads it (the Toaster's server snapshot
// is a constant empty list), so nothing leaks between requests.

export type ToastVariant = "info" | "success" | "error";

export interface ToastRecord {
  id: number;
  variant: ToastVariant;
  title: string;
  /** ms before it goes away by itself. */
  duration: number;
}

export const TOAST_DURATION_MS = 5000;

let toasts: readonly ToastRecord[] = [];
const EMPTY: readonly ToastRecord[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToasts(): readonly ToastRecord[] {
  return toasts;
}

export function getServerToasts(): readonly ToastRecord[] {
  return EMPTY;
}

function push(variant: ToastVariant, title: string): number {
  const id = nextId++;
  toasts = [...toasts, { id, variant, title, duration: TOAST_DURATION_MS }];
  emit();
  return id;
}

/** Dismiss one toast, or all of them with no id. */
export function dismissToast(id?: number): void {
  toasts = id === undefined ? [] : toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  info: (title: string) => push("info", title),
  success: (title: string) => push("success", title),
  error: (title: string) => push("error", title),
};

/**
 * Show a failed action's message as an error toast. Returns true when it did,
 * so a caller can write `if (toastActionError(result)) return;`.
 */
export function toastActionError(result: ActionResult<unknown>): boolean {
  if (result.ok) return false;
  toast.error(result.message);
  return true;
}
