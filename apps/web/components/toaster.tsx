"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Button, ToastItem as ToastCard, ToastList } from "@baumy/ui";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  type ToastRecord,
} from "@/lib/ui/toast";

// Renders the toast store (lib/ui/toast.ts) in the pixel kit's toasts
// (packages/ui toast.tsx). Mounted once, in the root layout.

function ToastItem({ toast }: { toast: ToastRecord }) {
  useEffect(() => {
    const timer = setTimeout(() => dismissToast(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration]);
  return (
    <ToastCard
      variant={toast.variant}
      action={
        <Button variant="ghost" onClick={() => dismissToast(toast.id)}>
          Dismiss
        </Button>
      }
    >
      {toast.title}{" "}
    </ToastCard>
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
    <ToastList aria-label="Notifications" data-testid="toaster">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </ToastList>
  );
}
