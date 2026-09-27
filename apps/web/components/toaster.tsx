"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  type ToastRecord,
} from "@/lib/ui/toast";

// Renders the toast store (lib/ui/toast.ts). Deliberately bare: the pixel UI
// kit (issue #7) owns how toasts look. Mounted once, in the root layout.

function ToastItem({ toast }: { toast: ToastRecord }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration]);
  return (
    <li
      role={toast.variant === "error" ? "alert" : "status"}
      data-variant={toast.variant}
    >
      {toast.title}{" "}
      <button type="button" onClick={() => dismissToast(toast.id)}>
        Dismiss
      </button>
    </li>
  );
}

export function Toaster() {
  const toasts = useSyncExternalStore(
    subscribeToasts,
    getToasts,
    getServerToasts,
  );
  if (toasts.length === 0) return null;
  return (
    <ol aria-label="Notifications" data-testid="toaster">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </ol>
  );
}
