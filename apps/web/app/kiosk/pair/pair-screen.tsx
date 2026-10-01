"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, FormMessage } from "@baumy/ui";
import { PixelQr } from "@/components/account/pixel-qr";
import { formatKioskPairingCode, kioskApproveUrl } from "@/lib/kiosk/format";

// The unpaired iPad's half of QR pairing (issue #126, lib/kiosk/pairing.ts):
// ask for a code, show it as a QR code that opens the admin's confirm page,
// and ask every couple of seconds whether an admin has approved it. Once
// approved, trade the request for the device cookie and go to the kitchen
// home. An expired code is replaced by a fresh one without a tap.

/** How often the screen asks whether it was approved. */
export const PAIR_POLL_MS = 2_000;

type Screen =
  | { kind: "starting" }
  | { kind: "showing"; code: string; url: string }
  | { kind: "pairing" }
  | { kind: "error"; message: string };

interface StartBody {
  ok: boolean;
  code?: string;
  message?: string;
}

export function PairScreen() {
  const [screen, setScreen] = useState<Screen>({ kind: "starting" });
  const busy = useRef(false);

  const start = useCallback(async () => {
    setScreen({ kind: "starting" });
    try {
      const res = await fetch("/api/kiosk-pairing/start", { method: "POST" });
      const body = (await res.json()) as StartBody;
      if (!res.ok || !body.ok || !body.code) {
        setScreen({
          kind: "error",
          message: body.message ?? "Could not get a code. Try again.",
        });
        return;
      }
      setScreen({
        kind: "showing",
        code: body.code,
        url: kioskApproveUrl(window.location.origin, body.code),
      });
    } catch {
      setScreen({
        kind: "error",
        message: "No connection. Check the Wi-Fi, then try again.",
      });
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const showing = screen.kind === "showing";
  useEffect(() => {
    if (!showing) return;
    const poll = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const res = await fetch("/api/kiosk-pairing/status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const { status } = (await res.json()) as { status: string };
        if (status === "approved") {
          setScreen({ kind: "pairing" });
          const done = await fetch("/api/kiosk-pairing/exchange", {
            method: "POST",
          });
          if (done.ok) {
            window.location.assign("/kiosk");
            return;
          }
          await start();
        } else if (status === "expired" || status === "used") {
          await start();
        }
      } catch {
        // Offline for a moment: the next tick asks again.
      } finally {
        busy.current = false;
      }
    };
    const timer = window.setInterval(() => void poll(), PAIR_POLL_MS);
    return () => window.clearInterval(timer);
  }, [showing, start]);

  if (screen.kind === "error") {
    return (
      <div className="flex flex-col gap-4">
        <FormMessage tone="error">{screen.message}</FormMessage>
        <Button size="kiosk" onClick={() => void start()}>
          Try again
        </Button>
      </div>
    );
  }

  if (screen.kind === "pairing") {
    return (
      <p role="status" className="text-xl">
        Approved. Opening the kitchen screen...
      </p>
    );
  }

  if (screen.kind === "starting") {
    return (
      <p role="status" className="text-xl text-bm-muted">
        Getting a code...
      </p>
    );
  }

  const shown = formatKioskPairingCode(screen.code);
  return (
    <Card>
      <div className="flex flex-col items-center gap-6 text-center">
        <div
          className="flex justify-center"
          data-testid="pairing-qr"
          data-approve-url={screen.url}
        >
          <PixelQr
            value={screen.url}
            label={`QR code: scan it with an admin's phone to approve code ${shown}`}
            scale={9}
          />
        </div>
        <ol className="flex max-w-md list-decimal flex-col gap-2 pl-6 text-left text-lg">
          <li>On your phone, sign in to Baumy as an admin.</li>
          <li>Point the camera at the code and open the link.</li>
          <li>
            Tap <strong>Make it the kitchen screen</strong>. This screen changes
            by itself.
          </li>
        </ol>
        <p className="text-base text-bm-muted">
          No camera? On the phone, open Admin, then Kitchen screen, and type
        </p>
        <p
          className="font-mono text-4xl tracking-[0.2em]"
          data-testid="pairing-code"
        >
          {shown}
        </p>
        <p role="status" className="text-base text-bm-muted">
          Waiting for an admin. A new code comes by itself every 10 minutes.
        </p>
        <Button size="kiosk" variant="secondary" onClick={() => void start()}>
          New code
        </Button>
      </div>
    </Card>
  );
}
