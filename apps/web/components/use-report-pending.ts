"use client";

import { useEffect, useRef } from "react";

/**
 * Tell the sheet around a form when its request starts and when the answer
 * is in, so the sheet (a Dialog's `busy`) stays open until then and the
 * answer always shows (issue #174). Told `false` when the form goes away.
 */
export function useReportPending(
  pending: boolean,
  onPending?: (pending: boolean) => void,
): void {
  const latest = useRef(onPending);
  latest.current = onPending;
  useEffect(() => {
    latest.current?.(pending);
  }, [pending]);
  useEffect(() => () => latest.current?.(false), []);
}
