import { SpriteStrip } from "./pixel/pixel-art";
import type { Palette, Sprite } from "./pixel/pixel-grid";

// The screensaver's raccoons (ADR 0005 §6), 18 × 10 and facing right, from
// the approved prototype (proto/kiosk-home-pixel, pixels.tsx): two walk
// frames that only differ in the legs, trotting in place. Where they go is
// the screensaver's business.

const RACCOON_TOP: Sprite = [
  "............K..K..",
  "...........KgKKgK.",
  "..........KggggggK",
  "Gt........KMeMMeMK",
  ".tGt....KgggWWWWKK",
  "..tGtKKKggggggggK.",
  "...KgggggggggggK..",
  "...KgggggggggggK..",
];

/** The two walk frames. */
export const RACCOON_FRAMES: readonly Sprite[] = [
  [...RACCOON_TOP, "...KGK..KGK.KGK...", "...KK...KK...KK..."],
  [...RACCOON_TOP, "....KGK.KGK..KGK..", ".....KK..KK...KK.."],
];

export const RACCOON_PALETTE: Palette = {
  K: "#07040c",
  g: "#7d7590",
  G: "#3b3448",
  t: "#1d1726",
  W: "#d9d3e6",
  M: "#15101d",
  e: "#ffe46b",
};

/** A raccoon trotting in place; `flip` faces it left. */
export function Raccoon({
  scale = 4,
  flip = false,
  className,
}: {
  scale?: number;
  flip?: boolean;
  className?: string;
}) {
  return (
    <SpriteStrip
      frames={RACCOON_FRAMES}
      palette={RACCOON_PALETTE}
      scale={scale}
      frameMs={160}
      flip={flip}
      className={className}
    />
  );
}
