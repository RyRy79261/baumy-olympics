"use client";

import { useEffect, useState } from "react";
import { ClockFace } from "@baumy/ui";
import { clockLines } from "@/lib/hub/view";

// The hub's clock (SPEC §3.1), in Berlin time whatever the device's zone.
// It starts from the server's `now` and keeps the server's offset from this
// device's clock, so a kiosk whose clock drifts still shows the house time
// (and e2e's moved server clock too).

export function LiveClock({
  serverNow,
  kiosk = false,
}: {
  /** The instant the page was rendered at, ISO 8601. */
  serverNow: string;
  kiosk?: boolean;
}) {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    const offset = Date.parse(serverNow) - Date.now();
    const tick = () => setNow(new Date(Date.now() + offset));
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [serverNow]);
  const { time, date } = clockLines(now);
  return <ClockFace time={time} date={date} kiosk={kiosk} />;
}
