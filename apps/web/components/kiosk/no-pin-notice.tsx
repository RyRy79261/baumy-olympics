"use client";

import { PixelQr } from "@/components/account/pixel-qr";
import { SET_PIN_URL } from "@/lib/kiosk/constants";

// What the kiosk shows instead of the PinPad when the acting member has no
// personal PIN (issue #145): who it is, what the PIN is for (today only a
// dispute, SPEC §12 decision 27), and a QR code
// to Settings on their phone, where they set it. Never a PinPad they cannot
// use.

/** "Charl hasn't set a personal PIN yet", or "You haven't…" with no name. */
export function noPinHeadline(name?: string): string {
  return name
    ? `${name} hasn't set a personal PIN yet`
    : "You haven't set a personal PIN yet";
}

export function NoPinNotice({ name }: { name?: string }) {
  return (
    <div
      role="status"
      data-testid="no-pin-notice"
      className="flex flex-col items-start gap-3"
    >
      <p className="font-display text-sm leading-relaxed">
        {noPinHeadline(name)}
      </p>
      <p className="text-base text-bm-muted">
        The kitchen screen asks for it only to dispute a chore. Scan this to set
        one in Settings on your phone.
      </p>
      <PixelQr
        value={SET_PIN_URL}
        label="QR code: set your personal PIN in Settings"
        scale={3}
      />
    </div>
  );
}
