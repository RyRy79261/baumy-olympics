"use client";

import { encode } from "uqr";
import { PixelArt } from "@baumy/ui";

// A QR code drawn as pixel art (issue #79): a QR code is a grid of square
// modules, so it goes through the kit's own grid renderer, crisp at any
// scale. Pure black on white with the standard 4-module quiet zone, because
// that is what every authenticator app's camera reads best.

const PALETTE = { "#": "#000000", ".": "#ffffff" } as const;

/** The QR modules as a pixel grid: "#" dark, "." light. */
export function qrGrid(text: string): string[] {
  return encode(text, { border: 4, ecc: "M" }).data.map((row) =>
    row.map((dark) => (dark ? "#" : ".")).join(""),
  );
}

export function PixelQr({
  value,
  label,
  scale = 4,
}: {
  value: string;
  label: string;
  scale?: number;
}) {
  return (
    <div className="pixel-frame inline-block self-start bg-white p-1 [--pf:var(--color-bm-text)]">
      <PixelArt
        grid={qrGrid(value)}
        palette={PALETTE}
        scale={scale}
        label={label}
        className="block h-auto max-w-full"
      />
    </div>
  );
}
